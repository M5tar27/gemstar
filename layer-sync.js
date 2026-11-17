/* Gemstar layer sync + level helpers (used by join.html when a guest records).
 *
 *  - gatedRms:     loudness of the parts of a signal that actually have sound
 *                  (ignores silence/breaths between phrases).
 *  - levelGain:    gain that makes a vocal sit at the track's loudness (a touch
 *                  under it), without clipping and without boosting a near-silent
 *                  take into noise.
 *  - measureLag:   if the track leaked into the mic (speakers), cross-correlates
 *                  the recording with the track to find the real round-trip delay.
 *  - encodeWav16:  mono 16-bit WAV (decodes everywhere, unlike WebM on Safari).
 *
 * Pure JS, no dependencies; works in the browser (window.GemstarSync) and Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GemstarSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VOCAL_UNDER_TRACK_DB = 0;   // vocal loudness = track loudness (raise to sit it lower)
  var MAX_GAIN = 8;               // +18 dB cap so a whisper isn't boosted into hiss
  var MIN_GAIN = 0.1;

  function toMono(chans) {
    if (chans.length === 1) return chans[0];
    var n = chans[0].length, out = new Float32Array(n), c, i;
    for (i = 0; i < n; i++) { var s = 0; for (c = 0; c < chans.length; c++) s += chans[c][i]; out[i] = s / chans.length; }
    return out;
  }

  // Mean power of 400 ms blocks above an absolute gate (-50 dBFS) and a relative
  // gate (10 dB under the average of the kept blocks). Returns RMS, or 0 if silent.
  function gatedRms(data, sr) {
    var win = Math.max(1, Math.round(sr * 0.4)), pows = [], i, j;
    for (i = 0; i + win <= data.length; i += win) {
      var s = 0; for (j = i; j < i + win; j++) s += data[j] * data[j];
      pows.push(s / win);
    }
    if (!pows.length) { // shorter than one block: use what there is
      var t = 0; for (j = 0; j < data.length; j++) t += data[j] * data[j];
      var p = data.length ? t / data.length : 0;
      return p > 1e-5 ? Math.sqrt(p) : 0;
    }
    var kept = pows.filter(function (p) { return p > 1e-5; });
    if (!kept.length) return 0;
    var mean = kept.reduce(function (a, b) { return a + b; }, 0) / kept.length;
    var rel = kept.filter(function (p) { return p >= mean * 0.1; });
    if (!rel.length) rel = kept;
    return Math.sqrt(rel.reduce(function (a, b) { return a + b; }, 0) / rel.length);
  }

  function peakOf(data) { var m = 0; for (var i = 0; i < data.length; i++) { var a = Math.abs(data[i]); if (a > m) m = a; } return m; }

  // -> { gain, matched, reason }
  function levelGain(trackRms, vocalRms, vocalPeak) {
    if (!(trackRms > 0) || !(vocalRms > 0)) return { gain: 1, matched: false, reason: "no-reference" };
    var target = trackRms * Math.pow(10, -VOCAL_UNDER_TRACK_DB / 20);
    var g = target / vocalRms;
    g = Math.min(Math.max(g, MIN_GAIN), MAX_GAIN);
    if (vocalPeak > 0) g = Math.min(g, 0.97 / vocalPeak); // never clip
    return { gain: g, matched: true, reason: "ok" };
  }

  function decimate(data, factor, start, len) {
    var n = Math.floor(len / factor), out = new Float32Array(n), i, j;
    for (i = 0; i < n; i++) { var s = 0, b = start + i * factor; for (j = 0; j < factor; j++) s += data[b + j]; out[i] = s / factor; }
    return out;
  }

  /**
   * How late does the recording hear the track? rec[n] ~ track[n - lag].
   * rec and track share the same time origin (track t=0 at sample 0).
   * Returns { lagMs, confidence } or null if the track isn't audible in the mic.
   * Analyzes a ~16 s window around the loudest part of the track.
   */
  function measureLag(rec, track, sr, opts) {
    opts = opts || {};
    var maxLagMs = opts.maxLagMs || 450, factor = Math.max(1, Math.round(sr / 4000)), dsr = sr / factor;
    var winLen = Math.min(Math.floor(sr * 16), rec.length, track.length);
    if (winLen < sr * 4) return null;
    var best = 0, bestPow = -1, step = Math.floor(sr * 2), i, j;
    for (i = 0; i + winLen <= Math.min(rec.length, track.length); i += step) {
      var p = 0; for (j = i; j < i + winLen; j += 64) p += track[j] * track[j];
      if (p > bestPow) { bestPow = p; best = i; }
    }
    if (bestPow < 1e-6) return null;
    var maxLag = Math.round(maxLagMs / 1000 * dsr);
    var a = decimate(rec, factor, best, winLen), b = decimate(track, factor, best, winLen), n = a.length;
    // remove DC
    var ma = 0, mb = 0; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var ea = 0, eb = 0; for (i = 0; i < n; i++) { a[i] -= ma; b[i] -= mb; ea += a[i] * a[i]; eb += b[i] * b[i]; }
    if (ea <= 0 || eb <= 0) return null;
    var norm = Math.sqrt(ea * eb), corr = new Float32Array(maxLag + 1), lag, k;
    for (lag = 0; lag <= maxLag; lag++) {
      var c = 0; for (k = lag; k < n; k++) c += a[k] * b[k - lag];
      corr[lag] = c / norm;
    }
    var peak = 0, peakLag = 0; for (lag = 0; lag <= maxLag; lag++) if (corr[lag] > peak) { peak = corr[lag]; peakLag = lag; }
    // Music repeats every beat, so the correlation has echoes of the true peak.
    // Take the EARLIEST peak that is nearly as strong as the best one.
    var nb = Math.max(2, Math.round(dsr * 0.015));   // a real peak beats everything within +-15 ms
    for (lag = 0; lag < peakLag; lag++) {
      if (corr[lag] < peak * 0.85) continue;
      var isMax = true;
      for (k = Math.max(0, lag - nb); k <= Math.min(maxLag, lag + nb); k++) if (corr[k] > corr[lag]) { isMax = false; break; }
      if (isMax) { peakLag = lag; break; }
    }
    peak = corr[peakLag];
    // Noise floor = median |corr| (robust to the periodic echoes).
    var abs = Array.prototype.map.call(corr, Math.abs).sort(function (x, y) { return x - y; });
    var floor = abs[Math.floor(abs.length / 2)] || 1e-9;
    var ratio = peak / floor;
    if (peak < 0.09 || ratio < 3.5) return null;
    // parabolic refine
    var frac = 0;
    if (peakLag > 0 && peakLag < maxLag) {
      var y0 = corr[peakLag - 1], y1 = corr[peakLag], y2 = corr[peakLag + 1], d = y0 - 2 * y1 + y2;
      if (d !== 0) frac = 0.5 * (y0 - y2) / d;
    }
    return { lagMs: (peakLag + frac) / dsr * 1000, confidence: Math.min(1, ratio / 15), corr: peak };
  }

  /**
   * Automatic take cleanup (guest + owner recordings): removes rumble/DC,
   * gently turns down room hiss between phrases (max 9 dB, follows the take's
   * own noise floor), and soft-limits overs so a hot mic can't crackle.
   * Returns a new Float32Array.
   */
  function cleanTake(x, sr) {
    var n = x.length, i, out = new Float32Array(n);
    var w0 = 2 * Math.PI * 75 / sr, cw = Math.cos(w0), al = Math.sin(w0) / Math.SQRT2, a0 = 1 + al;
    var b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (i = 0; i < n; i++) {
      var xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y; out[i] = y;
    }
    var blk = Math.max(64, Math.round(sr * 0.02)), nb = Math.floor(n / blk), rms = [], b, sum;
    for (b = 0; b < nb; b++) { sum = 0; for (i = b * blk; i < (b + 1) * blk; i++) sum += out[i] * out[i]; rms.push(Math.sqrt(sum / blk)); }
    if (nb >= 10) {
      var sorted = rms.slice().sort(function (p, q) { return p - q; });
      var floor = sorted[Math.floor(nb * 0.15)], peakRms = sorted[nb - 1];
      var thr = Math.min(floor * 3.0, peakRms * 0.1);
      if (floor > 1e-5 && thr > floor) {
        var atk = 1 - Math.exp(-1 / (sr * 0.004)), rel = 1 - Math.exp(-1 / (sr * 0.15)), ea = 1 - Math.exp(-1 / (sr * 0.01));
        var gs = 1, env = 0, minG = Math.pow(10, -9 / 20);
        for (i = 0; i < n; i++) {
          var a = Math.abs(out[i]);
          env += (a - env) * (a > env ? 1 : ea);
          var target = env >= thr ? 1 : Math.max(minG, Math.pow(env / thr, 0.5));
          gs += (target - gs) * (target > gs ? atk : rel);
          out[i] *= gs;
        }
      }
    }
    for (i = 0; i < n; i++) {
      var v = out[i], av = Math.abs(v);
      if (av > 0.9) { var q = 0.9 + 0.095 * Math.tanh((av - 0.9) / 0.095); out[i] = v < 0 ? -q : q; }
    }
    return out;
  }

  function encodeWav16(data, sr) {
    var n = data.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    function str(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, data[i] + (Math.random() - Math.random()) / 32768)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }   // TPDF dither: no quantization grit on quiet passages
    return buf;
  }

  return { toMono: toMono, gatedRms: gatedRms, peakOf: peakOf, levelGain: levelGain, measureLag: measureLag, encodeWav16: encodeWav16, cleanTake: cleanTake };
});
