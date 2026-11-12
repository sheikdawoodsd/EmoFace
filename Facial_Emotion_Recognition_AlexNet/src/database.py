"""Storage for devices, users and detection history.

Default: SQLite file (instance/emotion_history.db).
Durable hosting: set DATABASE_URL to a Postgres URL (Supabase / Render Postgres / Neon)
and everything - including the saved photos - lives there and survives restarts.
Photos are stored inside the database (small JPEGs), never on the web server's disk.
"""
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

DB_PATH = Path(os.environ.get("EMOFACE_DB", Path(__file__).resolve().parent.parent / "instance" / "emotion_history.db"))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
if PG:
    try:
        import psycopg2  # noqa: WPS433
    except ImportError:  # hosts whose build step did not install it (e.g. the Render service's custom build)
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "psycopg2-binary"])
        import psycopg2
    import psycopg2.extras


def _sql(q: str) -> str:
    return q.replace("?", "%s") if PG else q


@contextmanager
def _connect():
    if PG:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor, connect_timeout=10)
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _exec(conn, q, args=()):
    cur = conn.cursor()
    cur.execute(_sql(q), args)
    return cur


def _insert(conn, q, args) -> int:
    if PG:
        cur = _exec(conn, q + " RETURNING id", args)
        return cur.fetchone()["id"]
    return _exec(conn, q, args).lastrowid


def init_db() -> None:
    pk = "SERIAL PRIMARY KEY" if PG else "INTEGER PRIMARY KEY AUTOINCREMENT"
    blob = "BYTEA" if PG else "BLOB"
    stmts = [
        f"""CREATE TABLE IF NOT EXISTS users (
            id {pk}, name TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL,
            device_token TEXT, created_at TEXT NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS devices (
            token TEXT PRIMARY KEY, active_user_id INTEGER, created_at TEXT NOT NULL, last_seen TEXT NOT NULL)""",
        f"""CREATE TABLE IF NOT EXISTS history (
            id {pk}, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emotion TEXT NOT NULL, confidence REAL NOT NULL, probabilities TEXT NOT NULL,
            image {blob}, image_file TEXT, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)""",
        "CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_token)",
    ]
    # Older databases (before device sign-in) lack these columns: add them before indexing.
    upgrades = [("users", "device_token", "TEXT"), ("history", "image", blob), ("history", "image_file", "TEXT")]
    with _connect() as conn:
        for s in stmts[:3]:
            _exec(conn, s)
        for table, col, typ in upgrades:
            if PG:
                _exec(conn, f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {typ}")
            else:
                have = {r["name"] for r in _exec(conn, f"PRAGMA table_info({table})").fetchall()}
                if col not in have:
                    _exec(conn, f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        for s in stmts[3:]:
            _exec(conn, s)
        if PG:  # keep the tables private: only this server (not the public Supabase API key) may read them
            for t in ("users", "devices", "history"):
                _exec(conn, f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def valid_token(token: Optional[str]) -> bool:
    return bool(token and _TOKEN.match(token))


# ---------------------------------------------------------------- devices
def touch_device(token: str) -> Dict:
    """Create the device on first sight, refresh last_seen. Returns the device row."""
    with _connect() as conn:
        row = _exec(conn, "SELECT * FROM devices WHERE token = ?", (token,)).fetchone()
        if row is None:
            _exec(conn, "INSERT INTO devices (token, active_user_id, created_at, last_seen) VALUES (?, NULL, ?, ?)",
                  (token, _now(), _now()))
            return {"token": token, "active_user_id": None}
        _exec(conn, "UPDATE devices SET last_seen = ? WHERE token = ?", (_now(), token))
        return dict(row)


def set_active_user(token: str, user_id: Optional[int]) -> None:
    with _connect() as conn:
        _exec(conn, "UPDATE devices SET active_user_id = ? WHERE token = ?", (user_id, token))


# ------------------------------------------------------------------ users
def create_user(name: str, age: int, gender: str, device_token: str) -> Dict:
    with _connect() as conn:
        user_id = _insert(conn, "INSERT INTO users (name, age, gender, device_token, created_at) VALUES (?, ?, ?, ?, ?)",
                          (name, age, gender, device_token, _now()))
        _exec(conn, "UPDATE devices SET active_user_id = ? WHERE token = ?", (user_id, device_token))
    return get_user(user_id)  # type: ignore[return-value]


def _public_user(row) -> Dict:
    d = dict(row)
    d.pop("device_token", None)
    return d


def get_user(user_id: int, device_token: Optional[str] = None) -> Optional[Dict]:
    """A user is only visible to the device that created them."""
    with _connect() as conn:
        if device_token is None:
            row = _exec(conn, "SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        else:
            row = _exec(conn, "SELECT * FROM users WHERE id = ? AND device_token = ?", (user_id, device_token)).fetchone()
        return _public_user(row) if row else None


def list_device_users(device_token: str) -> List[Dict]:
    with _connect() as conn:
        rows = _exec(conn, "SELECT * FROM users WHERE device_token = ? ORDER BY id DESC", (device_token,)).fetchall()
        return [_public_user(r) for r in rows]


# ---------------------------------------------------------------- history
def add_history(user_id: int, result: Dict, image: bytes) -> Dict:
    with _connect() as conn:
        item_id = _insert(
            conn,
            "INSERT INTO history (user_id, emotion, confidence, probabilities, image, image_file, demo, created_at)"
            " VALUES (?, ?, ?, ?, ?, '', ?, ?)",
            (user_id, result["emotion"], result["confidence"], json.dumps(result["probabilities"]),
             psycopg2.Binary(image) if PG else image, int(result.get("demo", False)), _now()),
        )
    return get_history_item(user_id, item_id)  # type: ignore[return-value]


def _row_to_item(row) -> Dict:
    item = dict(row)
    item.pop("image", None)
    item.pop("image_file", None)
    item["probabilities"] = json.loads(item["probabilities"])
    item["demo"] = bool(item["demo"])
    item["image_url"] = f"/api/photo/{item['id']}"
    return item


_COLS = "id, user_id, emotion, confidence, probabilities, demo, created_at"


def get_history_item(user_id: int, item_id: int) -> Optional[Dict]:
    with _connect() as conn:
        row = _exec(conn, f"SELECT {_COLS} FROM history WHERE id = ? AND user_id = ?", (item_id, user_id)).fetchone()
        return _row_to_item(row) if row else None


def list_history(user_id: int) -> List[Dict]:
    with _connect() as conn:
        rows = _exec(conn, f"SELECT {_COLS} FROM history WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()
        return [_row_to_item(r) for r in rows]


def get_photo(user_id: int, item_id: int) -> Optional[bytes]:
    with _connect() as conn:
        row = _exec(conn, "SELECT image, image_file FROM history WHERE id = ? AND user_id = ?", (item_id, user_id)).fetchone()
        if not row:
            return None
        if row["image"] is not None:
            return bytes(row["image"])
        legacy = row["image_file"]  # photo saved by an older version as a file
        if legacy:
            f = Path(__file__).resolve().parent.parent / "static" / "captures" / os.path.basename(legacy)
            if f.is_file():
                return f.read_bytes()
        return None


def delete_history(user_id: int, item_id: Optional[int] = None) -> None:
    with _connect() as conn:
        if item_id is None:
            _exec(conn, "DELETE FROM history WHERE user_id = ?", (user_id,))
        else:
            _exec(conn, "DELETE FROM history WHERE id = ? AND user_id = ?", (item_id, user_id))
