// Shared helpers for the track-invite endpoints. The leading underscore keeps
// Vercel from exposing this folder as a route.
//
// Requires env vars: ACCESS_TOKEN_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: SITE_URL (defaults to https://gemstaraudio.com)

const crypto = require("crypto");

const BUCKET = "gemstar-tracks";
const GUEST_TTL_SECONDS = 60 * 60 * 24; // guest session lasts 24h
const VALID_TIERS = ["starter", "mix", "unlimited"];
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
// Collaboration (creating tracks and invites) is a Mix + Unlimited feature.
// Guests joining via an invite are NOT gated, so the growth loop stays open.
const COLLAB_MIN_TIER = "mix";
function canCollaborate(tier) {
  return (TIER_RANK[tier] || 0) >= TIER_RANK[COLLAB_MIN_TIER];
}

function parseBody(req) {
  let body = req.body;
  if (!body || typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
  }
  return body;
}

function b64urlDecode(input) {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function hmac(payload) {
  return crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(payload).digest("hex");
}

function safeEqualHex(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// Same format and checks as /api/verify-token: email.tier.deviceId.expiry.sig,
// bound to the presenting device ("*" = founder wildcard).
function verifyAccessToken(token, presentedDeviceId) {
  if (!token || !process.env.ACCESS_TOKEN_SECRET) return null;
  const parts = String(token).split(".");
  if (parts.length !== 5) return null;
  const [b64email, tierRaw, b64deviceId, expiryStr, sig] = parts;
  const payload = `${b64email}.${tierRaw}.${b64deviceId}.${expiryStr}`;
  if (!safeEqualHex(sig, hmac(payload))) return null;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) return null;
  let email, tokenDeviceId;
  try {
    email = b64urlDecode(b64email).toLowerCase();
    tokenDeviceId = b64urlDecode(b64deviceId);
  } catch (e) { return null; }
  if (tokenDeviceId !== "*" && tokenDeviceId !== String(presentedDeviceId || "").trim()) return null;
  return { email, tier: VALID_TIERS.indexOf(tierRaw) === -1 ? "starter" : tierRaw };
}

// Guest tokens are a different shape ("g.<id>.<expiry>.<sig>", signed over a
// "guest." prefix) so one can never be replayed as an access token.
function signGuestToken() {
  const id = crypto.randomBytes(12).toString("hex");
  const expiry = Math.floor(Date.now() / 1000) + GUEST_TTL_SECONDS;
  const payload = `guest.${id}.${expiry}`;
  return { guestId: id, token: `g.${id}.${expiry}.${hmac(payload)}` };
}

function verifyGuestToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== "g" || !process.env.ACCESS_TOKEN_SECRET) return null;
  const [, id, expiryStr, sig] = parts;
  if (!safeEqualHex(sig, hmac(`guest.${id}.${expiryStr}`))) return null;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) return null;
  return { guestId: id };
}

function newInviteToken() {
  return crypto.randomBytes(24).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Thin Supabase REST/Storage client using the service-role key.
function sbConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

async function sbRest(cfg, path, opts) {
  const resp = await fetch(`${cfg.url}/rest/v1/${path}`, Object.assign({ headers: cfg.headers }, opts || {}));
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// Short-lived URL to download a private file.
async function signedDownloadUrl(cfg, path, expiresIn) {
  const resp = await fetch(`${cfg.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST", headers: cfg.headers, body: JSON.stringify({ expiresIn: expiresIn || 3600 }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data && data.signedURL ? `${cfg.url}/storage/v1${data.signedURL}` : null;
}

// Short-lived URL the browser can PUT a file to directly (no server relay).
async function signedUploadUrl(cfg, path) {
  const resp = await fetch(`${cfg.url}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST", headers: cfg.headers, body: "{}",
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data && data.url ? `${cfg.url}/storage/v1${data.url}` : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = {
  BUCKET, UUID_RE, canCollaborate, parseBody, verifyAccessToken, signGuestToken, verifyGuestToken,
  newInviteToken, sbConfig, sbRest, signedDownloadUrl, signedUploadUrl,
};
