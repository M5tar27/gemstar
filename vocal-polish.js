/* Gemstar vocal polish for Collab layers (used by track.html).
 *
 * Guest layers are recorded raw. This runs each one through a compact version
 * of the Gemstar vocal chain at playback / render time, so the original
 * recording is never changed and the owner can switch it Off / Light / Full.
 *
 *   high-pass (rumble) -> mud cut -> compressor -> presence -> de-ess -> air
 *   -> makeup gain, plus a small shared room reverb send.
 *
 * Works on any AudioContext or OfflineAudioContext (live and download).
 * Browser: window.GemstarPolish   Node: require()
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GemstarPolish = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PRESETS = {
    light: { hpf: 80,  mud: -1.5, thr: -24, ratio: 3, makeup: 0, presence: 1.5, deess: -2, air: 1.5, verb: 0.08 },
    full:  { hpf: 100, mud: -2.5, thr: -28, ratio: 4, makeup: 1.0, presence: 3.0, deess: -3, air: 3.0, verb: 0.16 }
  };

  // Soft ceiling: ~linear below 0.6, rounds off toward 0.97, never above it.
  var CLIP = (function () {
    var n = 2049, a = new Float32Array(n), i;
    for (i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1, ax = Math.abs(x), y;
      y = ax < 0.6 ? ax : 0.6 + 0.37 * Math.tanh((ax - 0.6) / 0.37);
      a[i] = x < 0 ? -y : y; }
    return a;
  })();

  function db(x) { return Math.pow(10, x / 20); }

  function filter(c, type, freq, q, gainDb) {
    var f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    if (gainDb != null) f.gain.value = gainDb;
    return f;
  }

  // Short, soft room: decaying noise, deterministic so every render matches.
  function roomImpulse(c) {
    var sr = c.sampleRate, len = Math.floor(sr * 0.9), buf = c.createBuffer(2, len, sr), ch, i;
    for (ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), seed = 12345 + ch * 7919;
      for (i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        var n = seed / 4294967296 * 2 - 1;
        d[i] = n * Math.pow(1 - i / len, 2.6);
      }
    }
    return buf;
  }

  /**
   * create(ctx, level, dest)
   *   level: "off" | "light" | "full"
   *   dest:  node the processed vocals (and reverb) are sent to
   * Returns null for "off", else { channel() } where channel() returns the
   * input node for one layer (each layer gets its own chain).
   */
  function create(c, level, dest) {
    var p = PRESETS[level];
    if (!p) return null;
    var rev = null;
    if (p.verb > 0) {
      var conv = c.createConvolver(); conv.buffer = roomImpulse(c);
      var ret = c.createGain(); ret.gain.value = 1;
      conv.connect(ret); ret.connect(dest);
      rev = conv;
    }
    return {
      channel: function () {
        var input = c.createGain();
        var hpf = filter(c, "highpass", p.hpf, 0.707);
        var mud = filter(c, "peaking", 300, 0.9, p.mud);
        var comp = c.createDynamicsCompressor();
        comp.threshold.value = p.thr; comp.ratio.value = p.ratio; comp.knee.value = 10;
        comp.attack.value = 0.008; comp.release.value = 0.2;
        var pres = filter(c, "peaking", 3000, 1.0, p.presence);
        var des = filter(c, "peaking", 6800, 2.0, p.deess);
        var air = filter(c, "highshelf", 10000, null, p.air);
        var make = c.createGain(); make.gain.value = db(p.makeup);
        // Safety limiter: polish adds level (makeup, presence, air); this keeps peaks under 0 dBFS.
        var lim = c.createDynamicsCompressor();
        lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
        var clip = c.createWaveShaper(); clip.curve = CLIP; clip.oversample = "2x";   // hard ceiling just under 0 dBFS
        input.connect(hpf); hpf.connect(mud); mud.connect(comp); comp.connect(pres);
        pres.connect(des); des.connect(air); air.connect(make); make.connect(lim); lim.connect(clip); clip.connect(dest);
        if (rev) { var send = c.createGain(); send.gain.value = p.verb; clip.connect(send); send.connect(rev); }
        return input;
      }
    };
  }

  return { create: create, PRESETS: PRESETS };
});
