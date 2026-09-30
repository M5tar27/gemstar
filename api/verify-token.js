// Vercel serverless function: /api/verify-token
// Verifies a signed access token issued by /api/check-access or
// /api/verify-code, and reports back which plan tier it was issued for
// (starter / mix / unlimited) so the browser can restore the right feature
// set after a page reload without re-checking Stripe.
//
// Tokens are now bound to the device they were issued to: the signed
// payload carries a deviceId, and the caller must present the matching
// deviceId for the token to count as valid. This is what makes the 3-device
// cap (enforced at /api/verify-code, where tokens are minted) actually
// stick -- without it, someone could just copy the long-lived token string
// itself to another device/friend and skip the device check entirely.
// "*" is the wildcard deviceId used for allowlisted founders' tokens, which
// matches any device.
//
// Requires env var: ACCESS_TOKEN_SECRET

const crypto = require("crypto");
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);

function b64urlDecode(input) {
  var s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ valid: false });
    return;
  }

  let body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (e) {
      body = {};
    }
  }

  const token = body.token || "";
  const presentedDeviceId = (body.deviceId || "").trim();
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!token || !secret) {
    res.status(200).json({ valid: false });
    return;
  }

  const parts = token.split(".");
  // Legacy 4-part tokens (issued before device-binding) are no longer
  // honored -- everyone re-verifies once and gets a device-bound token.
  if (parts.length !== 5) {
    res.status(200).json({ valid: false });
    return;
  }

  const [b64email, tierRaw, b64deviceId, expiryStr, sig] = parts;
  const payload = `${b64email}.${tierRaw}.${b64deviceId}.${expiryStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const validSig =
    sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  const expiry = parseInt(expiryStr, 10);
  const notExpired = Number.isFinite(expiry) && expiry > Math.floor(Date.now() / 1000);
  const tier = VALID_TIERS.indexOf(tierRaw) === -1 ? "starter" : tierRaw;

  let tokenDeviceId = "";
  try {
    tokenDeviceId = b64urlDecode(b64deviceId);
  } catch (e) {
    res.status(200).json({ valid: false });
    return;
  }
  const deviceOk = tokenDeviceId === "*" || tokenDeviceId === presentedDeviceId;

  const ok = Boolean(validSig && notExpired && deviceOk);
  res.status(200).json({ valid: ok, tier: ok ? tier : undefined });
};
