// Vercel serverless function: /api/verify-token
// Verifies a signed access token issued by /api/check-access.
// Requires env var: ACCESS_TOKEN_SECRET

const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(200).json({ valid: false });
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
  if (parts.length !== 3) {
    res.status(200).json({ valid: false });
    return;
  }

  const [b64email, expiryStr, sig] = parts;
  const payload = `${b64email}.${expiryStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const validSig =
    sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  const expiry = parseInt(expiryStr, 10);
  const notExpired = Number.isFinite(expiry) && expiry > Math.floor(Date.now() / 1000);

  res.status(200).json({ valid: Boolean(validSig && notExpired) });
};
