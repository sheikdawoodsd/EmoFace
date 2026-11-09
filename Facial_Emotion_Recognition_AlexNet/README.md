# EmoFace: facial emotion recognition with AlexNet

EmoFace is a website that reads the facial expression in a photo (angry, disgust, fear, happy, neutral, sad, surprise) with an AlexNet deep-learning model, and saves every result in a history.

**How the website works**
0. A 5-second animated intro (a face mesh being scanned) plays when the site opens. **Skip intro** or Esc ends it early; open `http://127.0.0.1:5000/?nointro` to disable it. It is skipped automatically if the system asks for reduced motion.
1. The visitor enters name, age and gender.
2. EmoFace greets them. The camera is on the left; "Image to analyse" is on the right.
3. **Click to take photo** puts the photo on the right with **Confirm photo** and **Retake**.
   - Retake returns to the live camera.
   - Confirm detects the face, predicts the expression and shows all seven probabilities.
4. Every confirmed result is saved (photo, expression, confidence, time) and appears under **History**, where single entries or everything can be deleted.
5. Photos can also be uploaded instead of using the camera.
6. **Switch user** returns to the saved profiles; each profile has a **Delete account** option that removes the profile, its history, and its saved photos.

## Folder layout
```
Facial_Emotion_Recognition_AlexNet/
├── app.py                  Flask server and API
├── requirements.txt
├── src/
│   ├── model.py            AlexNet with a 7-class output layer
│   ├── face_detection.py   OpenCV Haar-cascade face detector
│   ├── predict.py          loads the trained model, preprocesses, predicts
│   └── database.py         SQLite: users and history
├── models/                 put alexnet_emotion.pth here
├── notebooks/train_alexnet_colab.ipynb   training on Google Colab with Kaggle FER-2013
├── templates/index.html
└── static/ (css, js, captures)
```
History is stored in `instance/emotion_history.db`; photos in `static/captures/`. Both are created automatically.

## Step 1: Train the model (Google Colab + Kaggle)
1. Open https://colab.research.google.com, choose **File > Upload notebook**, and upload `notebooks/train_alexnet_colab.ipynb`.
2. **Runtime > Change runtime type > T4 GPU**.
3. On Kaggle go to *Settings > API > Create New Token* to get `kaggle.json`. Colab asks for it in the first data cell.
4. Run all cells. At the end Colab downloads `alexnet_emotion.pth`, `training_curves.png` and `confusion_matrix.png`.
5. Put `alexnet_emotion.pth` into the `models/` folder.

The test-set accuracy, precision, recall, F1 and confusion matrix printed by the notebook are your real results. Quote those in your report. Set `PRETRAINED = False` and run again to compare against training from scratch.

### Why the camera used to say "neutral" (and what changed)
Uploads looked fine but the webcam kept answering "neutral". FER-2013 is 48x48 grayscale, while a webcam face is large, sharp and lit differently, so the model sees something it was never trained on and falls back to its safest class. The code now fixes this in four ways:
- the face is shrunk to 48x48 and enlarged again, exactly like the training data (the website and the notebook share the same steps);
- contrast is auto-stretched in both training and the website (`autocontrast` is stored in the checkpoint);
- training adds webcam-style blur, brightness and noise, and the prediction averages the face with its mirror image;
- the notebook measures per-class bias on validation data and saves a `logit_bias` correction in the checkpoint.

**Important:** these fixes only reach full strength with a model trained by the *updated* notebook. A model from the old notebook still runs, but without autocontrast or calibration. Retrain once in Colab (about 20-30 minutes on a T4) and replace `models/alexnet_emotion.pth`. Low-confidence results (under 45%) are marked "Not sure" on screen.

## Step 2: Run the website in VS Code (Windows)
Open the folder in VS Code, open a terminal (Ctrl+`), then:
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
Open **http://127.0.0.1:5000** in Chrome or Edge and allow the camera.
The camera only works on `127.0.0.1`/`localhost` or HTTPS, so use that address and not your network IP.

**No model yet?** Without `models/alexnet_emotion.pth` the site shows a notice and refuses to predict. To try the interface only, run with placeholder results (clearly labelled "Demo"):
```
$env:DEMO_MODE=1      # PowerShell   (cmd: set DEMO_MODE=1)
python app.py
```

## Notes
- Predictions are expression categories, not a measurement of how someone feels. The site says so on every result.
- FER-2013 images are small, low-resolution and imbalanced; the notebook weights the loss to compensate. Expect "disgust" and "fear" to be the weakest classes.
- The page fonts (Syne, Figtree) are bundled in `static/fonts`, so the site works offline.
- If the Kaggle download cell fails, open the FER-2013 dataset page on Kaggle (by *msambare*) while signed in, accept its terms once, and run the cell again. Any FER-2013 copy with `train` and `test` folders works.
- Face detection uses the Haar cascade bundled with `opencv-python` 4.x (the requirements pin `<5`).
