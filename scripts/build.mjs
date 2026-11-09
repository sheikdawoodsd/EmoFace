// Builds the static site into dist/: renders the Flask template and copies assets.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const APP = "Facial_Emotion_Recognition_AlexNet";
const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
let html = readFileSync(`${APP}/templates/index.html`, "utf8");
html = html.replace(/\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g, "/static/$1");
html = html.replace(/\{%\s*for g in genders\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/, (_, body) =>
  GENDERS.map((g) => body.replace(/\{\{\s*g\s*\}\}/g, g)).join(""));
writeFileSync("dist/index.html", html);
cpSync(`${APP}/static`, "dist/static", { recursive: true, filter: (p) => !p.includes("captures") });
cpSync("web/models", "dist/models", { recursive: true });
