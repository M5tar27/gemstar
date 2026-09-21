// Vercel serverless function: /api/verify-code
// Step 2 of email verification. Takes the {challenge} handed back by
// /api/check-access plus the 6-digit code the user got by email, and checks
// the code without ever having stored it anywhere — the challenge carries an
// HMAC signature of email+tier+code+expiry, so only the correct code
// reproduces a matching signature. The tier travels inside that challenge
// (set by /api/check-access from the real Stripe lookup), so it's baked into
// the final access token here without a second Stripe call. On success,
// issues the same long-lived signed access token /api/check-access already
// issues for allowlisted founders.
//
// Requires env var: ACCESS_TOKEN_SECRET

const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);

function normalizeTier(tier) {
  return VALID_TIERS.indexOf(tier) === -1 ? "starter" : tier;
}

function b64url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input) {
  var s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function signToken(email, tier) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${b64url(email.toLowerCase())}.${normalizeTier(tier)}.${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ access: false, error: "Method not allowed" });
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

  const challenge = body.challenge || "";
  const code = (body.code || "").trim();
  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!challenge || !code || !secret) {
    res.status(200).json({ access: false, error: "Missing code" });
    return;
  }

  const parts = challenge.split(".");
  if (parts.length !== 4) {
    res.status(200).json({ access: false, error: "Invalid or expired code" });
    return;
  }

  const [b64email, tierRaw, expiryStr, sig] = parts;
  const tier = normalizeTier(tierRaw);
  const expiry = parseInt(expiryStr, 10);
  const notExpired = Number.isFinite(expiry) && expiry > Math.floor(Date.now() / 1000);
  if (!notExpired) {
    res.status(200).json({ access: false, error: "That code expired — request a new one." });
    return;
  }

  let email;
  try {
    email = b64urlDecode(b64email);
  } catch (e) {
    res.status(200).json({ access: false, error: "Invalid or expired code" });
    return;
  }

  const expectedPayload = `otp.${email}.${tier}.${code}.${expiryStr}`;
  const expected = crypto.createHmac("sha256", secret).update(expectedPayload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const validSig = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!validSig) {
    res.status(200).json({ access: false, error: "Incorrect code — check your email and try again." });
    return;
  }

  const token = signToken(email, tier);
  res.status(200).json({ access: true, token: token, tier: tier });
};
