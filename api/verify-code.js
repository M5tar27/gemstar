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
// Also enforces a per-account device cap: this is where tokens actually get
// minted, so it's where a brand-new device either gets recorded (if the
// account has fewer than MAX_DEVICES already) or hard-blocked (if it
// doesn't). Device rows live in Supabase, not in the token itself -- the
// token just carries whichever deviceId got approved here.
//
// Requires env vars: ACCESS_TOKEN_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TIER_RANK = { starter: 1, mix: 2, unlimited: 3 };
const VALID_TIERS = Object.keys(TIER_RANK);
const MAX_DEVICES = 3;

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

function signToken(email, tier, deviceId) {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${b64url(email.toLowerCase())}.${normalizeTier(tier)}.${b64url(deviceId || "*")}.${expiry}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// Checks this email's known devices against the cap, using Supabase as the
// one bit of durable server-side state the rest of this system deliberately
// avoids. Returns {ok:true} to proceed (and records a brand-new device), or
// {ok:false, error} to hard-block a device beyond the cap. Fails OPEN on a
// Supabase/config hiccup -- a transient infra error shouldn't lock a paying
// customer out of their own account.
async function checkAndRecordDevice(email, deviceId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: true };

  try {
    const listResp = await fetch(
      `${url}/rest/v1/gemstar_devices?email=eq.${encodeURIComponent(email)}&select=device_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!listResp.ok) return { ok: true };
    const known = await listResp.json();
    const knownIds = (Array.isArray(known) ? known : []).map((d) => d.device_id);

    if (knownIds.indexOf(deviceId) !== -1) {
      // Already-known device -- just bump last_seen_at, best-effort.
      fetch(
        `${url}/rest/v1/gemstar_devices?email=eq.${encodeURIComponent(email)}&device_id=eq.${encodeURIComponent(deviceId)}`,
        {
          method: "PATCH",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
        }
      ).catch(() => {});
      return { ok: true };
    }

    if (knownIds.length >= MAX_DEVICES) {
      return {
        ok: false,
        error: `This Gemstar account is already active on ${MAX_DEVICES} devices. Remove one (or email Gemstaraudio@gmail.com) before adding another.`,
      };
    }

    // Brand-new device, still under the cap -- record it.
    await fetch(`${url}/rest/v1/gemstar_devices`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ email: email, device_id: deviceId }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: true }; // fail open
  }
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
  const deviceId = (body.deviceId || "").trim();
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

  if (!deviceId) {
    res.status(200).json({ access: false, error: "Missing device info — refresh the page and try again." });
    return;
  }

  const deviceCheck = await checkAndRecordDevice(email, deviceId);
  if (!deviceCheck.ok) {
    res.status(200).json({ access: false, error: deviceCheck.error });
    return;
  }

  const token = signToken(email, tier, deviceId);
  res.status(200).json({ access: true, token: token, tier: tier });
};
