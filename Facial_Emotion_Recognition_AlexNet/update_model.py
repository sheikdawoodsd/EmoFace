"""Turn your current models/alexnet_emotion.pth into the improved model.

Why a patch and not a new 228 MB file: only the small differences are shipped
(model_update.xz, about 22 MB). This script adds them to the model you already
have and writes the result back to the same place.

Run from the project folder:   python update_model.py
"""
import lzma
import os
import pickle
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
MODEL = HERE / "models" / "alexnet_emotion.pth"
PATCH = HERE / "model_update.xz"


def main() -> int:
    if not PATCH.is_file():
        print("model_update.xz is missing. Put it next to this script.")
        return 1
    if not MODEL.is_file():
        print(f"{MODEL} was not found. Put your trained model there first.")
        return 1
    if MODEL.stat().st_size < 1_000_000:
        print("models/alexnet_emotion.pth is only a tiny Git LFS pointer, not the real model.\n"
              "Run:  git lfs pull   (or copy your real alexnet_emotion.pth into models/) and try again.")
        return 1

    ckpt = torch.load(MODEL, map_location="cpu", weights_only=False)
    if "tta_margins" in ckpt:
        print("This model is already updated. Nothing to do.")
        return 0
    with lzma.open(PATCH, "rb") as f:
        patch = pickle.load(f)

    fingerprint = float(ckpt["state_dict"]["classifier.6.weight"].double().sum())
    if abs(fingerprint - patch["base_fingerprint"]) > 1e-3:
        print("This is not the model the update was made for (different weights), so it was not changed.\n"
              "Use the alexnet_emotion.pth that was in your GitHub repo.")
        return 1

    state = ckpt["state_dict"]
    for name, shape, scale, raw in patch["deltas"]:
        delta = torch.from_numpy(np.frombuffer(raw, dtype=np.int8).astype(np.float32).reshape(shape) * scale)
        state[name] = (state[name].float() + delta).contiguous()
    ckpt.update(patch["meta"])
    ckpt["state_dict"] = state

    tmp = Path(tempfile.mkstemp(suffix=".pth", dir=MODEL.parent)[1])
    torch.save(ckpt, tmp)
    os.replace(tmp, MODEL)  # the old file is replaced only after the new one is written completely
    print("Done. models/alexnet_emotion.pth is now the improved model.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
