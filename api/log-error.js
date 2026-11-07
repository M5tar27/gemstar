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

module.exports = async (req, res) => {
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
