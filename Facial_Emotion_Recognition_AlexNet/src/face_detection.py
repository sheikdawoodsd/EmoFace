"""Face detection with OpenCV's Haar cascade."""
import os
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np


def _load_cascade() -> cv2.CascadeClassifier:
    candidates = []
    if os.environ.get("EMOFACE_CASCADE"):
        candidates.append(Path(os.environ["EMOFACE_CASCADE"]))
    if hasattr(cv2, "data"):
        candidates.append(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    for path in candidates:
        if path.is_file():
            cascade = cv2.CascadeClassifier(str(path))
            if not cascade.empty():
                return cascade
    raise RuntimeError(
        "OpenCV's face-detector file (haarcascade_frontalface_default.xml) was not found. "
        "Install opencv-python 4.x (pip install \"opencv-python>=4.9,<5\") or set EMOFACE_CASCADE "
        "to the path of that file."
    )


_cascade: Optional[cv2.CascadeClassifier] = None


def detect_largest_face(bgr: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Return (x, y, w, h) of the largest face, or None when no face is found."""
    global _cascade
    if _cascade is None:
        _cascade = _load_cascade()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = _cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
    )
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return int(x), int(y), int(w), int(h)
