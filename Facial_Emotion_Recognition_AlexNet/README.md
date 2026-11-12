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

### Camera accuracy (what was improved)
A webcam face is large, sharp and lit differently from the 48x48 FER-2013 training faces, and subtle expressions are easy to read as "neutral". The included `models/alexnet_emotion.pth` is the FER-2013 AlexNet, then fine-tuned on about 1,200 labelled real face photos with webcam-style blur, exposure and noise, while staying close to the original model so it keeps what it learned from FER-2013. On people the model had never seen, accuracy rose from about 60% to about 77% (surprise and neutral improved most; **disgust and fear have very few examples and stay the weakest**, so treat them with care).

At prediction time EmoFace also:
- finds faces more reliably in soft, backlit webcam frames (a stricter detector missed about half of simulated webcam frames; the tolerant one found all of them);
- averages a tight and a slightly wider face crop, each mirrored;
- applies the same auto-contrast and 48x48 preparation as in training, plus the class-bias values stored in the checkpoint;
- marks results under 45% confidence as "Not sure" instead of presenting them as certain.

These are measured on a small public sample of posed photos, not on your own webcam, so real-world accuracy will differ. Act out the expression clearly (a real smile, raised eyebrows) with the face well lit and the light in front of you, not behind.

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


## Sign-in per device and permanent storage

* The first time a browser opens the site it is asked for name, age and gender. After that the same browser goes straight into the app (the intro still plays). A different browser or phone is asked to sign in and sees none of the other device's people or photos.
* Everything (people, results and the photos) is stored in the database, not on the web server's disk.
  * Local: a SQLite file in `instance/`.
  * Hosted (Render): set the environment variable `DATABASE_URL` to a Postgres address (Supabase: Project > Connect > Session pooler). Without it Render's free disk is wiped on every restart.

## Train on Hugging Face photos

Open `notebooks/train_on_huggingface_colab.ipynb` in Colab (T4 GPU), run all cells, upload your current `alexnet_emotion.pth` when asked, then replace the file in `models/` with the downloaded one.
