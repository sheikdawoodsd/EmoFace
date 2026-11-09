"""AlexNet for 7-class facial expression recognition (transfer learning)."""
import torch.nn as nn
from torchvision import models

# Alphabetical order = the order torchvision's ImageFolder assigns to the
# FER-2013 folders. The Colab notebook saves this list inside the checkpoint,
# and the app reads it back, so training and prediction can never disagree.
EMOTIONS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]

INPUT_SIZE = 227
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def build_alexnet(num_classes: int = len(EMOTIONS), pretrained: bool = True) -> nn.Module:
    """AlexNet with the final 1000-way layer replaced by a 7-way layer."""
    weights = models.AlexNet_Weights.IMAGENET1K_V1 if pretrained else None
    model = models.alexnet(weights=weights)
    model.classifier[6] = nn.Linear(4096, num_classes)
    return model
