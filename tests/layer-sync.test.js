const test = require("node:test");
const assert = require("node:assert");
const S = require("../layer-sync.js");

const SR = 16000;
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

test("encodeWav16 writes a valid 16-bit mono WAV header and length", () => {
  const data = new Float32Array(1000).fill(0.25);
  const buf = Buffer.from(S.encodeWav16(data, SR));
  assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(buf.toString("ascii", 8, 12), "WAVE");
  assert.strictEqual(buf.readUInt16LE(34), 16);
  assert.strictEqual(buf.readUInt32LE(24), SR);
  assert.strictEqual(buf.length, 44 + 2000);
});

test("measureLag finds a known delay when the track leaks into the mic", () => {
  const r = rng(7), n = SR * 20, track = new Float32Array(n);
  // noisy, beat-like material so the correlation has one clear peak
  for (let i = 0; i < n; i++) track[i] = r() * 0.3 * (((i / (SR * 0.25)) | 0) % 2 ? 1 : 0.4);
  const lag = Math.round(SR * 0.12), rec = new Float32Array(n);
  for (let i = lag; i < n; i++) rec[i] = track[i - lag] * 0.5 + r() * 0.01;
  const m = S.measureLag(rec, track, SR);
  assert.ok(m, "should detect the leaked track");
  assert.ok(Math.abs(m.lagMs - 120) < 8, "lag " + m.lagMs + " ms should be about 120");
});

test("measureLag returns null when the track is not in the recording", () => {
  const r = rng(3), n = SR * 20, track = new Float32Array(n), rec = new Float32Array(n);
  for (let i = 0; i < n; i++) { track[i] = r() * 0.3; rec[i] = r() * 0.3; }
  assert.strictEqual(S.measureLag(rec, track, SR), null);
});

test("levelGain never pushes the peak over full scale", () => {
  const g = S.levelGain(0.1, 0.01, 0.9);
  assert.ok(g.gain * 0.9 <= 0.9701);
});

test("cleanTake removes DC, turns down hiss between phrases, keeps the voice, and never exceeds 1", { skip: typeof S.cleanTake !== "function" && "cleanTake not in this branch yet" }, () => {
  const sr = 48000, n = sr * 6, x = new Float32Array(n), r = rng(11);
  for (let k = 0; k < n; k++) {
    const t = k / sr, on = t % 2 < 1;
    x[k] = r() * 0.004 + 0.02 + (on ? 0.3 * Math.sin(2 * Math.PI * 220 * t) * Math.sin(Math.PI * (t % 1)) : 0);
  }
  x[1000] = 1.5; // an "over"
  const y = S.cleanTake(x, sr);
  const rms = (a, f, t) => { let q = 0; for (let k = f; k < t; k++) q += a[k] * a[k]; return Math.sqrt(q / (t - f)); };
  assert.ok(rms(y, sr * 1.2, sr * 1.9) < rms(x, sr * 1.2, sr * 1.9) * 0.5, "gap should get quieter");
  const sung0 = rms(x, sr * 0.3, sr * 0.8), sung1 = rms(y, sr * 0.3, sr * 0.8);
  assert.ok(Math.abs(20 * Math.log10(sung1 / sung0)) < 1, "voice level should barely change");
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak < 1, "peak " + peak);
});
