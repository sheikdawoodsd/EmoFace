"""EmoFace - Flask server: registration, emotion analysis (AlexNet) and saved history."""
import os
import uuid
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request

from src import database as db
from src.predict import ModelNotReady, NoFaceFound, get_predictor

BASE_DIR = Path(__file__).resolve().parent
CAPTURE_DIR = BASE_DIR / "static" / "captures"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB per upload
db.init_db()


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def current_user():
    """Look the user up from ?user_id= or the form field; None when unknown."""
    raw = request.args.get("user_id") or request.form.get("user_id")
    if not raw or not raw.isdigit():
        return None
    return db.get_user(int(raw))


@app.get("/")
def index():
    return render_template("index.html", genders=GENDERS)


@app.get("/api/status")
def status():
    return jsonify(get_predictor().status)


# ----------------------------------------------------------------- users
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
    return jsonify(db.create_user(name, age, gender)), 201


@app.get("/api/users/<int:user_id>")
def get_user(user_id: int):
    user = db.get_user(user_id)
    return jsonify(user) if user else error("User not found.", 404)


@app.delete("/api/users/<int:user_id>")
def delete_user(user_id: int):
    files = db.delete_user(user_id)
    if files is None:
        return error("User not found.", 404)
    _remove_files(files)
    return "", 204


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

    filename = f"{uuid.uuid4().hex}.jpg"
    cv2.imwrite(str(CAPTURE_DIR / filename), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    entry = db.add_history(user["id"], result, filename)
    return jsonify({**result, "history_item": entry})


# --------------------------------------------------------------- history
@app.get("/api/history")
def history():
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    return jsonify(db.list_history(user["id"]))


def _remove_files(files):
    for name in files:
        try:
            (CAPTURE_DIR / os.path.basename(name)).unlink(missing_ok=True)
        except OSError:
            pass


@app.delete("/api/history/<int:item_id>")
def delete_one(item_id: int):
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    _remove_files(db.delete_history(user["id"], item_id))
    return "", 204


@app.delete("/api/history")
def delete_all():
    user = current_user()
    if not user:
        return error("Your profile was not found.", 401)
    _remove_files(db.delete_history(user["id"]))
    return "", 204


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
