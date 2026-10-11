const test = require("node:test");
const assert = require("node:assert");
const K = require("../key-detect.js");

function fakeBuffer(freqs, seconds, sr) {
  const n = Math.floor(seconds * sr), d = new Float32Array(n);
  freqs.forEach((f) => { for (let i = 0; i < n; i++) d[i] += 0.2 * Math.sin(2 * Math.PI * f * i / sr); });
  return { sampleRate: sr, length: n, numberOfChannels: 1, getChannelData: () => d };
}

test("detects C major / A minor from a C major chord progression", async () => {
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // C E G sustained, over a C scale tone mix
  const buf = fakeBuffer([hz(60), hz(64), hz(67), hz(72), hz(48)], 12, 22050);
  const res = await K.detect(buf);
  assert.ok(res, "should return a result");
  assert.match(res.name + " " + res.relative.name, /C major/);
});

test("returns null for audio that is too short", async () => {
  const res = await K.detect({ sampleRate: 22050, length: 100, numberOfChannels: 1, getChannelData: () => new Float32Array(100) });
  assert.strictEqual(res, null);
});
