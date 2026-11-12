/* Gemstar Collab: Share Clip (used by track.html).
 *
 * Makes a vertical 9:16 video of the whole collab: the title, one moving
 * waveform row per person (named), the Gemstar logo and a QR code. It plays
 * the real mix once while recording it, then opens the phone's share menu
 * (or saves the file on desktop). Nothing is uploaded -- it is all made in
 * the browser.
 *
 * track.html provides the audio side as window.GemstarCollabHost:
 *   info()  -> { title, startPos, layers: [{ id, name }] }
 *   begin(fromPos) -> Promise of { ctx, dest, master, rows: [{ key, analyser }],
 *                                  startBase, dur, stop() }
 */
(function () {
  "use strict";
  var btn = document.getElementById("t-clip");
  if (!btn) return;

  var LOGO_SRC = "data:image/png;base64,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";
  var QR_ROWS = "1fdc2f7f,10524441,1749b45d,1758285d,174df25d,10424641,1fd5557f,11ce00,16ecd84b,13be1e71,47a4496,999c541,7510e2c,123db647,1dee5f67,e90b022,135c27ba,4a2a5ae,13c93cb4,59f3844,df5bffc,1fd51f,1fd39f5a,10523519,174469f4,17597bb9,17548c25,104777aa,1fd0b382".split(",");
  var COLORS = ["#00F5FF", "#FF2E88", "#FFE600", "#B05CFF", "#3CF2A0", "#FF8A3D"];
  var CW = 720, CH = 1280, FPS = 30;
  var clipSec = 15, busy = false, aborted = false;
  var clipBlob = null, clipUrl = null, clipName = "gemstar-collab.mp4";
  var logoImg = new Image(); logoImg.src = LOGO_SRC;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  /* ---------- styles + modal ---------- */
  var css = document.createElement("style");
  css.textContent =
    "#cc-overlay{display:none;position:fixed;inset:0;z-index:600;align-items:center;justify-content:center;padding:16px;background:rgba(6,6,12,.8);overflow-y:auto}" +
    "#cc-overlay.show{display:flex}" +
    ".cc-card{position:relative;width:100%;max-width:380px;max-height:calc(100vh - 32px);overflow-y:auto;background:var(--bg-panel);border:1px solid var(--line-strong);border-radius:14px;padding:24px 20px 20px;box-shadow:0 20px 60px rgba(0,0,0,.55)}" +
    ".cc-card h3{font-family:var(--font-display);font-size:1.1rem;margin:0 0 8px;color:var(--ink)}" +
    ".cc-x{position:absolute;top:8px;right:10px;background:none;border:0;color:var(--ink-muted);font-size:1.7rem;line-height:1;cursor:pointer;padding:6px 10px}" +
    ".cc-sub{color:var(--ink-muted);font-size:.86rem;line-height:1.5;margin:0 0 14px}" +
    ".cc-lbl{display:block;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);margin:12px 0 6px}" +
    ".cc-in{width:100%;padding:11px 14px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:.9rem;font-family:var(--font-body)}" +
    ".cc-in:focus{outline:none;border-color:var(--cyan)}" +
    ".cc-name{display:flex;align-items:center;gap:10px;margin-bottom:8px}" +
    ".cc-dot{width:12px;height:12px;border-radius:50%;flex:none}" +
    ".cc-lens{display:flex;gap:8px}" +
    ".cc-len{flex:1;padding:11px 0;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink-muted);font-family:var(--font-display);font-size:.9rem;cursor:pointer}" +
    ".cc-len.on{border-color:var(--cyan);color:var(--cyan);background:rgba(0,245,255,.08)}" +
    ".cc-hint{font-size:.74rem;color:var(--ink-muted);line-height:1.5;margin:10px 0 14px}" +
    ".cc-primary{width:100%;padding:13px 16px;border-radius:999px;border:0;cursor:pointer;color:#0A0A12;font-family:var(--font-display);font-weight:700;font-size:.95rem;background:linear-gradient(90deg,var(--cyan),var(--gem))}" +
    ".cc-ghost{flex:1;padding:10px 8px;border-radius:999px;border:1px solid var(--line-strong);background:transparent;color:var(--ink);font-size:.78rem;cursor:pointer;font-family:var(--font-body)}" +
    "#cc-busy .cc-ghost{width:100%;flex:none;margin-top:16px}" +
    ".cc-bar{height:8px;border-radius:4px;background:rgba(234,246,255,.12);overflow:hidden;margin:6px 0}" +
    "#cc-busy-bar{height:100%;width:0;background:linear-gradient(90deg,var(--cyan),var(--gem))}" +
    "#cc-video{display:block;width:100%;max-height:52vh;margin:0 auto 14px;border-radius:10px;background:#000;object-fit:contain}" +
    ".cc-plats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}" +
    ".cc-plat{padding:11px 8px;border-radius:10px;border:1px solid rgba(255,46,136,.35);background:rgba(255,46,136,.07);color:var(--ink);font-family:var(--font-display);font-size:.88rem;cursor:pointer}" +
    ".cc-row{display:flex;gap:8px}" +
    ".cc-msg{font-size:.78rem;color:var(--ok);margin:12px 0 0;min-height:1.2em;line-height:1.45}" +
    ".cc-msg.err{color:var(--danger)}";
  document.head.appendChild(css);

  var ov = document.createElement("div");
  ov.id = "cc-overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
  ov.innerHTML =
    '<div class="cc-card">' +
    '<button class="cc-x" id="cc-close" type="button" aria-label="Close">&times;</button>' +
    '<h3>Share Clip</h3>' +
    '<div id="cc-setup">' +
    '<p class="cc-sub">Make a vertical video of your collab with everyone\'s name on it, ready for TikTok, Instagram, YouTube and Reddit.</p>' +
    '<label class="cc-lbl" for="cc-title">Title on the video</label>' +
    '<input class="cc-in" id="cc-title" type="text" maxlength="60" placeholder="Song name" autocomplete="off">' +
    '<div class="cc-lbl">Names on the video</div>' +
    '<div id="cc-names"></div>' +
    '<div class="cc-lbl">Length</div>' +
    '<div class="cc-lens"><button type="button" class="cc-len on" data-sec="15">15s</button><button type="button" class="cc-len" data-sec="30">30s</button><button type="button" class="cc-len" data-sec="60">60s</button></div>' +
    '<p class="cc-hint">Starts from where your playhead is. It plays the mix out loud while it records, so a 15s clip takes about 15s.</p>' +
    '<button type="button" class="cc-primary" id="cc-make">Create clip</button>' +
    '<p class="cc-msg err" id="cc-err"></p>' +
    '</div>' +
    '<div id="cc-busy" hidden><p class="cc-sub" id="cc-busy-msg">Getting ready...</p><div class="cc-bar"><div id="cc-busy-bar"></div></div><button type="button" class="cc-ghost" id="cc-cancel">Cancel</button></div>' +
    '<div id="cc-done" hidden>' +
    '<video id="cc-video" controls playsinline preload="auto"></video>' +
    '<button type="button" class="cc-primary" id="cc-share">Share&hellip;</button>' +
    '<div class="cc-plats"><button type="button" class="cc-plat" data-plat="tiktok">TikTok</button><button type="button" class="cc-plat" data-plat="instagram">Instagram</button><button type="button" class="cc-plat" data-plat="youtube">YouTube</button><button type="button" class="cc-plat" data-plat="reddit">Reddit</button></div>' +
    '<div class="cc-row"><button type="button" class="cc-ghost" id="cc-save">Save video</button><button type="button" class="cc-ghost" id="cc-copy">Copy caption</button><button type="button" class="cc-ghost" id="cc-redo">Make another</button></div>' +
    '<p class="cc-msg" id="cc-doneMsg"></p>' +
    '</div></div>';
  document.body.appendChild(ov);

  var elSetup = $("cc-setup"), elBusy = $("cc-busy"), elDone = $("cc-done");
  function step(s) { elSetup.hidden = s !== "setup"; elBusy.hidden = s !== "busy"; elDone.hidden = s !== "done"; }
  function err(t) { $("cc-err").textContent = t || ""; }
  var lenBtns = ov.querySelectorAll(".cc-len");
  lenBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      clipSec = parseInt(b.getAttribute("data-sec"), 10);
      lenBtns.forEach(function (x) { x.classList.toggle("on", x === b); });
    });
  });

  var HOST_KEY = "gemstar_clip_hostname";
  function buildNames(info) {
    var box = $("cc-names"); box.textContent = "";
    var hostName = "";
    try { hostName = localStorage.getItem(HOST_KEY) || ""; } catch (e) {}
    var rows = [{ key: "beat", name: hostName, ph: "Your name" }].concat(info.layers.map(function (l) { return { key: l.id, name: l.name, ph: "Name" }; }));
    rows.forEach(function (r, i) {
      var w = document.createElement("div"); w.className = "cc-name";
      var d = document.createElement("span"); d.className = "cc-dot"; d.style.background = COLORS[i % COLORS.length];
      var inp = document.createElement("input"); inp.className = "cc-in"; inp.type = "text"; inp.maxLength = 24;
      inp.placeholder = r.ph; inp.value = r.name; inp.setAttribute("data-key", r.key);
      w.appendChild(d); w.appendChild(inp); box.appendChild(w);
    });
  }
  function readNames() {
    var map = {};
    ov.querySelectorAll("#cc-names input").forEach(function (i) { map[i.getAttribute("data-key")] = i.value.trim(); });
    try { localStorage.setItem(HOST_KEY, map.beat || ""); } catch (e) {}
    return map;
  }

  function open() {
    var host = window.GemstarCollabHost;
    if (!host) return;
    ov.classList.add("show");
    if (busy) return;
    var info = host.info();
    if (!$("cc-title").value) $("cc-title").value = info.title || "";
    if (clipBlob) { step("done"); return; }
    buildNames(info); err(""); step("setup");
  }
  function close() {
    ov.classList.remove("show");
    if (busy) aborted = true;
    try { $("cc-video").pause(); } catch (e) {}
  }
  btn.addEventListener("click", open);
  $("cc-close").addEventListener("click", close);
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });

  /* ---------- drawing ---------- */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function wrapText(c, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && c.measureText(last + "...").width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "...";
    }
    return lines;
  }
  var qrCard = (function () {
    var n = QR_ROWS.length, cell = 4, pad = 16, size = n * cell + pad * 2;
    var cv = document.createElement("canvas"); cv.width = size; cv.height = size;
    var x = cv.getContext("2d");
    x.fillStyle = "#FFFFFF"; rr(x, 0, 0, size, size, 18); x.fill();
    x.fillStyle = "#0A0A12";
    for (var r = 0; r < n; r++) {
      var bits = parseInt(QR_ROWS[r], 16).toString(2); while (bits.length < n) bits = "0" + bits;
      for (var k = 0; k < n; k++) if (bits.charAt(k) === "1") x.fillRect(pad + k * cell, pad + r * cell, cell, cell);
    }
    return cv;
  })();

  /* ---------- make the clip ---------- */
  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var c = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return "";
  }

  function make() {
    if (busy) return;
    var host = window.GemstarCollabHost, mime = pickMime();
    if (!host) return;
    if (!mime) { err("This browser can't record video. Try Chrome or Safari."); return; }
    var info = host.info();
    if (!info.layers.length) { err("Accept at least one layer first, then make your clip."); return; }
    var names = readNames();
    var title = ($("cc-title").value || "").trim() || "My Gemstar collab";
    clipName = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "gemstar-collab");
    err(""); busy = true; aborted = false; step("busy");
    $("cc-busy-msg").textContent = "Getting ready..."; $("cc-busy-bar").style.width = "0%";

    var canvas = document.createElement("canvas"); canvas.width = CW; canvas.height = CH;
    var c = canvas.getContext("2d");
    var h = null, rec = null, chunks = [], raf = 0, guard = 0, waitTimer = 0, started = false, t0 = 0, len = clipSec;
    var NB = 44, hist = [], lvl = [], bufs = [], lastPush = 0;

    function cleanup() {
      cancelAnimationFrame(raf); clearTimeout(guard); clearInterval(waitTimer);
      try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) {}
      try { if (h) h.stop(); } catch (e) {}
      busy = false;
    }
    function fail(t) { cleanup(); step("setup"); err(t); }

    function drawFrame(elapsed) {
      var n = h.rows.length, i, j;
      if (elapsed - lastPush >= 1 / FPS - 0.001 || !lastPush) {
        lastPush = elapsed;
        for (i = 0; i < n; i++) {
          var an = h.rows[i].analyser, b = bufs[i], sum = 0;
          try { an.getFloatTimeDomainData(b); } catch (e) {}
          for (j = 0; j < b.length; j++) sum += b[j] * b[j];
          var v = Math.min(1, Math.sqrt(sum / b.length) * 5);
          lvl[i] = Math.max(v, lvl[i] * 0.7);
          hist[i].shift(); hist[i].push(lvl[i]);
        }
      }
      // background
      c.fillStyle = "#0A0A12"; c.fillRect(0, 0, CW, CH);
      var tot = 0; for (i = 0; i < n; i++) tot += lvl[i]; tot = n ? tot / n : 0;
      var g1 = c.createRadialGradient(CW / 2, 600, 20, CW / 2, 600, 560);
      g1.addColorStop(0, "rgba(255,46,136," + (0.16 + tot * 0.4).toFixed(3) + ")"); g1.addColorStop(1, "rgba(255,46,136,0)");
      c.fillStyle = g1; c.fillRect(0, 0, CW, CH);
      var g2 = c.createRadialGradient(80, 140, 10, 80, 140, 520);
      g2.addColorStop(0, "rgba(0,245,255,0.16)"); g2.addColorStop(1, "rgba(0,245,255,0)");
      c.fillStyle = g2; c.fillRect(0, 0, CW, CH);

      // title
      c.textAlign = "center"; c.textBaseline = "alphabetic";
      c.fillStyle = "#EAF6FF"; c.font = "700 60px 'Chakra Petch', 'Segoe UI', sans-serif";
      var lines = wrapText(c, title, CW - 120, 3);
      var ty = 190 - (lines.length - 1) * 34;
      for (var li = 0; li < lines.length; li++) c.fillText(lines[li], CW / 2, ty + li * 70);

      // pill
      var pw = 400, ph = 66, px = (CW - pw) / 2, py = 350;
      var pg = c.createLinearGradient(px, 0, px + pw, 0); pg.addColorStop(0, "#00F5FF"); pg.addColorStop(1, "#FF2E88");
      rr(c, px, py, pw, ph, 33); c.fillStyle = "rgba(10,10,18,0.55)"; c.fill(); c.lineWidth = 3; c.strokeStyle = pg; c.stroke();
      c.fillStyle = "#EAF6FF"; c.font = "700 30px 'Chakra Petch', 'Segoe UI', sans-serif";
      c.fillText("MADE TOGETHER", CW / 2, py + 44);

      // one row per person
      var shown = Math.min(n, 6), rowH = Math.min(120, Math.floor(400 / Math.max(1, shown)));
      var top = 640 - shown * rowH / 2, slot = 600 / NB, bw = slot * 0.6;
      for (i = 0; i < shown; i++) {
        var y = top + i * rowH, col = COLORS[i % COLORS.length];
        var nm = (names[h.rows[i].key] || (h.rows[i].key === "beat" ? "Host" : "Guest")).toUpperCase();
        c.textAlign = "left"; c.font = "700 26px 'Chakra Petch', 'Segoe UI', sans-serif";
        c.globalAlpha = 0.55 + 0.45 * Math.min(1, lvl[i] * 1.5); c.fillStyle = col;
        c.fillText(nm, 60, y + 26); c.globalAlpha = 1;
        var cy = y + 26 + (rowH - 26) / 2, maxBar = Math.max(10, rowH - 40);
        c.fillStyle = col;
        for (j = 0; j < NB; j++) {
          var bh = 4 + hist[i][j] * maxBar;
          c.globalAlpha = 0.25 + 0.75 * (j / NB);
          rr(c, 60 + j * slot + (slot - bw) / 2, cy - bh / 2, bw, bh, bw / 2); c.fill();
        }
        c.globalAlpha = 1;
      }
      c.textAlign = "center";

      // progress
      var pr = Math.max(0, Math.min(1, elapsed / len));
      var bg = c.createLinearGradient(60, 0, 660, 0); bg.addColorStop(0, "#00F5FF"); bg.addColorStop(0.55, "#B05CFF"); bg.addColorStop(1, "#FF2E88");
      rr(c, 60, 850, CW - 120, 6, 3); c.fillStyle = "rgba(234,246,255,0.14)"; c.fill();
      if (pr > 0.01) { rr(c, 60, 850, (CW - 120) * pr, 6, 3); c.fillStyle = bg; c.fill(); }

      // watermark: Gemstar logo lockup + QR code
      if (logoImg.complete && logoImg.naturalWidth) {
        var lw = 180, lh = lw * logoImg.naturalHeight / logoImg.naturalWidth;
        c.globalAlpha = 0.96; c.drawImage(logoImg, 90, 892, lw, lh); c.globalAlpha = 1;
      } else {
        c.fillStyle = "#EAF6FF"; c.font = "700 48px 'Chakra Petch', sans-serif"; c.textAlign = "left"; c.fillText("GEMSTAR", 90, 980); c.textAlign = "center";
      }
      c.drawImage(qrCard, 450, 902);
      c.fillStyle = "#EAF6FF"; c.font = "700 22px 'Chakra Petch', 'Segoe UI', sans-serif";
      c.fillText("SCAN TO TRY", 450 + qrCard.width / 2, 902 + qrCard.height + 34);
      c.fillStyle = "#FFFFFF"; c.font = "700 38px 'Chakra Petch', 'Segoe UI', sans-serif";
      c.fillText("MADE WITH GEMSTAR AUDIO", CW / 2, 1154);
      c.fillStyle = "#B6BBC8"; c.font = "600 26px 'Manrope', 'Segoe UI', sans-serif";
      c.fillText("gemstaraudio.com", CW / 2, 1204);
    }

    Promise.resolve().then(function () {
      try { return document.fonts && document.fonts.load("700 60px 'Chakra Petch'"); } catch (e) {}
    }).catch(function () {}).then(function () {
      if (aborted) { cleanup(); return; }
      return host.begin(info.startPos);
    }).then(function (handle) {
      if (!handle) { if (busy) fail("Couldn't start playback. Try again."); return; }
      h = handle;
      if (aborted) { cleanup(); return; }
      len = Math.min(clipSec, h.dur);
      h.rows.forEach(function (r, i) { hist.push(new Array(NB).fill(0)); lvl.push(0); bufs.push(new Float32Array(r.analyser.fftSize)); });
      var waited = 0;
      waitTimer = setInterval(function () {
        waited += 10;
        if (aborted) { cleanup(); return; }
        if (started) return;
        $("cc-busy-msg").textContent = "Recording your clip - keep this screen open";
        if (h.ctx.currentTime < h.startBase - 0.03) { if (waited > 5000) fail("Couldn't start playback. Try again."); return; }
        started = true; clearInterval(waitTimer);
        try {
          t0 = h.ctx.currentTime;
          h.master.gain.setValueAtTime(0, t0);
          h.master.gain.linearRampToValueAtTime(1, t0 + 0.05);
          h.master.gain.setValueAtTime(1, t0 + len - 0.7);
          h.master.gain.linearRampToValueAtTime(0, t0 + len);
          var vs = canvas.captureStream(FPS);
          var stream = new MediaStream(vs.getVideoTracks().concat(h.dest.stream.getAudioTracks()));
          rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000, audioBitsPerSecond: 192000 });
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.onstop = function () {
            if (aborted) return;
            var type = (mime.split(";")[0]) || "video/mp4";
            var blob = new Blob(chunks, { type: type });
            cleanup();
            if (!blob.size) { step("setup"); err("The clip came out empty. Please try again."); return; }
            if (clipUrl) { try { URL.revokeObjectURL(clipUrl); } catch (e) {} }
            clipBlob = blob; clipUrl = URL.createObjectURL(blob);
            clipName += (type.indexOf("mp4") >= 0 ? ".mp4" : ".webm");
            $("cc-video").src = clipUrl; $("cc-doneMsg").textContent = "";
            step("done");
          };
          rec.start(250);
        } catch (e2) { fail("Couldn't start recording: " + (e2 && e2.message || e2)); return; }
        var loop = function () {
          var elapsed = Math.max(0, h.ctx.currentTime - t0);
          if (aborted) { cleanup(); return; }
          drawFrame(Math.min(elapsed, len));
          $("cc-busy-bar").style.width = Math.min(100, elapsed / len * 100).toFixed(1) + "%";
          if (elapsed >= len) { try { rec.stop(); } catch (e3) { cleanup(); } return; }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        guard = setTimeout(function () { if (busy) fail("That took too long. Keep this tab in front and try again."); }, (len + 8) * 1000);
      }, 10);
    }).catch(function (e) { if (busy) fail("Couldn't build the clip: " + (e && e.message || e)); });
  }
  $("cc-make").addEventListener("click", make);
  $("cc-cancel").addEventListener("click", function () { aborted = true; step("setup"); });

  /* ---------- sharing ---------- */
  function captionText() {
    var t = ($("cc-title").value || "").trim();
    var others = []; ov.querySelectorAll("#cc-names input").forEach(function (i, k) { if (k > 0 && i.value.trim()) others.push(i.value.trim()); });
    return (t ? t + " - " : "") + "made together on Gemstar" + (others.length ? " with " + others.join(", ") : "") +
      ". Record on friends' tracks from anywhere. gemstaraudio.com #Gemstar #collab #M5tar #Gemsquad #newmusic";
  }
  function fileForShare() {
    if (!clipBlob) return null;
    try { var f = new File([clipBlob], clipName, { type: clipBlob.type }); if (navigator.canShare && navigator.canShare({ files: [f] })) return f; } catch (e) {}
    return null;
  }
  function saveVideo() {
    if (!clipUrl) return;
    var a = document.createElement("a"); a.href = clipUrl; a.download = clipName;
    document.body.appendChild(a); a.click(); setTimeout(function () { document.body.removeChild(a); }, 500);
  }
  function copyCaption() {
    var t = captionText();
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).catch(function () {}); return true; } } catch (e) {}
    try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); return true; } catch (e2) {}
    return false;
  }
  function nativeShare(hint) {
    var f = fileForShare(); if (!f) return false;
    $("cc-doneMsg").textContent = hint || "";
    navigator.share({ files: [f], title: "Gemstar collab", text: captionText() }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      $("cc-doneMsg").textContent = "Couldn't open the share menu. Use Save video instead.";
    });
    return true;
  }
  var PLATS = {
    tiktok: { name: "TikTok", url: "https://www.tiktok.com/upload" },
    instagram: { name: "Instagram", url: "https://www.instagram.com/" },
    youtube: { name: "YouTube", url: "https://studio.youtube.com/" },
    reddit: { name: "Reddit", url: function () { return "https://www.reddit.com/submit?title=" + encodeURIComponent(($("cc-title").value || "").trim() || "Made together on Gemstar"); } }
  };
  $("cc-share").addEventListener("click", function () {
    if (!nativeShare("")) { saveVideo(); copyCaption(); $("cc-doneMsg").textContent = "Saved to your device and caption copied. Upload it from your favorite app."; }
  });
  ov.querySelectorAll(".cc-plat").forEach(function (b) {
    b.addEventListener("click", function () {
      var p = PLATS[b.getAttribute("data-plat")]; if (!p) return;
      if (nativeShare("In the menu, pick " + p.name + ".")) return;
      window.open(typeof p.url === "function" ? p.url() : p.url, "_blank", "noopener");
      saveVideo(); copyCaption();
      $("cc-doneMsg").textContent = "Video saved and caption copied. Upload it on " + p.name + " (opened in a new tab).";
    });
  });
  $("cc-save").addEventListener("click", function () { saveVideo(); $("cc-doneMsg").textContent = "Saved to your device."; });
  $("cc-copy").addEventListener("click", function () { $("cc-doneMsg").textContent = copyCaption() ? "Caption copied." : "Couldn't copy the caption."; });
  $("cc-redo").addEventListener("click", function () {
    clipBlob = null; var host = window.GemstarCollabHost; if (host) buildNames(host.info()); err(""); step("setup");
  });
})();
