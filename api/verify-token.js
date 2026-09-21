// Vercel serverless function: /api/verify-token
// Verifies a signed access token issued by /api/check-access or
// /api/verify-code, and reports back which plan tier it was issued for
// (starter / mix / unlimited) so the browser can restore the right feature
// set after a page reload without re-checking Stripe.
// Requires env var: ACCESS_TOKEN_SECRET

const crypto = require("crypto");
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);

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
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!token || !secret) {
    res.status(200).json({ valid: false });
    return;
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    res.status(200).json({ valid: false });
    return;
  }

  const [b64email, tierRaw, expiryStr, sig] = parts;
  const payload = `${b64email}.${tierRaw}.${expiryStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const validSig =
    sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  const expiry = parseInt(expiryStr, 10);
  const notExpired = Number.isFinite(expiry) && expiry > Math.floor(Date.now() / 1000);
  const tier = VALID_TIERS.indexOf(tierRaw) === -1 ? "starter" : tierRaw;

  const ok = Boolean(validSig && notExpired);
  res.status(200).json({ valid: ok, tier: ok ? tier : undefined });
};
