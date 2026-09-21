// Vercel serverless function: /api/check-access
// Step 1 of email verification. Checks Stripe for an active Gemstar
// subscription tied to the given email, and figures out which PLAN TIER
// (starter / mix / unlimited) that subscription is actually on — not just
// whether one exists. If found, emails a 6-digit one-time code to that
// address (proves the requester actually owns the inbox, not just that
// they typed a valid customer's email) and returns a signed, stateless
// "challenge" — NOT the code itself — for /api/verify-code to check the
// code against. The tier travels inside that signed challenge so
// /api/verify-code can bake it into the final access token without a
// second Stripe lookup. No database: the code is never stored server-side,
// only its HMAC signature travels back to the browser.
//
// Requires env vars: STRIPE_SECRET_KEY, ACCESS_TOKEN_SECRET, RESEND_API_KEY
// Optional env var: EMAIL_FROM (defaults to Gemstar <onboarding@resend.dev>)

const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — long-lived access token
const CODE_TTL_SECONDS = 60 * 10;            // 10 minutes — one-time code window

// Owners/founders get permanent free access at the top tier — no Stripe
// subscription or email verification required.
const ALLOWLIST = [
  "m5tarmusicnyc@gmail.com",
  "gemsquadproductions@gmail.com",
];
const ALLOWLIST_TIER = "unlimited";

// Maps a Stripe Product ID to the Gemstar plan tier it represents. Product
// IDs are stable even if you edit a price's amount later, so tier detection
// keys off `price.product`, not the price ID itself.
const PRODUCT_TIER_MAP = {
  prod_VGeemVmgb2KTRG: "starter",   // $19/mo
  prod_VGeeXma5qjaaS3: "mix",       // $49/mo
  prod_VGeeA7bsIqkNBz: "unlimited", // $99/mo
};
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);

function b64url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalizeTier(tier) {
  return VALID_TIERS.indexOf(tier) === -1 ? "starter" : tier;
}

function signToken(email, tier) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${b64url(email.toLowerCase())}.${normalizeTier(tier)}.${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function signCodeChallenge(email, tier, code, expiry) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const t = normalizeTier(tier);
  const payload = `otp.${email}.${t}.${code}.${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${b64url(email)}.${t}.${expiry}.${sig}`;
}

// Given a Stripe subscription object, returns the highest-ranked Gemstar
// tier represented among its line items, or null if none of its prices
// belong to a Gemstar product we recognize.
function bestTierFromSubscription(sub) {
  var best = null;
  var items = (sub && sub.items && sub.items.data) || [];
  for (var i = 0; i < items.length; i++) {
    var productId = items[i].price && items[i].price.product;
    var tier = productId && PRODUCT_TIER_MAP[productId];
    if (tier && (!best || TIER_RANK[tier] > TIER_RANK[best])) best = tier;
  }
  return best;
}

async function sendCodeEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Gemstar <onboarding@resend.dev>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from,
      to: [email],
      subject: `${code} is your Gemstar export code`,
      html:
        `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;">` +
        `<img src="https://gemstaraudio.com/email-logo.png" width="140" alt="Gemstar" style="display:block;margin:0 auto 20px;">` +
        `<h2 style="margin:0 0 12px;">Your Gemstar export code</h2>` +
        `<p style="color:#555;font-size:14px;">Enter this code in Gemstar to unlock MP3 export:</p>` +
        `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:20px 0;">${code}</p>` +
        `<p style="color:#888;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>` +
        `</div>`,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Resend error ${resp.status}: ${errText}`);
  }
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

  // Founders: instant access at the top tier, no code needed.
  if (ALLOWLIST.includes(email)) {
    const token = signToken(email, ALLOWLIST_TIER);
    res.status(200).json({ access: true, token, tier: ALLOWLIST_TIER });
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

    // 2. Check each matching customer for an active or trialing subscription,
    //    and figure out the highest tier among them.
    let hasActiveSub = false;
    let bestTier = null;
    for (const customer of custData.data) {
      const subResp = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active&limit=10`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const subData = await subResp.json();
      if (subData.data && subData.data.length > 0) {
        hasActiveSub = true;
        subData.data.forEach(function (sub) {
          const t = bestTierFromSubscription(sub);
          if (t && (!bestTier || TIER_RANK[t] > TIER_RANK[bestTier])) bestTier = t;
        });
      }
      const trialResp = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=trialing&limit=10`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const trialData = await trialResp.json();
      if (trialData.data && trialData.data.length > 0) {
        hasActiveSub = true;
        trialData.data.forEach(function (sub) {
          const t = bestTierFromSubscription(sub);
          if (t && (!bestTier || TIER_RANK[t] > TIER_RANK[bestTier])) bestTier = t;
        });
      }
    }

    if (!hasActiveSub) {
      res.status(200).json({ access: false });
      return;
    }

    // Has a real subscription, but couldn't match its price to a known
    // Gemstar product (e.g. a legacy/renamed price) — fail safe to Starter
    // rather than silently granting Mix/Unlimited features.
    const tier = normalizeTier(bestTier);

    // 3. Subscribed — verify they actually own this inbox before unlocking.
    if (!process.env.RESEND_API_KEY) {
      res.status(500).json({ access: false, error: "Email delivery not configured" });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
    const expiry = Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS;
    const challenge = signCodeChallenge(email, tier, code, expiry);

    await sendCodeEmail(email, code);

    res.status(200).json({ access: false, ok: true, challenge: challenge });
  } catch (err) {
    res.status(500).json({ access: false, error: "Lookup failed" });
  }
};
