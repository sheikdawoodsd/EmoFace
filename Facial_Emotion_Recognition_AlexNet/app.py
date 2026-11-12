"""EmoFace - Flask server: registration, emotion analysis (AlexNet) and saved history."""
import os
import secrets
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify, render_template, request

from src import database as db
from src.predict import ModelNotReady, NoFaceFound, get_predictor

BASE_DIR = Path(__file__).resolve().parent

GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB per upload
db.init_db()


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


COOKIE = "emoface_device"
FIVE_YEARS = 60 * 60 * 24 * 365 * 5


def device_token():
    """The browser's permanent device id (cookie, with an X-Device header fallback)."""
    token = request.cookies.get(COOKIE) or request.headers.get("X-Device")
    return token if db.valid_token(token) else None


def attach_cookie(resp, token):
    resp.set_cookie(COOKIE, token, max_age=FIVE_YEARS, httponly=True, samesite="Lax",
                    secure=request.is_secure or request.headers.get("X-Forwarded-Proto") == "https")
    return resp


def current_user():
    """The active user of this device (users belong to the device that made them)."""
    token = device_token()
    if not token:
        return None
    dev = db.touch_device(token)
    raw = request.args.get("user_id") or request.form.get("user_id")
    uid = int(raw) if raw and raw.isdigit() else dev.get("active_user_id")
    return db.get_user(uid, token) if uid else None


@app.get("/")
def index():
    return render_template("index.html", genders=GENDERS)


@app.get("/api/status")
def status():
    return jsonify(get_predictor().status)


# ------------------------------------------------- device session / users
@app.post("/api/session")
def session():
    """Called on every page load. Same device -> straight back in; new device -> sign-in."""
    token = device_token()
    new = token is None
    if new:
        token = secrets.token_urlsafe(24)
    dev = db.touch_device(token)
    data = request.get_json(silent=True) or {}
    # Switch to another profile that belongs to this device, or sign out of the current one.
    if "switch_to" in data:
        target = data["switch_to"]
        if target is None:
            db.set_active_user(token, None); dev["active_user_id"] = None
        elif db.get_user(int(target), token):
            db.set_active_user(token, int(target)); dev["active_user_id"] = int(target)
    user = db.get_user(dev["active_user_id"], token) if dev.get("active_user_id") else None
    resp = jsonify({"device": token, "new_device": new, "user": user, "profiles": db.list_device_users(token)})
    return attach_cookie(resp, token)


@app.post("/api/users")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    gender = str(data.get("gender", "")).strip()
    try:
        age = int(data.get("age"))
    except (TypeError, ValueError):
        return error("Enter your age as a number.")

    if not 1 <= len(name) <= 40:
        return error("Enter your name (up to 40 characters).")
    if not 5 <= age <= 120:
        return error("Enter an age between 5 and 120.")
    if gender not in GENDERS:
        return error("Choose one of the gender options.")
    token = device_token() or secrets.token_urlsafe(24)
    db.touch_device(token)
    return attach_cookie(jsonify(db.create_user(name, age, gender, token)), token), 201


# -------------------------------------------------------------- analysis
@app.post("/api/analyze")
def analyze():
    user = current_user()
    if not user:
        return error("Your profile was not found. Please sign in again.", 401)

    upload = request.files.get("image")
    if upload is None:
        return error("No photo was sent.")
    frame = cv2.imdecode(np.frombuffer(upload.read(), np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return error("That file is not a readable image.", 415)

    h, w = frame.shape[:2]
    if max(h, w) > 1280:  # keep stored photos light
        scale = 1280 / max(h, w)
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    try:
        result = get_predictor().predict(frame)
    except NoFaceFound:
        return error("No face found. Face the camera in good light and retake the photo.", 422)
    except ModelNotReady as exc:
        return error(str(exc), 503)

    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    entry = db.add_history(user["id"], result, jpg.tobytes())
    return jsonify({**result, "history_item": entry})


# --------------------------------------------------------------- history
@app.get("/api/history")
def history():
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    return jsonify(db.list_history(user["id"]))


@app.get("/api/photo/<int:item_id>")
def photo(item_id: int):
    user = current_user()
    data = db.get_photo(user["id"], item_id) if user else None
    if data is None:
        return error("Photo not found.", 404)
    return Response(data, mimetype="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.delete("/api/history/<int:item_id>")
def delete_one(item_id: int):
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    db.delete_history(user["id"], item_id)
    return "", 204


@app.delete("/api/history")
def delete_all():
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    db.delete_history(user["id"])
    return "", 204


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
