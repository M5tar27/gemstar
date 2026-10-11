const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

process.env.ACCESS_TOKEN_SECRET = "test-secret";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const b64 = (s) => Buffer.from(s).toString("base64url");
function token(email, tier, device = "*", ttl = 3600) {
  const payload = `${b64(email)}.${tier}.${b64(device)}.${Math.floor(Date.now() / 1000) + ttl}`;
  return payload + "." + crypto.createHmac("sha256", "test-secret").update(payload).digest("hex");
}
function run(handler, req) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; }, setHeader() {}, end() { resolve({ code: this.code }); } };
    Promise.resolve(handler({ method: "POST", headers: {}, ...req }, res));
  });
}

const handlers = ["my-tracks", "create-track", "get-track", "create-invite", "delete-track"];

for (const name of handlers) {
  const h = require(`../api/${name}.js`);
  test(`${name}: GET is rejected`, async () => {
    const r = await run(h, { method: "GET", body: {} });
    assert.strictEqual(r.code, 405);
  });
  test(`${name}: no token -> 401`, async () => {
    const r = await run(h, { body: {} });
    assert.strictEqual(r.code, 401);
  });
  test(`${name}: starter plan -> 403`, async () => {
    const r = await run(h, { body: { token: token("a@b.com", "starter"), deviceId: "x" } });
    assert.strictEqual(r.code, 403);
  });
  test(`${name}: tampered token -> 401`, async () => {
    const t = token("a@b.com", "unlimited");
    const r = await run(h, { body: { token: t.slice(0, -2) + "00", deviceId: "x" } });
    assert.strictEqual(r.code, 401);
  });
}
