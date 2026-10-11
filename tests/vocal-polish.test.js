const test = require("node:test");
const assert = require("node:assert");
const P = require("../vocal-polish.js");

// A permissive fake AudioContext: any create* returns a node whose params accept writes.
function fakeCtx() {
  const mk = () => new Proxy(function () {}, {
    get: (t, k) => (k === "connect" ? () => {} : k in t ? t[k] : (t[k] = typeof k === "string" && /^(value)$/.test(k) ? 0 : mk())),
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => mk(),
  });
  return new Proxy({ sampleRate: 48000, createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }) }, {
    get: (t, k) => (k in t ? t[k] : typeof k === "string" && k.startsWith("create") ? () => mk() : undefined),
  });
}

test("off returns null; light and full build a channel", () => {
  const c = fakeCtx(), dest = { connect() {} };
  assert.strictEqual(P.create(c, "off", dest), null);
  assert.ok(P.create(c, "light", dest).channel());
  assert.ok(P.create(c, "full", dest).channel());
});

test("presets stay sane", () => {
  ["light", "full"].forEach((k) => {
    const p = P.PRESETS[k];
    assert.ok(p.hpf >= 60 && p.hpf <= 150);
    assert.ok(p.verb >= 0 && p.verb <= 0.3);
  });
});
