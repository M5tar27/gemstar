/* Gemstar BPM detector.
 *
 * Estimates the tempo (BPM) of an AudioBuffer (a beat or instrumental).
 * Method:
 * 1. Low-pass filter the signal to isolate the kick-drum / bass-pulse
 *    range (under ~150 Hz) -- the most reliably periodic element in most
 *    music, so vocals and melody mostly don't throw it off.
 * 2. Build a coarse "onset strength" envelope: peak-rectify in small
 *    windows (~12ms), then subtract a short moving average so sudden
 *    hits stand out from slow level swells.
 * 3. Autocorrelate that envelope against every candidate tempo from 60
 *    to 200 BPM and take the strongest periodic match.
 * 4. Guard against octave errors: plain autocorrelation scores a true
 *    beat's harmonics (half tempo, a third tempo, ...) as strongly as --
 *    sometimes more strongly than -- the real tempo, since every hit at
 *    the real period also lines up at any multiple of it. The real
 *    tempo is the SHORTEST period that explains the beat, so candidates
 *    are walked from the highest BPM down and the first one close to
 *    the best score seen anywhere wins.
 *
 * Only the first ANALYZE_SECONDS of audio are scanned -- tempo is
 * constant through almost every beat, so there's no need to walk a full
 * long track, which keeps this fast regardless of song length.
 *
 * Pure JS, no dependencies. Works in the browser (window.GemstarBPM) and
 * in Node (module.exports) so it can be unit-tested. detect() is
 * asynchronous, matching GemstarKey's interface, and accepts the same
 * {isCancelled} option so a stale run can be dropped.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GemstarBPM = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MIN_BPM = 60, MAX_BPM = 200, BPM_STEP = 0.5;
  var ANALYZE_SECONDS = 45;
  var ENV_HOP = 512; // samples per envelope frame (~11.6ms at 44.1kHz)
  var LOWPASS_HZ = 150;
  var HARMONIC_THRESHOLD = 0.5;

  // One-pole low-pass filter -- isolates the kick/bass pulse.
  function lowPass(data, sampleRate, cutoffHz) {
    var rc = 1 / (2 * Math.PI * cutoffHz);
    var dt = 1 / sampleRate;
    var alpha = dt / (rc + dt);
    var out = new Float32Array(data.length);
    var prev = 0;
    for (var i = 0; i < data.length; i++) {
      prev = prev + alpha * (data[i] - prev);
      out[i] = prev;
    }
    return out;
  }

  // Peak-rectified energy per hop, then local-mean subtracted (~0.5s
  // window) so transients (hits) stand out from slow level drift.
  function buildEnvelope(data, hop, envRate) {
    var frames = Math.floor(data.length / hop);
    var env = new Float32Array(frames);
    for (var f = 0; f < frames; f++) {
      var start = f * hop, end = start + hop;
      var peak = 0;
      for (var i = start; i < end; i++) {
        var v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      env[f] = peak;
    }
    var smoothWin = Math.max(1, Math.round(0.5 * envRate));
    var out = new Float32Array(frames);
    var acc = 0;
    for (var j = 0; j < frames; j++) {
      acc += env[j];
      if (j >= smoothWin) acc -= env[j - smoothWin];
      var win = Math.min(j + 1, smoothWin);
      var mean = acc / win;
      out[j] = Math.max(0, env[j] - mean);
    }
    return out;
  }

  // Autocorrelation across the BPM search range: {bpm, score} per
  // candidate, highest score = strongest periodic match.
  function scoreCandidates(env, envRate) {
    var results = [];
    for (var bpm = MIN_BPM; bpm <= MAX_BPM; bpm += BPM_STEP) {
      var periodFrames = Math.round((60 / bpm) * envRate);
      if (periodFrames < 1 || periodFrames >= env.length) continue;
      var sum = 0, count = 0;
      for (var i = 0; i + periodFrames < env.length; i++) {
        sum += env[i] * env[i + periodFrames];
        count++;
      }
      if (count > 0) results.push({ bpm: bpm, score: sum / count });
    }
    return results;
  }

  function detect(buffer, opts) {
    opts = opts || {};
    var isCancelled = opts.isCancelled || function () { return false; };
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (isCancelled() || !buffer || !buffer.getChannelData) { resolve(null); return; }

        var sampleRate = buffer.sampleRate;
        var full = buffer.getChannelData(0);
        var sampleCount = Math.min(full.length, Math.round(ANALYZE_SECONDS * sampleRate));
        var data = full.subarray(0, sampleCount);

        var filtered = lowPass(data, sampleRate, LOWPASS_HZ);
        var envRate = sampleRate / ENV_HOP;
        var env = buildEnvelope(filtered, ENV_HOP, envRate);

        if (isCancelled()) { resolve(null); return; }

        var results = scoreCandidates(env, envRate);
        if (!results.length) { resolve(null); return; }

        // Plain autocorrelation naturally scores a true beat's harmonics
        // (half tempo, a third tempo, etc.) as strongly as -- sometimes
        // more strongly than -- the real tempo itself, since every hit at
        // the real period also lines up at any multiple of it. The fix
        // is to not just take the global best score, but walk candidates
        // from the shortest period (highest BPM) down and take the first
        // one whose score is already close to the best score seen
        // anywhere: the real tempo is the shortest period that explains
        // the beat, and everything slower scoring well is just a
        // harmonic of it.
        var globalMax = results.reduce(function (m, r) { return Math.max(m, r.score); }, 0);
        var byBpmDesc = results.slice().sort(function (a, b) { return b.bpm - a.bpm; });
        var best = byBpmDesc[0];
        for (var k = 0; k < byBpmDesc.length; k++) {
          if (byBpmDesc[k].score >= globalMax * HARMONIC_THRESHOLD) {
            // Center on the actual local peak near this crossing (+/-5 BPM)
            // rather than the first step that happened to clear the bar.
            var lo = Math.max(0, k - 10), hi = Math.min(byBpmDesc.length - 1, k + 10);
            var peak = byBpmDesc[k];
            for (var j = lo; j <= hi; j++) {
              if (byBpmDesc[j].score > peak.score) peak = byBpmDesc[j];
            }
            best = peak;
            break;
          }
        }

        var meanScore = results.reduce(function (s, r) { return s + r.score; }, 0) / results.length;
        var peakiness = meanScore > 0 ? best.score / meanScore : 0;
        var confidence = peakiness > 3 ? "high" : peakiness > 1.8 ? "guess" : "low";

        if (isCancelled()) { resolve(null); return; }
        resolve({ bpm: Math.round(best.bpm), confidence: confidence });
      }, 0);
    });
  }

  return { detect: detect };
});
