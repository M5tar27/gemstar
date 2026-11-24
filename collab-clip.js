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
        var lw = 200, lh = lw * logoImg.naturalHeight / logoImg.naturalWidth;
        c.globalAlpha = 0.96; c.drawImage(logoImg, 90, 892, lw, lh); c.globalAlpha = 1;
      } else {
        c.fillStyle = "#EAF6FF"; c.font = "700 48px 'Chakra Petch', sans-serif"; c.textAlign = "left"; c.fillText("GEMSTAR", 90, 980); c.textAlign = "center";
      }
      c.drawImage(qrCard, 450, 902);
      c.fillStyle = "#EAF6FF"; c.font = "700 22px 'Chakra Petch', 'Segoe UI', sans-serif";
      c.fillText("SCAN TO TRY", 450 + qrCard.width / 2, 902 + qrCard.height + 34);
      c.fillStyle = "#FFFFFF"; c.font = "700 38px 'Chakra Petch', 'Segoe UI', sans-serif";
      c.fillText("MADE WITH GEMSTAR AUDIO", CW / 2, 1154);
      c.fillStyle = "#FFFFFF"; c.font = "600 26px 'Manrope', 'Segoe UI', sans-serif";
      c.fillText("gemstaraudio.com", CW / 2, 1204);

      // light watermark across the top of every frame -- small, semi-transparent,
      // away from the platforms' bottom/side UI, and separate from the
      // bigger lockup below so a crop of the footer doesn't strip it
      c.save(); c.textAlign = "center"; c.textBaseline = "alphabetic"; c.globalAlpha = 0.55;
      var wmg = c.createLinearGradient(CW / 2 - 120, 0, CW / 2 + 120, 0); wmg.addColorStop(0, "#00F5FF"); wmg.addColorStop(1, "#FF2E88");
      c.fillStyle = wmg; c.font = "700 22px 'Chakra Petch', 'Segoe UI', sans-serif";
      try { if ("letterSpacing" in c) c.letterSpacing = "4px"; } catch(e){}
      c.fillText("GEMSTAR AUDIO", CW / 2, 54);
      c.restore();
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
