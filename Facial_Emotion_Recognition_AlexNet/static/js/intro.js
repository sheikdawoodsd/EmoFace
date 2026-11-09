/* EmoFace intro: a 5-second animation of a wireframe face being scanned.
   Timeline: grid and HUD rings 0-1.3s, mesh draws in 0.4-2.6s, scan sweeps 1.2-4.2s,
   wordmark 3.0s, site fades in at 4.3s and the intro is gone at 5.0s.
   Skippable (button or Escape). Skipped automatically with ?nointro or reduced motion. */
(() => {
  "use strict";

  const body = document.body;
  const root = document.documentElement;
  const intro = document.getElementById("intro");
  const site = document.getElementById("site");
  const canvas = document.getElementById("introCanvas");
  const title = document.getElementById("introTitle");
  const skip = document.getElementById("introSkip");
  const params = new URLSearchParams(location.search);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LEAVE_AT = 4300; // ms: the site starts to appear; the intro is gone 700ms later

  function markReady() {
    root.dataset.introDone = "1";
    body.classList.remove("is-intro");
    site.inert = false;
    site.classList.add("ready");
    document.dispatchEvent(new Event("emoface:ready"));
  }

  const ctx = canvas.getContext && canvas.getContext("2d");
  if (params.has("nointro") || reduceMotion || !ctx) {
    intro.remove();
    markReady();
    return;
  }

  intro.setAttribute("role", "dialog");
  intro.setAttribute("aria-modal", "true");
  intro.setAttribute("aria-label", "EmoFace intro");
  site.inert = true;
  skip.focus({ preventScroll: true });

  /* ---------- the face mesh: hand-placed landmarks, triangulated at load ---------- */
  const seeded = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const rnd = seeded(11);
  const pts = [];
  const outline = [];
  const OUT = 36;
  for (let i = 0; i < OUT; i++) {
    const a = -Math.PI / 2 + (i / OUT) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const taper = s > 0 ? 1 - 0.30 * s * s - 0.08 * s : 1 - 0.05 * s * s; // narrower towards the chin
    const p = [0.5 + 0.27 * c * taper, 0.5 + 0.40 * s];
    outline.push(p); pts.push(p);
  }
  const ring = (cx, cy, rx, ry, n) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } };
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) { const t = k / 4; pts.push([0.5 + side * (0.07 + t * 0.14), 0.345 - Math.sin(t * Math.PI) * 0.024 + t * 0.014]); } // brow
    ring(0.5 + side * 0.115, 0.415, 0.052, 0.02, 8);                                                                                           // eye
    pts.push([0.5 + side * 0.115, 0.415]);                                                                                                       // pupil
  }
  pts.push(
    [0.5, 0.40], [0.5, 0.46], [0.5, 0.52], [0.5, 0.575], [0.46, 0.597], [0.54, 0.597], [0.435, 0.565], [0.565, 0.565], [0.47, 0.54], [0.53, 0.54], // nose
    [0.42, 0.69], [0.46, 0.688], [0.5, 0.69], [0.54, 0.688], [0.58, 0.69],                                                                          // lip line
    [0.5, 0.79], [0.43, 0.765], [0.57, 0.765], [0.5, 0.86],                                                                                         // chin
    [0.33, 0.52], [0.67, 0.52], [0.30, 0.62], [0.70, 0.62], [0.36, 0.72], [0.64, 0.72], [0.27, 0.45], [0.73, 0.45],                                // cheeks
    [0.5, 0.22], [0.4, 0.24], [0.6, 0.24], [0.33, 0.29], [0.67, 0.29], [0.45, 0.305], [0.55, 0.305]                                                 // forehead
  );
  ring(0.5, 0.69, 0.095, 0.03, 12); // mouth

  const inside = (x, y, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let tries = 0, added = 0; tries < 600 && added < 26; tries++) { // scatter fill, kept apart
    const x = 0.2 + rnd() * 0.6, y = 0.14 + rnd() * 0.72;
    if (!inside(x, y, outline.map(([a, b]) => [0.5 + (a - 0.5) * 0.9, 0.5 + (b - 0.5) * 0.9]))) continue;
    if (pts.some(([a, b]) => Math.hypot(a - x, b - y) < 0.045)) continue;
    pts.push([x, y]); added++;
  }

  function inCircle(a, b, c, px, py) {
    const ax = a[0] - px, ay = a[1] - py, bx = b[0] - px, by = b[1] - py, cx = c[0] - px, cy = c[1] - py;
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
    const orient = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return orient > 0 ? det > 0 : det < 0;
  }
  function triangulate(points) { // Bowyer-Watson
    const n = points.length;
    const P = points.concat([[-10, -10], [10, -10], [0, 10]]);
    let tris = [[n, n + 1, n + 2]];
    for (let i = 0; i < n; i++) {
      const [px, py] = P[i];
      const bad = tris.filter((t) => inCircle(P[t[0]], P[t[1]], P[t[2]], px, py));
      const edges = new Map();
      for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
      tris = tris.filter((t) => !bad.includes(t));
      for (const [k, count] of edges) if (count === 1) { const [a, b] = k.split(",").map(Number); tris.push([a, b, i]); }
    }
    return tris.filter((t) => t.every((v) => v < n));
  }

  const edgeSet = new Map();
  for (const [a, b, c] of triangulate(pts)) {
    const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3, cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
    if (!inside(cx, cy, outline)) continue;
    const longest = Math.max(Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]), Math.hypot(pts[b][0] - pts[c][0], pts[b][1] - pts[c][1]), Math.hypot(pts[c][0] - pts[a][0], pts[c][1] - pts[a][1]));
    if (longest > 0.24) continue;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) edgeSet.set(u < v ? `${u},${v}` : `${v},${u}`, [Math.min(u, v), Math.max(u, v)]);
  }
  const edges = [...edgeSet.values()].sort((e1, e2) => (pts[e1[0]][1] + pts[e1[1]][1]) - (pts[e2[0]][1] + pts[e2[1]][1]));

  /* ---------- drawing ---------- */
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const clamp = (x) => Math.min(1, Math.max(0, x));
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const pop = (x) => { const c = 1.7; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const DEG = Math.PI / 180;

  function scanY(t) {
    if (t < 1.2) return null;
    const down = (t - 1.2) / 1.7;
    if (down <= 1) return 0.1 + 0.82 * down;
    const up = (t - 2.9) / 1.4;
    return up <= 1 ? 0.92 - 0.82 * up : null;
  }

  function arc(cx, cy, r, from, to, width, color, glow, dash) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, from, to);
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = "round";
    if (glow) { ctx.shadowColor = "#3B8BFF"; ctx.shadowBlur = glow; }
    if (dash) ctx.setLineDash(dash);
    ctx.stroke(); ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const S = Math.min(W * 0.92, H * 0.84);
    const cx = W / 2, cy = H * 0.43;
    const ox = cx - S / 2, oy = cy - S / 2;
    const P = ([x, y]) => [ox + x * S, oy + y * S];

    // soft glow behind the face
    const glowA = clamp(t / 1.6) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, S * 0.05, cx, cy, S * 0.5);
    g.addColorStop(0, `rgba(80,140,255,${glowA})`); g.addColorStop(1, "rgba(80,140,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // HUD rings: thick blue arcs sweep in on both sides, thin arcs and dashed arcs rotate slowly
    const sweep = easeOut(clamp((t - 0.15) / 1.1));
    const wobble = Math.sin(t * 1.4) * 4 * DEG * clamp((t - 1.2) / 1);
    for (const side of [0, 1]) {
      const mid = (side ? 180 : 0) * DEG + (side ? -wobble : wobble);
      const half = 38 * DEG * sweep;
      arc(cx, cy, S * 0.56, mid - half, mid + half, S * 0.017, "#1E90FF", 14);
      const half2 = 22 * DEG * easeOut(clamp((t - 0.5) / 1));
      arc(cx, cy, S * 0.50, mid - half2, mid + half2, S * 0.006, "rgba(130,200,255,.85)", 0);
      const half3 = 30 * DEG * easeOut(clamp((t - 0.3) / 1.2));
      arc(cx, cy, S * 0.73, mid - half3, mid + half3, 2, "rgba(60,150,255,.9)", 6);
    }
    const dashA = clamp((t - 0.4) / 1);
    for (const base of [200, 20]) {
      const rot = (base + t * 14) * DEG;
      arc(cx, cy, S * 0.62, rot, rot + 80 * DEG, 2.5, `rgba(150,205,255,${0.8 * dashA})`, 0, [S * 0.012, S * 0.02]);
    }

    // mesh edges draw in from the forehead down
    ctx.lineWidth = Math.max(1, S * 0.0016);
    const sy = scanY(t);
    const E = edges.length;
    for (let i = 0; i < E; i++) {
      const p = clamp((t - (0.5 + 1.9 * (i / E))) / 0.4);
      if (p <= 0) continue;
      const [ax, ay] = P(pts[edges[i][0]]), [bx, by] = P(pts[edges[i][1]]);
      const my = (pts[edges[i][0]][1] + pts[edges[i][1]][1]) / 2;
      const hot = sy === null ? 0 : clamp(1 - Math.abs(my - sy) / 0.06);
      ctx.strokeStyle = `rgba(${130 + hot * 110},${185 - hot * 20},255,${0.42 * p + hot * 0.5})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * p, ay + (by - ay) * p); ctx.stroke();
    }

    // nodes pop in, and flare as the scan passes
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = P(pts[i]);
      const k = pop((t - (0.4 + 1.9 * pts[i][1])) / 0.35);
      if (k <= 0) continue;
      const hot = sy === null ? 0 : clamp(1 - Math.abs(pts[i][1] - sy) / 0.05);
      ctx.fillStyle = hot > 0.05 ? `rgba(255,${160 + (1 - hot) * 80},${210 + (1 - hot) * 45},1)` : "#BFE0FF";
      ctx.shadowColor = hot > 0.05 ? "#FF6FAE" : "#5AA2FF"; ctx.shadowBlur = 6 + hot * 14;
      ctx.beginPath(); ctx.arc(px, py, S * 0.0058 * k * (1 + hot * 0.9), 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // the scan line
    if (sy !== null) {
      const y = oy + sy * S, x1 = ox + 0.16 * S, x2 = ox + 0.84 * S;
      const band = ctx.createLinearGradient(0, y - S * 0.05, 0, y + S * 0.05);
      band.addColorStop(0, "rgba(255,111,174,0)"); band.addColorStop(0.5, "rgba(255,111,174,.22)"); band.addColorStop(1, "rgba(255,111,174,0)");
      ctx.fillStyle = band; ctx.fillRect(x1, y - S * 0.05, x2 - x1, S * 0.1);
      const line = ctx.createLinearGradient(x1, 0, x2, 0);
      line.addColorStop(0, "rgba(255,111,174,0)"); line.addColorStop(0.5, "rgba(255,150,200,1)"); line.addColorStop(1, "rgba(255,111,174,0)");
      ctx.strokeStyle = line; ctx.lineWidth = 2.5; ctx.shadowColor = "#FF6FAE"; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.shadowBlur = 0;
    }
  }

  /* ---------- run ---------- */
  let t0 = 0, raf = 0, leaving = false, removed = false;
  function leave() {
    if (leaving) return;
    leaving = true;
    intro.classList.add("is-leaving");
    markReady();
    setTimeout(() => { removed = true; cancelAnimationFrame(raf); intro.remove(); window.removeEventListener("resize", resize); }, 800);
  }
  function frame(now) {
    if (!t0) t0 = now;
    const elapsed = now - t0;
    draw(elapsed / 1000);
    if (elapsed > 3000) title.classList.add("show");
    if (elapsed >= LEAVE_AT) leave();
    if (!removed) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  skip.addEventListener("click", leave);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !leaving) leave(); });
})();
