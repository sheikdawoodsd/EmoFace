/* EmoFace front end: register -> greeting -> camera / photo -> confirm or retake -> result -> history */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const EMOTIONS = ["happy", "neutral", "surprise", "sad", "angry", "fear", "disgust"]; // used for saved-profile chips
  const label = (e) => e.charAt(0).toUpperCase() + e.slice(1);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

  /* ---------- The seven faces (original drawings, 100x100) ---------- */
  const eyes = (r = 5, y = 42) => `<circle cx="35" cy="${y}" r="${r}" fill="currentColor"/><circle cx="65" cy="${y}" r="${r}" fill="currentColor"/>`;
  const line = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const FEATURES = {
    happy: eyes() + line("M30 60Q50 82 70 60"),
    neutral: eyes() + line("M36 68H64"),
    surprise: line("M27 29Q35 22 43 29M57 29Q65 22 73 29") + eyes(5.5, 44) + `<ellipse cx="50" cy="68" rx="7" ry="9" fill="currentColor"/>`,
    sad: line("M26 35L43 29M74 35L57 29") + eyes() + line("M32 72Q50 56 68 72"),
    angry: line("M26 29L43 37M74 29L57 37") + eyes(5, 45) + line("M34 71Q50 62 66 71"),
    fear: line("M26 34L43 28M74 34L57 28") + eyes(6, 43) + line("M36 69Q43 63 50 69T64 69"),
    disgust: line("M29 42H42M58 42H71") + line("M34 68Q42 60 50 67T66 63"),
  };
  const faceSVG = (emotion) =>
    `<svg class="face face-${emotion}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle class="face-bg" cx="50" cy="50" r="46"/>${FEATURES[emotion] || ""}</svg>`;

  /* ---------- Storage (profiles live in this browser, history lives in the database) ---------- */
  const store = {
    read(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  };

  async function api(path, options = {}) {
    let res;
    try { res = await fetch(path, options); }
    catch { throw new Error("Can't reach the EmoFace server. Check that it is still running."); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: res.status });
    return data;
  }

  /* ---------- State ---------- */
  let user = null;
  let stream = null;
  let pending = null; // { blob, url }
  let historyItems = [];

  /* ---------- Elements ---------- */
  const el = {
    welcome: $("#screenWelcome"), app: $("#screenApp"), navAction: $("#navAction"), navLabel: $("#navActionLabel"), howBtn: $("#howBtn"), howDialog: $("#howDialog"), closeHow: $("#closeHow"),
    form: $("#registerForm"), formErr: $("#formErr"), startBtn: $("#startBtn"),
    knownBox: $("#knownUsers"), knownList: $("#knownList"), knownErr: $("#knownErr"),
    greetTitle: $("#greetingTitle"), greetSub: $("#greetingSub"), steps: $$(".steps li"), notice: $("#notice"),
    camPanel: $("#cameraPanel"), video: $("#video"), guide: $("#guide"), liveDot: $("#liveDot"),
    camMsg: $("#camMsg"), camMsgText: $("#camMsgText"), camRetry: $("#camRetry"),
    takeBtn: $("#takeBtn"), upload: $("#uploadInput"),
    anaPanel: $("#analysisPanel"), photoImg: $("#photoImg"), faceBox: $("#faceBox"), scan: $("#scan"),
    confirmBtn: $("#confirmBtn"), retakeBtn: $("#retakeBtn"), analyseErr: $("#analyseErr"),
    analysing: $("#analysing"), confirmActions: $("#confirmActions"),
    resultFace: $("#resultFace"), resultEmotion: $("#resultEmotion"), resultConf: $("#resultConf"), bars: $("#bars"),
    againBtn: $("#againBtn"), openHistoryBtn: $("#openHistoryBtn"),
    historyBtn: $("#historyBtn"), historyCount: $("#historyCount"), historyDialog: $("#historyDialog"),
    closeHistory: $("#closeHistory"), historySummary: $("#historySummary"), historyList: $("#historyList"),
    historyEmpty: $("#historyEmpty"), clearAll: $("#clearAll"), uncertain: $("#uncertain"),
  };

  /* ---------- Ready gate: wait for the intro before moving focus or opening the camera ---------- */
  const introDone = () => document.documentElement.dataset.introDone === "1";
  const whenReady = (fn) => (introDone() ? fn() : document.addEventListener("emoface:ready", fn, { once: true }));

  /* ---------- Hero stage: a face cycling through the seven expressions (decorative) ---------- */
  const stage = {
    root: $("#heroStage"), face: $("#heroFace"), name: $("#heroName"), bars: $("#heroBars"),
    strip: $("#heroStrip"), reading: $("#heroReading"), prog: $("#heroProg"), pause: $("#stagePause"), avatars: $("#heroAvatars"),
  };
  const CYCLE_MS = 3000;
  const STAGE_ORDER = ["happy", "surprise", "neutral", "sad", "angry", "fear", "disgust"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stageIdx = 0, stageTimer = null, stagePaused = reduced;

  stage.strip.innerHTML = STAGE_ORDER.map((e) => `<span class="tile" data-e="${e}">${faceSVG(e)}</span>`).join("");
  stage.avatars.innerHTML = ["happy", "surprise", "sad"].map(faceSVG).join("");

  function showStage(i) {
    const e = STAGE_ORDER[i];
    stage.face.innerHTML = faceSVG(e);
    stage.name.textContent = label(e);
    stage.reading.textContent = e;
    $$(".tile", stage.strip).forEach((t) => t.classList.toggle("active", t.dataset.e === e));
    // an illustrative distribution, not a real prediction: the shown emotion leads
    const others = STAGE_ORDER.filter((x) => x !== e).slice(0, 3);
    const rows = [[e, 0.62], [others[0], 0.16], [others[1], 0.1], [others[2], 0.06]];
    stage.bars.innerHTML = rows.map(([n, p]) =>
      `<li style="--e:var(--e-${n})"><span>${n}</span><span class="track"><span class="fill" data-w="${p * 100}"></span></span></li>`).join("");
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".fill", stage.bars).forEach((f) => (f.style.width = `${f.dataset.w}%`))));
    stage.prog.classList.remove("run");
    void stage.prog.offsetWidth;            // restart the progress animation
    stage.root.style.setProperty("--cycle", `${CYCLE_MS}ms`);
    if (!stagePaused) stage.prog.classList.add("run");
  }
  function scheduleStage() {
    clearInterval(stageTimer);
    if (stagePaused || document.hidden) return;
    stageTimer = setInterval(() => { stageIdx = (stageIdx + 1) % STAGE_ORDER.length; showStage(stageIdx); }, CYCLE_MS);
  }
  function setStagePaused(p) {
    stagePaused = p;
    stage.root.dataset.paused = String(p);
    stage.pause.setAttribute("aria-pressed", String(p));
    stage.pause.textContent = p ? "Play animation" : "Pause animation";
    if (p) stage.prog.classList.remove("run"); else stage.prog.classList.add("run");
    scheduleStage();
  }
  stage.pause.addEventListener("click", () => setStagePaused(!stagePaused));
  document.addEventListener("visibilitychange", scheduleStage);
  showStage(0);
  setStagePaused(stagePaused);

  /* ---------- Nav: Get started / Switch user, How it works, History ---------- */
  el.howBtn.addEventListener("click", () => el.howDialog.showModal());
  el.closeHow.addEventListener("click", () => el.howDialog.close());
  el.howDialog.addEventListener("click", (e) => { if (e.target === el.howDialog) el.howDialog.close(); });
  el.navAction.addEventListener("click", () => { if (user) switchUser(); else $("#name").focus(); });

  function setSignedIn(on) {
    el.navLabel.textContent = on ? "Switch user" : "Get started";
    el.historyBtn.hidden = !on;
  }
  setSignedIn(false);

  function setFieldError(inputName, message) {
    const field = el.form.querySelector(`[name="${inputName}"]`).closest(".field");
    field.dataset.invalid = message ? "true" : "false";
    $(`#${inputName}Err`).textContent = message || "";
  }

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    el.formErr.textContent = "";
    const name = el.form.name.value.trim();
    const age = Number(el.form.age.value);
    const gender = (el.form.querySelector('input[name="gender"]:checked') || {}).value;

    setFieldError("name", name ? "" : "Enter your name.");
    setFieldError("age", Number.isInteger(age) && age >= 5 && age <= 120 ? "" : "Enter an age between 5 and 120.");
    setFieldError("gender", gender ? "" : "Choose one option.");
    const firstBad = el.form.querySelector('.field[data-invalid="true"]');
    if (firstBad) { (firstBad.querySelector("input")).focus(); return; }

    el.startBtn.disabled = true;
    try {
      const created = await api("/api/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, age, gender }),
      });
      rememberUser(created.id);
      enterApp(created, false);
    } catch (err) {
      el.formErr.textContent = err.message;
    } finally {
      el.startBtn.disabled = false;
    }
  });

  function rememberUser(id) {
    const ids = store.read("emoface.users", []).filter((x) => x !== id);
    ids.unshift(id);
    store.write("emoface.users", ids.slice(0, 5));
    store.write("emoface.active", id);
  }

  async function loadKnownUsers() {
    const ids = store.read("emoface.users", []);
    const found = (await Promise.all(ids.map((id) => api(`/api/users/${id}`).catch(() => null)))).filter(Boolean);
    if (!found.length) { el.knownBox.hidden = true; return; }
    el.knownList.innerHTML = found.map((u, i) =>
      `<div class="known-account"><button type="button" class="known-chip" data-id="${u.id}">${faceSVG(EMOTIONS[(u.id + i) % EMOTIONS.length])}${esc(u.name)}</button><button type="button" class="btn btn-danger-quiet known-delete" data-delete-id="${u.id}" aria-label="Delete account for ${esc(u.name)}">Delete account</button></div>`).join("");
    el.knownBox.hidden = false;
    $$(".known-chip", el.knownList).forEach((btn) => btn.addEventListener("click", () => {
      const u = found.find((x) => String(x.id) === btn.dataset.id);
      rememberUser(u.id);
      enterApp(u, true);
    }));
    $$(".known-delete", el.knownList).forEach((btn) => btn.addEventListener("click", async () => {
      const account = found.find((x) => String(x.id) === btn.dataset.deleteId);
      if (!account || !window.confirm(`Delete ${account.name}'s account and all saved history? This cannot be undone.`)) return;
      btn.disabled = true;
      el.knownErr.textContent = "";
      try {
        await api(`/api/users/${account.id}`, { method: "DELETE" });
        const ids = store.read("emoface.users", []).filter((id) => id !== account.id);
        store.write("emoface.users", ids);
        if (store.read("emoface.active", null) === account.id) store.write("emoface.active", null);
        await loadKnownUsers();
      } catch (err) {
        btn.disabled = false;
        el.knownErr.textContent = err.message;
      }
    }));
  }

  /* ---------- Greeting + entering the workspace ---------- */
  function greetingWord() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  async function enterApp(u, returning) {
    user = u;
    el.welcome.hidden = true;
    el.app.hidden = false;
    setSignedIn(true);
    el.greetTitle.textContent = `${greetingWord()}, ${u.name}.`;
    el.greetSub.textContent = returning
      ? "Good to see you again. Your saved history is waiting."
      : "Take a photo with the camera, or upload one, and EmoFace will read the expression.";
    whenReady(() => el.greetTitle.focus({ preventScroll: true }));
    window.scrollTo({ top: 0 });
    setStep("capture");
    resetAnalysis();
    refreshHistory();
    loadStatus();
    whenReady(startCamera);
  }

  async function loadStatus() {
    try {
      const s = await api("/api/status");
      if (!s.model_loaded && !s.demo_mode) {
        el.notice.textContent = "No trained model found yet. Train AlexNet with the Colab notebook, then put alexnet_emotion.pth in the models folder and restart the server.";
        el.notice.hidden = false;
      } else if (s.demo_mode) {
        el.notice.textContent = "Demo mode: results are random placeholders for testing the interface. Train and add the model for real predictions.";
        el.notice.hidden = false;
      } else {
        el.notice.hidden = true;
      }
    } catch { /* status is informational */ }
  }

  function switchUser() {
    stopCamera();
    resetAnalysis();
    user = null;
    store.write("emoface.active", null);
    el.app.hidden = true;
    setSignedIn(false);
    el.welcome.hidden = false;
    el.form.reset();
    $$(".field", el.form).forEach((f) => (f.dataset.invalid = "false"));
    $$(".field-err", el.form).forEach((p) => (p.textContent = ""));
    loadKnownUsers();
    $("#name").focus();
  }

  /* ---------- Steps ---------- */
  function setStep(step) {
    const order = ["capture", "confirm", "result"];
    el.steps.forEach((li) => {
      const idx = order.indexOf(li.dataset.step);
      li.classList.toggle("done", idx < order.indexOf(step));
      if (li.dataset.step === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }

  /* ---------- Camera ---------- */
  function camMessage(text, showRetry) {
    el.camMsgText.textContent = text;
    el.camRetry.hidden = !showRetry;
    el.camMsg.hidden = false;
    el.guide.hidden = true;
    el.liveDot.hidden = true;
    el.takeBtn.disabled = true;
  }

  async function startCamera() {
    if (stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camMessage("This browser can't open the camera here. Open EmoFace at http://127.0.0.1:5000, or upload a photo instead.", false);
      return;
    }
    camMessage("Starting the camera…", false);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      el.video.srcObject = stream;
      await el.video.play().catch(() => {});
      el.camMsg.hidden = true;
      el.guide.hidden = false;
      el.liveDot.hidden = false;
      el.takeBtn.disabled = !!pending;
    } catch (err) {
      stream = null;
      const text = err && err.name === "NotAllowedError"
        ? "Camera access is blocked. Allow the camera in the address bar, then press Try again."
        : err && err.name === "NotFoundError"
          ? "No camera found. Upload a photo instead."
          : "The camera could not start. Close other apps using it, then press Try again.";
      camMessage(text, err && err.name !== "NotFoundError");
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    el.video.srcObject = null;
  }

  el.camRetry.addEventListener("click", startCamera);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); else if (user && !el.app.hidden) startCamera(); });

  /* ---------- Photo: capture / upload -> preview ---------- */
  function setPending(blob) {
    clearPending();
    pending = { blob, url: URL.createObjectURL(blob) };
    el.photoImg.src = pending.url;
    el.faceBox.hidden = true;
    el.analyseErr.textContent = "";
    el.analysing.hidden = true;
    el.scan.hidden = true;
    el.confirmActions.hidden = false;
    el.confirmBtn.disabled = false;
    el.retakeBtn.disabled = false;
    el.takeBtn.disabled = true;
    el.camPanel.dataset.dim = "true";
    el.camPanel.inert = true;
    showState("preview");
    setStep("confirm");
    el.confirmBtn.focus({ preventScroll: false });
  }

  function clearPending() {
    if (pending) URL.revokeObjectURL(pending.url);
    pending = null;
  }

  function showState(state) {
    el.anaPanel.dataset.state = state;
    $$("[data-show]", el.anaPanel).forEach((node) => { node.hidden = !node.dataset.show.split(" ").includes(state); });
  }

  function resetAnalysis() {
    clearPending();
    el.photoImg.removeAttribute("src");
    el.faceBox.hidden = true;
    el.camPanel.dataset.dim = "false";
    el.camPanel.inert = false;
    el.takeBtn.disabled = !stream;
    showState("empty");
  }

  el.takeBtn.addEventListener("click", () => {
    const w = el.video.videoWidth, h = el.video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.translate(w, 0); ctx.scale(-1, 1); // match the mirrored preview
    ctx.drawImage(el.video, 0, 0, w, h);
    canvas.toBlob((blob) => blob && setPending(blob), "image/jpeg", 0.92);
  });

  el.upload.addEventListener("change", () => {
    const file = el.upload.files[0];
    el.upload.value = "";
    if (file) setPending(file);
  });

  el.retakeBtn.addEventListener("click", backToCamera);
  el.againBtn.addEventListener("click", backToCamera);

  function backToCamera() {
    resetAnalysis();
    setStep("capture");
    startCamera();
    if (!el.takeBtn.disabled) el.takeBtn.focus(); else $("#camTitle").focus?.();
  }

  /* ---------- Confirm -> detect -> save ---------- */
  el.confirmBtn.addEventListener("click", async () => {
    if (!pending || !user) return;
    el.analyseErr.textContent = "";
    el.confirmActions.hidden = true;
    el.analysing.hidden = false;
    el.scan.hidden = false;
    showState("analysing");

    const body = new FormData();
    body.append("image", pending.blob, "photo.jpg");
    body.append("user_id", user.id);
    try {
      const result = await api("/api/analyze", { method: "POST", body });
      renderResult(result);
      refreshHistory();
    } catch (err) {
      el.scan.hidden = true;
      el.analysing.hidden = true;
      el.confirmActions.hidden = false;
      el.analyseErr.textContent = err.message;
      showState("preview");
      if (err.status === 401) switchUser();
    }
  });

  function renderResult(r) {
    el.scan.hidden = true;
    el.camPanel.dataset.dim = "false";
    el.camPanel.inert = false;
    el.takeBtn.disabled = !stream;

    const box = r.box;
    Object.assign(el.faceBox.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
    el.faceBox.style.setProperty("--bx", `var(--e-${r.emotion})`);
    el.faceBox.hidden = false;

    el.uncertain.hidden = r.confidence >= 0.45;
    el.resultFace.innerHTML = faceSVG(r.emotion);
    el.resultEmotion.textContent = r.emotion;
    el.resultConf.textContent = `${pct(r.confidence)} confidence${r.demo ? " (demo value)" : ""}`;

    const rows = Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]);
    el.bars.innerHTML = rows.map(([name, p], i) =>
      `<li class="bar face-${name}${i === 0 ? " top" : ""}" style="--e:var(--e-${name})">
         <span class="bar-name">${esc(name)}</span>
         <span class="bar-track"><span class="bar-fill" data-w="${(p * 100).toFixed(1)}"></span></span>
         <span class="bar-val">${pct(p)}</span>
       </li>`).join("");
    showState("result");
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".bar-fill", el.bars).forEach((f) => (f.style.width = `${f.dataset.w}%`))));
    setStep("result");
  }

  /* ---------- History ---------- */
  async function refreshHistory() {
    if (!user) return;
    try {
      historyItems = await api(`/api/history?user_id=${user.id}`);
      el.historyCount.textContent = historyItems.length;
      if (el.historyDialog.open) renderHistory();
    } catch { /* keep the previous list */ }
  }

  function renderHistory() {
    const items = historyItems;
    el.historyEmpty.hidden = items.length > 0;
    el.clearAll.hidden = items.length === 0;
    disarmClear();

    if (!items.length) { el.historySummary.innerHTML = ""; el.historyList.innerHTML = ""; return; }

    const counts = {};
    items.forEach((i) => { counts[i.emotion] = (counts[i.emotion] || 0) + 1; });
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    el.historySummary.innerHTML =
      `<p class="mix-title">${items.length} detection${items.length === 1 ? "" : "s"} saved. Most common: ${esc(label(ranked[0][0]))}.</p>
       <div class="mix" role="img" aria-label="${esc(ranked.map(([e, n]) => `${e} ${n}`).join(", "))}">
         ${ranked.map(([e, n]) => `<span class="face-${e}" style="--e:var(--e-${e});flex:${n}"></span>`).join("")}
       </div>
       <ul class="mix-legend">${ranked.map(([e, n]) => `<li class="face-${e}" style="--e:var(--e-${e})">${esc(e)} ${n}</li>`).join("")}</ul>`;

    el.historyList.innerHTML = items.map((i) => {
      const when = new Date(i.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      return `<li class="h-item">
        <span class="h-thumb"><img src="${esc(i.image_url)}" alt="Photo taken ${esc(when)}" loading="lazy"></span>
        <div class="h-main">
          <p class="h-emotion">${faceSVG(i.emotion)}<span>${esc(i.emotion)}</span>${i.demo ? '<span class="badge">Demo</span>' : ""}</p>
          <p class="h-meta">${pct(i.confidence, 0)} confidence</p>
          <p class="h-meta">${esc(when)}</p>
        </div>
        <button type="button" class="icon-btn" data-del="${i.id}" aria-label="Delete the detection from ${esc(when)}">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </li>`;
    }).join("");
  }

  async function openHistory() {
    await refreshHistory();
    renderHistory();
    if (!el.historyDialog.open) el.historyDialog.showModal();
  }

  el.historyBtn.addEventListener("click", openHistory);
  el.openHistoryBtn.addEventListener("click", openHistory);
  el.closeHistory.addEventListener("click", () => el.historyDialog.close());
  el.historyDialog.addEventListener("click", (e) => { if (e.target === el.historyDialog) el.historyDialog.close(); });

  el.historyList.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    btn.disabled = true;
    try {
      await api(`/api/history/${btn.dataset.del}?user_id=${user.id}`, { method: "DELETE" });
      await refreshHistory();
      renderHistory();
    } catch (err) { btn.disabled = false; }
  });

  let clearTimer = null;
  function disarmClear() {
    clearTimeout(clearTimer);
    el.clearAll.dataset.armed = "false";
    el.clearAll.textContent = "Clear all history";
  }
  el.clearAll.addEventListener("click", async () => {
    if (el.clearAll.dataset.armed !== "true") {
      el.clearAll.dataset.armed = "true";
      el.clearAll.textContent = "Press again to delete everything";
      clearTimer = setTimeout(disarmClear, 4000);
      return;
    }
    disarmClear();
    try {
      await api(`/api/history?user_id=${user.id}`, { method: "DELETE" });
      await refreshHistory();
      renderHistory();
    } catch { /* leave the list as it was */ }
  });

  /* ---------- Boot ---------- */
  (async function boot() {
    const activeId = store.read("emoface.active", null);
    if (activeId) {
      try { enterApp(await api(`/api/users/${activeId}`), true); return; } catch { /* fall through to sign-in */ }
    }
    loadKnownUsers();
  })();
})();
