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
 * 3. Autocorrelate that envelope at every integer lag (one envelope
 *    frame apart) across the 60-200 BPM range, rather than stepping
 *    through BPM values and rounding each one to the nearest lag --
 *    that rounding was collapsing many nearby BPM values onto the same
 *    lag, which capped how precise a result this could ever report.
 * 4. Guard against octave errors: plain autocorrelation scores a true
 *    beat's harmonics (half tempo, a third tempo, ...) as strongly as --
 *    sometimes more strongly than -- the real tempo, since every hit at
 *    the real period also lines up at any multiple of it. The real
 *    tempo is the SHORTEST period that explains the beat, so candidates
 *    are walked from the shortest lag (highest BPM) down and the first
 *    one close to the best score seen anywhere wins.
 * 5. Refine that winning integer lag to sub-frame precision by fitting
 *    a parabola through its score and its two neighbors -- the same
 *    trick used to sharpen spectral peaks in pitch/key detection --
 *    then convert the refined lag back to BPM.
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

  var MIN_BPM = 60, MAX_BPM = 200;
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

  // Autocorrelation at every integer lag (envelope frame) in the BPM
  // search range: {lag, score} per candidate, highest score = strongest
  // periodic match. Working in lag space directly -- instead of stepping
  // through BPM values and rounding each to the nearest lag -- keeps the
  // score curve smooth enough to refine afterwards.
  function scoreLags(env, envRate) {
    var minLag = Math.max(1, Math.round((60 / MAX_BPM) * envRate));
    var maxLag = Math.min(env.length - 2, Math.round((60 / MIN_BPM) * envRate));
    var results = [];
    for (var lag = minLag; lag <= maxLag; lag++) {
      var sum = 0, count = 0;
      for (var i = 0; i + lag < env.length; i++) {
        sum += env[i] * env[i + lag];
        count++;
      }
      if (count > 0) results.push({ lag: lag, score: sum / count });
    }
    return results;
  }

  // Fits a parabola through a candidate's score and its two neighbors to
  // estimate the true (sub-frame) peak lag, the same trick used to
  // sharpen spectral peak estimates elsewhere in Gemstar.
  function refineLag(results, idx) {
    var y0 = idx > 0 ? results[idx - 1].score : results[idx].score;
    var y1 = results[idx].score;
    var y2 = idx < results.length - 1 ? results[idx + 1].score : results[idx].score;
    var denom = y0 - 2 * y1 + y2;
    var dx = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    if (dx < -1) dx = -1;
    if (dx > 1) dx = 1;
    return results[idx].lag + dx;
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

        var results = scoreLags(env, envRate);
        if (!results.length) { resolve(null); return; }

        // Same harmonic guard as before, now in lag space: walk from the
        // shortest lag (highest BPM) outward and take the first candidate
        // whose score is already close to the best score seen anywhere --
        // everything slower that also scores well is just a harmonic of
        // it. Then center on the actual local peak near that crossing
        // (+/-5 lags) rather than the first step that happened to clear
        // the bar.
        var globalMax = results.reduce(function (m, r) { return Math.max(m, r.score); }, 0);
        var bestIdx = 0;
        for (var k = 0; k < results.length; k++) {
          if (results[k].score >= globalMax * HARMONIC_THRESHOLD) {
            var lo = Math.max(0, k - 5), hi = Math.min(results.length - 1, k + 5);
            var peak = k;
            for (var j = lo; j <= hi; j++) {
              if (results[j].score > results[peak].score) peak = j;
            }
            bestIdx = peak;
            break;
          }
        }

        var refinedLag = refineLag(results, bestIdx);
        var bpm = (60 * envRate) / refinedLag;

        var best = results[bestIdx];
        var meanScore = results.reduce(function (s, r) { return s + r.score; }, 0) / results.length;
        var peakiness = meanScore > 0 ? best.score / meanScore : 0;
        // "guess" is intentionally generous -- showing a rough number is
        // more useful to a producer eyeballing tempo than staying silent,
        // so only a genuinely flat/non-periodic signal falls through to
        // "low" (shown as "couldn't confidently detect a tempo").
        var confidence = peakiness > 3 ? "high" : peakiness > 1.3 ? "guess" : "low";

        if (isCancelled()) { resolve(null); return; }
        resolve({ bpm: Math.round(bpm), confidence: confidence });
      }, 0);
    });
  }

  return { detect: detect };
});
