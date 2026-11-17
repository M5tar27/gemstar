// Vercel serverless function: /api/log-error
// Best-effort client-side crash/error telemetry. The browser posts here
// whenever a `window.onerror` or `unhandledrejection` fires (see the
// reporter IIFE at the very top of index.html's main script), so real
// errors on real users' devices show up in Supabase instead of only
// surfacing if that person happens to email support.
//
// Deliberately NOT gated behind auth -- an error can happen before anyone's
// verified an account -- so this is public, unauthenticated, best-effort
// telemetry. That means it's also a theoretical spam target; the caps below
// (field length, rows accepted) keep a flood from doing more than filling a
// table, and a write failure here never surfaces to the user or throws.
//
// POST { message, stack?, sourceUrl?, line?, col?, userAgent?, tier?, pageUrl? }
// -> { ok: true } always (even on failure -- see note above)
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const C = require("./_lib/common");

function clamp(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function clampInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Daily storage check, triggered by the Vercel cron in vercel.json
// (GET /api/log-error?job=storage-check). Lives here only because the Hobby
// plan caps us at 12 functions and this one is already deployed. Emails the
// owner when Supabase Storage passes WARN_PCT of STORAGE_LIMIT_MB so there is
// time to upgrade the plan or clean up before uploads start failing.
//
// Auth: Vercel automatically sends "Authorization: Bearer $CRON_SECRET" on
// cron calls when a CRON_SECRET env var exists. Without that var (or with a
// wrong header) the job refuses to run, so strangers can't trigger emails.
// Optional env: STORAGE_LIMIT_MB (default 1000 = the Supabase free tier, 1 GB),
// STORAGE_WARN_PCT (default 70), ALERT_EMAIL (default the support address).
async function storageCheck(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers["authorization"] !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const cfg = C.sbConfig();
  if (!cfg) { res.status(500).json({ ok: false, error: "not configured" }); return; }
  try {
    const bytes = Number(await C.sbRest(cfg, "rpc/gemstar_storage_usage", { method: "POST", body: "{}" }));
    if (!Number.isFinite(bytes)) throw new Error("bad usage value");
    const limitMb = Number(process.env.STORAGE_LIMIT_MB) > 0 ? Number(process.env.STORAGE_LIMIT_MB) : 1000;
    const warnPct = Number(process.env.STORAGE_WARN_PCT) > 0 ? Number(process.env.STORAGE_WARN_PCT) : 70;
    const usedMb = bytes / (1024 * 1024);
    const pct = (usedMb / limitMb) * 100;
    let emailed = false;
    if (pct >= warnPct) {
      const to = process.env.ALERT_EMAIL || "Gemstaraudio@gmail.com";
      emailed = await C.sendEmail(
        to,
        `Gemstar storage is ${Math.round(pct)}% full`,
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:20px;">` +
          `<h2 style="margin:0 0 12px;">Gemstar storage is ${Math.round(pct)}% full</h2>` +
          `<p>Supabase Storage is using <b>${usedMb.toFixed(0)} MB</b> of the <b>${limitMb} MB</b> limit I'm checking against ` +
          `(warning at ${warnPct}%).</p>` +
          `<p>Collab tracks and saved projects stop uploading once it is full. Upgrade the Supabase plan or clear old files ` +
          `before that. If your plan's limit isn't ${limitMb} MB, set STORAGE_LIMIT_MB in Vercel.</p></div>`
      );
    }
    res.status(200).json({ ok: true, usedMb: Math.round(usedMb), limitMb, pct: Math.round(pct), emailed });
  } catch (e) {
    res.status(500).json({ ok: false, error: "check failed" });
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET" && req.query && req.query.job === "storage-check") {
    await storageCheck(req, res);
    return;
  }
  // Always 200 -- this endpoint must never give the browser a reason to
  // retry-loop or throw from inside an error handler.
  if (req.method !== "POST") {
    res.status(200).json({ ok: true });
    return;
  }

  const body = C.parseBody(req);
  const message = clamp(body.message, 500);
  if (!message) {
    res.status(200).json({ ok: true });
    return;
  }

  const row = {
    message,
    stack: clamp(body.stack, 4000),
    source_url: clamp(body.sourceUrl, 500),
    page_url: clamp(body.pageUrl, 500),
    line: clampInt(body.line),
    col: clampInt(body.col),
    user_agent: clamp(body.userAgent || req.headers["user-agent"], 300),
    tier: clamp(body.tier, 20),
  };

  const cfg = C.sbConfig();
  if (!cfg) {
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await C.sbRest(cfg, "gemstar_client_errors", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  } catch (err) {
    // Swallow -- telemetry failing silently beats a telemetry endpoint
    // that itself becomes a source of errors/retries.
  }

  res.status(200).json({ ok: true });
};
