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
// Also handles { action: "portal" }: once the token/device check above
// passes, decodes the verified email out of the token and opens a Stripe
// Billing Portal session for it, so a subscriber can cancel (or update
// their payment method) without emailing support. This reuses
// STRIPE_SECRET_KEY -- no new env var beyond the portal configuration ID
// below, which was created once via the Stripe API.
//
// Also handles { action: "single-export" }: the no-subscription-required
// escape hatch -- someone pays $3.99 once (via a Stripe Payment Link, same
// pattern as the three plan buttons) for one song's export, and Stripe
// redirects back here with the Checkout Session id. This call confirms with
// Stripe that the session actually paid for the Single Export price, then
// marks that session as redeemed in Supabase so the same success URL can't
// be bookmarked and reused for a free export later. Deliberately not tied
// to a Gemstar account/token -- the Stripe payment itself is the proof.
//
// Requires env var: ACCESS_TOKEN_SECRET
// Optional (for action:"portal"): STRIPE_SECRET_KEY, SITE_URL
// Optional (for action:"single-export"): STRIPE_SECRET_KEY, SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY

const crypto = require("crypto");
const C = require("./_lib/common");
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);

// Stripe billing_portal.Configuration created for Gemstar: lets a customer
// cancel (end of period) or update their payment method and see invoice
// history. Created once via the API -- see Stripe dashboard > Settings >
// Billing > Customer portal for the live config.
const PORTAL_CONFIGURATION_ID = "bpc_1UQcQuAJB6rfYz7KqBiRZB4x";

// The one-time $3.99 "export this one song" Stripe Price -- created once
// via the API. Checked against the Checkout Session's line items so a
// session that paid for something else can't be replayed here.
const SINGLE_EXPORT_PRICE_ID = "price_1UYbErAJB6rfYz7KYUPSno8T";

function b64urlDecode(input) {
  var s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function siteUrl() {
  return (process.env.SITE_URL || "https://gemstaraudio.com").replace(/\/+$/, "");
}

// Shared by the default (valid/tier) check and the portal action: validates
// signature + expiry + device binding, and also decodes the email so
// action:"portal" can look the customer up in Stripe.
function verify(token, presentedDeviceId) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!token || !secret) return null;

  const parts = String(token).split(".");
  // Legacy 4-part tokens (issued before device-binding) are no longer
  // honored -- everyone re-verifies once and gets a device-bound token.
  if (parts.length !== 5) return null;

  const [b64email, tierRaw, b64deviceId, expiryStr, sig] = parts;
  const payload = `${b64email}.${tierRaw}.${b64deviceId}.${expiryStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const validSig =
    sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  if (!validSig) return null;

  const expiry = parseInt(expiryStr, 10);
  const notExpired = Number.isFinite(expiry) && expiry > Math.floor(Date.now() / 1000);
  if (!notExpired) return null;

  let email, tokenDeviceId;
  try {
    email = b64urlDecode(b64email).toLowerCase();
    tokenDeviceId = b64urlDecode(b64deviceId);
  } catch (e) {
    return null;
  }
  const deviceOk = tokenDeviceId === "*" || tokenDeviceId === presentedDeviceId;
  if (!deviceOk) return null;

  const tier = VALID_TIERS.indexOf(tierRaw) === -1 ? "starter" : tierRaw;
  return { email, tier };
}

async function createPortalSession(email) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "Billing isn't configured yet." };

  const custResp = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  const custData = await custResp.json();
  const customer = custData && custData.data && custData.data[0];
  if (!customer) {
    return { ok: false, error: "We couldn't find a billing account for that email -- email Gemstaraudio@gmail.com." };
  }

  const params = new URLSearchParams();
  params.set("customer", customer.id);
  params.set("configuration", PORTAL_CONFIGURATION_ID);
  params.set("return_url", `${siteUrl()}/`);

  const sessionResp = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const session = await sessionResp.json();
  if (!sessionResp.ok || !session || !session.url) {
    return { ok: false, error: "Could not open the billing portal. Try again shortly." };
  }
  return { ok: true, url: session.url };
}

// Confirms a Checkout Session really paid for the Single Export price, then
// atomically claims it in Supabase (session_id is the primary key, so a
// second attempt to insert the same session fails and the export stays
// locked). Fails closed on any error -- no export without a clean redeem.
async function redeemSingleExport(sessionId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "Payments aren't configured yet." };
  if (!/^cs_[a-zA-Z0-9_]+$/.test(String(sessionId || ""))) {
    return { ok: false, error: "Invalid payment session." };
  }

  let session;
  try {
    const resp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    session = await resp.json();
    if (!resp.ok || !session) return { ok: false, error: "Could not verify that payment." };
  } catch (e) {
    return { ok: false, error: "Could not verify that payment." };
  }

  if (session.payment_status !== "paid") {
    return { ok: false, error: "That payment hasn't completed yet." };
  }
  const items = (session.line_items && session.line_items.data) || [];
  const paidForExport = items.some((li) => li.price && li.price.id === SINGLE_EXPORT_PRICE_ID);
  if (!paidForExport) {
    return { ok: false, error: "That payment doesn't match the single-export price." };
  }

  const cfg = C.sbConfig();
  if (!cfg) return { ok: false, error: "Server not configured" };
  try {
    await C.sbRest(cfg, "gemstar_single_export_redemptions", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({ session_id: sessionId }),
    });
  } catch (err) {
    // Supabase rejects the duplicate primary key -- this session already
    // unlocked an export once.
    return { ok: false, error: "This export link has already been used." };
  }

  return { ok: true };
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

  if (body.action === "single-export") {
    try {
      const result = await redeemSingleExport(body.sessionId);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: "Could not verify that payment. Try again shortly." });
    }
    return;
  }

  const token = body.token || "";
  const presentedDeviceId = (body.deviceId || "").trim();
  const who = verify(token, presentedDeviceId);

  if (body.action === "portal") {
    if (!who) {
      res.status(200).json({ ok: false, error: "Please verify your Gemstar account first." });
      return;
    }
    try {
      const result = await createPortalSession(who.email);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: "Could not open the billing portal. Try again shortly." });
    }
    return;
  }

  res.status(200).json({ valid: !!who, tier: who ? who.tier : undefined });
};
