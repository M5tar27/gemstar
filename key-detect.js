/* Gemstar key detector.
 *
 * Estimates the musical key of an AudioBuffer (a beat or instrumental) so
 * Auto-Tune can be told exactly which notes fit. Method:
 *   1. Take up to 64 FFT frames spread across the track.
 *   2. In each frame pick the strongest spectral peaks (with parabolic
 *      interpolation for accurate pitch) between 60 Hz and 4 kHz.
 *   3. Estimate how far the track is tuned from A=440 (circular mean of
 *      each peak's distance from the nearest semitone) and correct for it.
 *   4. Fold every peak into a 12-note "chroma" profile, normalizing each
 *      frame so loud sections don't drown out quiet ones.
 *   5. Correlate that profile against the Krumhansl-Kessler major and
 *      minor key profiles in all 12 rotations (24 keys) and pick the best.
 *
 * Relative major/minor pairs (e.g. A minor / C major) use the exact same
 * notes, so they are reported together: for Auto-Tune either choice snaps
 * to the same scale.
 *
 * Pure JS, no dependencies. Works in the browser (window.GemstarKey) and
 * in Node (module.exports) so it can be unit-tested. detect() is
 * asynchronous and yields to the UI between small batches of frames.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GemstarKey = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NAMES = ["C", "C# / Db", "D", "D# / Eb", "E", "F", "F# / Gb", "G", "G# / Ab", "A", "A# / Bb", "B"];
  // Krumhansl-Kessler key profiles (tonic first).
  var MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
  var MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

  var MIN_HZ = 60, MAX_HZ = 4000, PEAKS_PER_FRAME = 24, DEFAULT_FRAMES = 64, FRAMES_PER_SLICE = 4;

  var fftCache = {};
  function getFFT(n) {
    if (fftCache[n]) return fftCache[n];
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n), bits = Math.round(Math.log(n) / Math.LN2), i, j;
    for (i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    for (i = 0; i < n; i++) { var r = 0; for (j = 0; j < bits; j++) r |= ((i >> j) & 1) << (bits - 1 - j); rev[i] = r; }
    var fft = function (re, im) {
      var k, size, half, step, a, b, t, tre, tim;
      for (k = 0; k < n; k++) { t = rev[k]; if (t > k) { var x = re[k]; re[k] = re[t]; re[t] = x; x = im[k]; im[k] = im[t]; im[t] = x; } }
      for (size = 2; size <= n; size <<= 1) {
        half = size >> 1; step = n / size;
        for (a = 0; a < n; a += size) {
          for (b = a, t = 0; b < a + half; b++, t += step) {
            var l = b + half;
            tre = re[l] * cos[t] + im[l] * sin[t];
            tim = -re[l] * sin[t] + im[l] * cos[t];
            re[l] = re[b] - tre; im[l] = im[b] - tim;
            re[b] += tre; im[b] += tim;
          }
        }
      }
    };
    fftCache[n] = fft;
    return fft;
  }

  function hann(n) {
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  }

  function keyInfo(root, mode) {
    return { root: root, mode: mode, name: NAMES[root] + " " + mode };
  }
  function relativeOf(root, mode) {
    return mode === "major" ? keyInfo((root + 9) % 12, "minor") : keyInfo((root + 3) % 12, "major");
  }

  // Scores a finished chroma vector against all 24 keys and builds the result.
  function classify(chroma, tuningSemis) {
    var scores = [], r, k, rot = new Array(12);
    for (r = 0; r < 12; r++) {
      for (k = 0; k < 12; k++) rot[k] = MAJOR[(k - r + 12) % 12];
      scores.push({ root: r, mode: "major", r: pearson(chroma, rot) });
      for (k = 0; k < 12; k++) rot[k] = MINOR[(k - r + 12) % 12];
      scores.push({ root: r, mode: "minor", r: pearson(chroma, rot) });
    }
    scores.sort(function (a, b) { return b.r - a.r; });
    var best = scores[0], rel = relativeOf(best.root, best.mode), second = null;
    for (k = 1; k < scores.length; k++) {
      var s = scores[k];
      if (s.root === rel.root && s.mode === rel.mode) continue; // same notes, not a competitor
      second = s; break;
    }
    var margin = best.r - second.r;
    var confidence = (best.r >= 0.75 && margin >= 0.10) ? "high" : (best.r >= 0.60 && margin >= 0.04) ? "medium" : "low";
    var key = keyInfo(best.root, best.mode);
    return {
      root: key.root, mode: key.mode, name: key.name,
      relative: rel,
      confidence: confidence, score: best.r, margin: margin,
      tuningCents: Math.round(tuningSemis * 100),
      alternatives: scores.slice(0, 3).map(function (s) { return { root: s.root, mode: s.mode, name: NAMES[s.root] + " " + s.mode, score: s.r }; })
    };
  }

  /**
   * detect(audioBuffer, opts) -> Promise<result | null>
   *   audioBuffer: anything shaped like an AudioBuffer (sampleRate, length,
   *                numberOfChannels, getChannelData(i)).
   *   opts.maxFrames    FFT frames to analyze (default 64)
   *   opts.isCancelled  function returning true to abort (resolves null)
   * Resolves null when the audio is too short or silent to judge.
   */
  function detect(buf, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      try {
        var sr = buf.sampleRate, len = buf.length, nch = buf.numberOfChannels;
        var n = sr > 48000 ? 32768 : 16384;
        if (!sr || len < n) { resolve(null); return; }
        var chans = [], c;
        for (c = 0; c < nch; c++) chans.push(buf.getChannelData(c));

        var maxFrames = Math.max(1, opts.maxFrames || DEFAULT_FRAMES);
        var start = Math.floor(len * 0.03), span = Math.max(0, len - n - start - Math.floor(len * 0.03));
        var frames = Math.min(maxFrames, Math.floor(span / (n / 2)) + 1);
        var binHz = sr / n, kmin = Math.max(2, Math.ceil(MIN_HZ / binHz)), kmax = Math.min(n / 2 - 2, Math.floor(MAX_HZ / binHz));
        var win = hann(n), fft = getFFT(n);
        var re = new Float64Array(n), im = new Float64Array(n), mag = new Float64Array(n / 2);
        var framePeaks = [], idx = 0;

        function oneFrame(f) {
          var pos = start + (frames > 1 ? Math.floor(f * span / (frames - 1)) : 0), i, ch, sum = 0;
          for (i = 0; i < n; i++) {
            var v = 0;
            for (ch = 0; ch < nch; ch++) v += chans[ch][pos + i];
            v /= nch; sum += v * v;
            re[i] = v * win[i]; im[i] = 0;
          }
          if (Math.sqrt(sum / n) < 1e-4) return;            // digital silence
          fft(re, im);
          var maxM = 0, k;
          for (k = kmin - 1; k <= kmax + 1; k++) { mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); if (mag[k] > maxM) maxM = mag[k]; }
          if (maxM <= 0) return;
          var thr = maxM * 0.03, cand = [];
          for (k = kmin; k <= kmax; k++) {
            if (mag[k] > thr && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cand.push(k);
          }
          cand.sort(function (a, b) { return mag[b] - mag[a]; });
          cand = cand.slice(0, PEAKS_PER_FRAME);
          var peaks = [];
          for (i = 0; i < cand.length; i++) {
            k = cand[i];
            var a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k] + 1e-12), cc = Math.log(mag[k + 1] + 1e-12);
            var den = a - 2 * b + cc, p = den !== 0 ? 0.5 * (a - cc) / den : 0;
            if (p > 0.5) p = 0.5; else if (p < -0.5) p = -0.5;
            var hz = (k + p) * binHz;
            // Fundamentals matter more than high overtones.
            peaks.push({ hz: hz, w: Math.sqrt(mag[k] / maxM) / (1 + hz / 1500) });
          }
          if (peaks.length) framePeaks.push(peaks);
        }

        function finish() {
          if (!framePeaks.length) { resolve(null); return; }
          // Tuning offset from the A=440 grid, as a circular mean (period = 1 semitone).
          var sx = 0, sy = 0, sw = 0, f, p, peaks;
          for (f = 0; f < framePeaks.length; f++) {
            peaks = framePeaks[f];
            for (p = 0; p < peaks.length; p++) {
              if (peaks[p].hz < 150) continue;               // low bins are too coarse to judge tuning
              var m = 69 + 12 * Math.log(peaks[p].hz / 440) / Math.LN2, dev = m - Math.round(m);
              sx += peaks[p].w * Math.cos(2 * Math.PI * dev); sy += peaks[p].w * Math.sin(2 * Math.PI * dev); sw += peaks[p].w;
            }
          }
          var tuning = 0;
          if (sw > 0 && Math.sqrt(sx * sx + sy * sy) / sw > 0.15) tuning = Math.atan2(sy, sx) / (2 * Math.PI);

          var chroma = new Array(12), q;
          for (q = 0; q < 12; q++) chroma[q] = 0;
          for (f = 0; f < framePeaks.length; f++) {
            peaks = framePeaks[f];
            var fc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], tot = 0;
            for (p = 0; p < peaks.length; p++) {
              var mm = 69 + 12 * Math.log(peaks[p].hz / 440) / Math.LN2 - tuning;
              var pc = ((Math.round(mm) % 12) + 12) % 12;
              fc[pc] += peaks[p].w; tot += peaks[p].w;
            }
            if (tot > 0) for (q = 0; q < 12; q++) chroma[q] += fc[q] / tot;   // each frame counts equally
          }
          resolve(classify(chroma, tuning));
        }

        function step() {
          if (opts.isCancelled && opts.isCancelled()) { resolve(null); return; }
          var end = Math.min(frames, idx + FRAMES_PER_SLICE);
          for (; idx < end; idx++) oneFrame(idx);
          if (idx < frames) setTimeout(step, 0); else finish();
        }
        step();
      } catch (e) { resolve(null); }
    });
  }

  return { detect: detect, names: NAMES, relativeOf: relativeOf };
});
