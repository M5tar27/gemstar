// Vercel serverless function: /api/check-access
// Checks Stripe for an active Gemstar subscription tied to the given email.
// Requires env vars: STRIPE_SECRET_KEY, ACCESS_TOKEN_SECRET

const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Owners/founders get permanent free access — no Stripe subscription required.
const ALLOWLIST = [
  "m5tarmusicnyc@gmail.com",
  "gemsquadproductions@gmail.com",
];

function b64url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signToken(email) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${b64url(email.toLowerCase())}.${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
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

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(400).json({ access: false, error: "Valid email required" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const tokenSecret = process.env.ACCESS_TOKEN_SECRET;
  if (!secretKey || !tokenSecret) {
    res.status(500).json({ access: false, error: "Server not configured" });
    return;
  }

  if (ALLOWLIST.includes(email)) {
    const token = signToken(email);
    res.status(200).json({ access: true, token });
    return;
  }

  try {
    // 1. Find Stripe customer(s) by email
    const custResp = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const custData = await custResp.json();

    if (!custData.data || custData.data.length === 0) {
      res.status(200).json({ access: false });
      return;
    }

    // 2. Check each matching customer for an active or trialing subscription
    let hasActiveSub = false;
    for (const customer of custData.data) {
      const subResp = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=10`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const subData = await subResp.json();
      if (subData.data && subData.data.length > 0) {
        hasActiveSub = true;
        break;
      }
      const trialResp = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=trialing&limit=10`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const trialData = await trialResp.json();
      if (trialData.data && trialData.data.length > 0) {
        hasActiveSub = true;
        break;
      }
    }

    if (!hasActiveSub) {
      res.status(200).json({ access: false });
      return;
    }

    const token = signToken(email);
    res.status(200).json({ access: true, token });
  } catch (err) {
    res.status(500).json({ access: false, error: "Lookup failed" });
  }
};
