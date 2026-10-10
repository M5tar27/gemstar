/* Gemstar AI Master (Unlimited plan).
 *
 *  analyze(L, R, sr)   -> measures the finished mix: tonal balance per octave band,
 *                         crest factor (how dynamic it is) and loudness-ish level.
 *  plan(analysis)      -> turns that into mastering settings: four gentle EQ moves
 *                         (low shelf, low-mid cut/boost, presence, air) pulling the mix
 *                         halfway toward a reference tonal balance, plus a glue
 *                         compressor sized to how dynamic the mix is.
 *  create(ctx)         -> builds the Web Audio node chain {input, output, apply(plan),
 *                         setEnabled(bool)} that sits on the master bus.
 *
 * The EQ moves are deliberately small (max +/-3 dB) so it can't wreck a good mix.
 * Pure JS, no dependencies; works in the browser (window.GemstarMaster) and Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GemstarMaster = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Octave bands (centre Hz) and the reference balance relative to the 1 kHz band (dB).
  var BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
  var TARGET = [6, 6, 3, 1, 0, -2.5, -5.5, -10];
  var MAX_MOVE_DB = 3, STRENGTH = 0.5;

  function fft(re, im) {                       // in-place radix-2
    var n = re.length, i, j = 0, k;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  function analyze(L, R, sr) {
    var N = 4096, hop = 8192, n = Math.min(L.length, R ? R.length : L.length), win = new Float32Array(N), i, f;
    for (i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    // mono + peak
    var peak = 0, frames = [], rmsAll = [];
    var re = new Float32Array(N), im = new Float32Array(N);
    var binHz = sr / N, bandPow = new Float64Array(BANDS.length), used = 0;
    for (i = 0; i < n; i++) { var a = Math.abs(L[i]); if (R) { var b = Math.abs(R[i]); if (b > a) a = b; } if (a > peak) peak = a; }
    // gate: ignore frames more than 40 dB below the loudest frame
    var starts = [], levels = [], maxLvl = 0;
    for (f = 0; f + N <= n; f += hop) {
      var s = 0; for (i = 0; i < N; i++) { var m = R ? (L[f + i] + R[f + i]) * 0.5 : L[f + i]; s += m * m; }
      var lv = s / N; starts.push(f); levels.push(lv); if (lv > maxLvl) maxLvl = lv;
    }
    if (!starts.length || maxLvl < 1e-9) return null;
    var gate = maxLvl * 1e-4, sumPow = 0;
    for (var q = 0; q < starts.length; q++) {
      if (levels[q] < gate) continue;
      f = starts[q];
      for (i = 0; i < N; i++) { re[i] = (R ? (L[f + i] + R[f + i]) * 0.5 : L[f + i]) * win[i]; im[i] = 0; }
      fft(re, im);
      for (var bi = 0; bi < BANDS.length; bi++) {
        var lo = BANDS[bi] / Math.SQRT2, hi = BANDS[bi] * Math.SQRT2, p = 0;
        for (var k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(N / 2 - 1, Math.floor(hi / binHz)); k++) p += re[k] * re[k] + im[k] * im[k];
        bandPow[bi] += p;
      }
      sumPow += levels[q]; used++;
    }
    if (!used) return null;
    var bandsDb = [], ref = 10 * Math.log10(bandPow[BANDS.indexOf(1000)] + 1e-30);
    for (var j = 0; j < BANDS.length; j++) bandsDb.push(10 * Math.log10(bandPow[j] + 1e-30) - ref);
    var rms = Math.sqrt(sumPow / used);
    var crestDb = 20 * Math.log10((peak + 1e-9) / (rms + 1e-9));
    return { bandsDb: bandsDb, crestDb: crestDb, rms: rms, peak: peak };
  }

  function clampMove(x) { return Math.max(-MAX_MOVE_DB, Math.min(MAX_MOVE_DB, x)); }

  function plan(an) {
    if (!an) return null;
    var d = an.bandsDb.map(function (v, i) { return TARGET[i] - v; });         // how far each band is from the reference
    function avg(a, b) { return (d[a] + d[b]) / 2; }
    var comp = an.crestDb > 16 ? { thr: -22, ratio: 3.0 }
             : an.crestDb > 13 ? { thr: -20, ratio: 2.4 }
             : an.crestDb > 10 ? { thr: -18, ratio: 1.8 }
             : { thr: -16, ratio: 1.4 };
    return {
      lowShelfDb:  Math.round(clampMove(avg(0, 1) * STRENGTH) * 10) / 10,       // 63-125 Hz
      lowMidDb:    Math.round(clampMove(avg(2, 3) * STRENGTH) * 10) / 10,       // 250-500 Hz
      presenceDb:  Math.round(clampMove(avg(5, 6) * STRENGTH) * 10) / 10,       // 2-4 kHz
      airDb:       Math.round(clampMove(d[7] * STRENGTH) * 10) / 10,            // 8 kHz+
      compThreshold: comp.thr, compRatio: comp.ratio, crestDb: an.crestDb
    };
  }

  function create(c) {
    var input = c.createGain(), output = c.createGain();
    var dry = c.createGain(), wet = c.createGain();
    var hpf = c.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = 28; hpf.Q.value = 0.707;
    var low = c.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 100;
    var mid = c.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 350; mid.Q.value = 0.8;
    var pres = c.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3000; pres.Q.value = 0.9;
    var air = c.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 9000;
    var glue = c.createDynamicsCompressor();
    glue.knee.value = 12; glue.attack.value = 0.03; glue.release.value = 0.25;
    glue.threshold.value = -18; glue.ratio.value = 1.5;
    var make = c.createGain();
    dry.gain.value = 1; wet.gain.value = 0;
    input.connect(dry); dry.connect(output);
    input.connect(hpf); hpf.connect(low); low.connect(mid); mid.connect(pres); pres.connect(air);
    air.connect(glue); glue.connect(make); make.connect(wet); wet.connect(output);
    var enabled = false;
    return {
      input: input, output: output,
      apply: function (p) {
        if (!p) return;
        low.gain.value = p.lowShelfDb; mid.gain.value = p.lowMidDb; pres.gain.value = p.presenceDb; air.gain.value = p.airDb;
        glue.threshold.value = p.compThreshold; glue.ratio.value = p.compRatio;
        // glue compression lowers the level a little; give back about half of what it takes
        make.gain.value = Math.pow(10, Math.min(3, Math.max(0, (-p.compThreshold - 12) * (1 - 1 / p.compRatio) * 0.25)) / 20);
      },
      setEnabled: function (on) {
        enabled = !!on; var t = c.currentTime;
        dry.gain.setTargetAtTime(enabled ? 0 : 1, t, 0.02); wet.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.02);
      },
      isEnabled: function () { return enabled; }
    };
  }

  return { analyze: analyze, plan: plan, create: create, BANDS: BANDS, TARGET: TARGET };
});
