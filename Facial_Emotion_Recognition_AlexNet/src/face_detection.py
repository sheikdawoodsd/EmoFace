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


_cascades: Optional[list] = None


def _load_all() -> list:
    """The main detector first, then OpenCV's second face detector (alt2) as a backup."""
    cascades = [_load_cascade()]
    if hasattr(cv2, "data"):
        alt = Path(cv2.data.haarcascades) / "haarcascade_frontalface_alt2.xml"
        if alt.is_file():
            c = cv2.CascadeClassifier(str(alt))
            if not c.empty():
                cascades.append(c)
    return cascades


def detect_largest_face(bgr: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Return (x, y, w, h) of the largest face, or None when no face is found.

    Webcam frames are often backlit, soft or noisy, and one strict pass misses
    many of them. The passes below go from strict to tolerant and stop at the
    first one that finds a face, so a clearly visible face is detected exactly
    as before.
    """
    global _cascades
    if _cascades is None:
        _cascades = _load_all()
    main = _cascades[0]
    alt = _cascades[1] if len(_cascades) > 1 else main
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    min_side = max(40, int(min(gray.shape[:2]) * 0.12))
    views = (
        cv2.equalizeHist(gray),
        cv2.createCLAHE(2.0, (8, 8)).apply(gray),
        gray,
    )
    for cascade, neighbours in ((main, 5), (alt, 4), (main, 3), (alt, 3)):
        for view in views:
            faces = cascade.detectMultiScale(view, 1.08, neighbours, minSize=(min_side, min_side))
            if len(faces):
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                return int(x), int(y), int(w), int(h)
    return None
