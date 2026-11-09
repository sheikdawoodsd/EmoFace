"""SQLite storage for users and their detection history."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent.parent / "instance" / "emotion_history.db"


@contextmanager
def _connect():
    """Open a connection, commit on success, roll back on error, always close."""
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


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                emotion TEXT NOT NULL,
                confidence REAL NOT NULL,
                probabilities TEXT NOT NULL,
                image_file TEXT NOT NULL,
                demo INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, id DESC);
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create_user(name: str, age: int, gender: str) -> Dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO users (name, age, gender, created_at) VALUES (?, ?, ?, ?)",
            (name, age, gender, _now()),
        )
        user_id = cur.lastrowid
    return get_user(user_id)  # type: ignore[arg-type,return-value]


def get_user(user_id: int) -> Optional[Dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def delete_user(user_id: int) -> Optional[List[str]]:
    """Delete a user and their history, returning associated image filenames."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT image_file FROM history WHERE user_id = ?", (user_id,)
        ).fetchall()
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cur.rowcount == 0:
            return None
        return [item["image_file"] for item in row]


def add_history(user_id: int, result: Dict, image_file: str) -> Dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO history (user_id, emotion, confidence, probabilities, image_file, demo, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                result["emotion"],
                result["confidence"],
                json.dumps(result["probabilities"]),
                image_file,
                int(result.get("demo", False)),
                _now(),
            ),
        )
        item_id = cur.lastrowid
    return get_history_item(user_id, item_id)  # type: ignore[arg-type,return-value]


def _row_to_item(row: sqlite3.Row) -> Dict:
    item = dict(row)
    item["probabilities"] = json.loads(item["probabilities"])
    item["demo"] = bool(item["demo"])
    item["image_url"] = f"/static/captures/{item.pop('image_file')}"
    return item


def get_history_item(user_id: int, item_id: int) -> Optional[Dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM history WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()
        return _row_to_item(row) if row else None


def list_history(user_id: int) -> List[Dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM history WHERE user_id = ? ORDER BY id DESC", (user_id,)
        ).fetchall()
        return [_row_to_item(r) for r in rows]


def delete_history(user_id: int, item_id: Optional[int] = None) -> List[str]:
    """Delete one entry (or all when item_id is None). Returns image files to remove."""
    with _connect() as conn:
        if item_id is None:
            rows = conn.execute(
                "SELECT image_file FROM history WHERE user_id = ?", (user_id,)
            ).fetchall()
            conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        else:
            rows = conn.execute(
                "SELECT image_file FROM history WHERE id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchall()
            conn.execute(
                "DELETE FROM history WHERE id = ? AND user_id = ?", (item_id, user_id)
            )
        return [r["image_file"] for r in rows]
