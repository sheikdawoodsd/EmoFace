"""Load the trained AlexNet and turn a photo into emotion probabilities."""
import hashlib
import os
from pathlib import Path
from typing import Dict, Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

from .face_detection import detect_largest_face
from .model import EMOTIONS, IMAGENET_MEAN, IMAGENET_STD, INPUT_SIZE

MODEL_PATH = Path(
    os.environ.get("EMOFACE_MODEL")
    or Path(__file__).resolve().parent.parent / "models" / "alexnet_emotion.pth"
)

FER_SIZE = 48  # FER-2013 training faces are 48x48 grayscale


class ModelNotReady(RuntimeError):
    """Raised when no trained weights exist and demo mode is off."""


class NoFaceFound(ValueError):
    """Raised when the photo contains no detectable face."""


class EmotionPredictor:
    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = Path(model_path)
        self.demo = os.environ.get("DEMO_MODE") == "1"
        self.allow_no_face = os.environ.get("ALLOW_NO_FACE") == "1"
        self.model = None
        self.classes = list(EMOTIONS)
        self.device = None
        # These come from the checkpoint written by the Colab notebook. Older
        # checkpoints without them still work with the defaults below.
        self.input_size = INPUT_SIZE
        self.autocontrast = False
        self.logit_bias: Optional[np.ndarray] = None
        self._load()

    # ------------------------------------------------------------------ load
    def _load(self) -> None:
        if not self.model_path.exists():
            return
        import torch
        from .model import build_alexnet

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        ckpt = torch.load(self.model_path, map_location=self.device, weights_only=False)
        is_dict = isinstance(ckpt, dict)
        state = ckpt["state_dict"] if is_dict and "state_dict" in ckpt else ckpt
        if is_dict:
            self.classes = list(ckpt.get("classes", self.classes))
            self.input_size = int(ckpt.get("input_size", INPUT_SIZE))
            self.autocontrast = bool(ckpt.get("autocontrast", False))
            bias = ckpt.get("logit_bias")
            if bias is not None and len(bias) == len(self.classes):
                self.logit_bias = np.asarray(bias, dtype=np.float32)
        model = build_alexnet(len(self.classes), pretrained=False)
        model.load_state_dict(state)
        model.to(self.device).eval()
        self.model = model

    @property
    def status(self) -> Dict:
        return {
            "model_loaded": self.model is not None,
            "demo_mode": self.model is None and self.demo,
            "classes": self.classes,
            "calibrated": self.logit_bias is not None,
        }

    # ------------------------------------------------------------ preprocess
    def _preprocess(self, face_bgr: np.ndarray):
        """Identical to the Colab notebook's evaluation transform, step by step."""
        import torch

        gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
        # A webcam face crop is much larger and sharper than the 48x48 training
        # faces. Reduce it to 48x48 (area averaging) so it has the same detail level.
        gray = cv2.resize(gray, (FER_SIZE, FER_SIZE), interpolation=cv2.INTER_AREA)
        img = Image.fromarray(gray)
        if self.autocontrast:
            # Webcam light is flatter or harsher than FER-2013's. Stretching the
            # contrast the same way as in training removes that difference.
            img = ImageOps.autocontrast(img, cutoff=1)
        img = img.resize((self.input_size, self.input_size), Image.BICUBIC)
        rgb = np.stack([np.asarray(img)] * 3, axis=-1).astype(np.float32) / 255.0
        rgb = (rgb - np.array(IMAGENET_MEAN, np.float32)) / np.array(IMAGENET_STD, np.float32)
        return torch.from_numpy(rgb.transpose(2, 0, 1)).unsqueeze(0)

    # --------------------------------------------------------------- predict
    def predict(self, bgr: np.ndarray) -> Dict:
        if self.model is None and not self.demo:
            raise ModelNotReady(
                "No trained model found. Train it with the Colab notebook and place "
                "alexnet_emotion.pth in the models folder."
            )

        h, w = bgr.shape[:2]
        box = detect_largest_face(bgr)
        if box is None:
            if not self.allow_no_face:
                raise NoFaceFound("No face found.")
            box = (0, 0, w, h)
        x, y, bw, bh = box
        face = bgr[y : y + bh, x : x + bw]

        if self.model is not None:
            import torch

            with torch.no_grad():
                inp = self._preprocess(face).to(self.device)
                # Average the face and its mirror image (a smile is still a smile
                # flipped), then apply the notebook's class-bias calibration.
                batch = torch.cat([inp, torch.flip(inp, dims=[3])], dim=0)
                logits = self.model(batch).mean(dim=0)
                if self.logit_bias is not None:
                    logits = logits + torch.from_numpy(self.logit_bias).to(self.device)
                probs = torch.softmax(logits, dim=0).cpu().numpy()
            demo = False
        else:  # clearly flagged demo output, for testing the interface only
            seed = int(hashlib.sha256(face.tobytes()).hexdigest()[:8], 16)
            raw = np.random.default_rng(seed).dirichlet(np.ones(len(self.classes)) * 0.6)
            probs, demo = raw, True

        order = int(np.argmax(probs))
        return {
            "emotion": self.classes[order],
            "confidence": float(probs[order]),
            "probabilities": {c: float(p) for c, p in zip(self.classes, probs)},
            "box": {"x": x / w, "y": y / h, "w": bw / w, "h": bh / h},
            "demo": demo,
        }


_predictor: Optional[EmotionPredictor] = None


def get_predictor() -> EmotionPredictor:
    global _predictor
    if _predictor is None:
        _predictor = EmotionPredictor()
    return _predictor
