// Vercel serverless function: /api/waitlist
// Real backend for the "Not ready to subscribe?" waitlist form. The
// frontend used to call `window.claude.use("db")` — a capability that only
// exists inside Claude's own artifact preview sandbox. On the real
// gemstaraudio.com site, in a normal browser, that call always failed
// silently, so every waitlist signup was very likely lost.
//
// This replaces it with a plain POST endpoint that emails the signup
// straight to the studio inbox via Resend — the same service and API key
// already configured and confirmed working for the export verification
// codes — so no new database or service needs to be provisioned. Every
// signup also lands in the Resend dashboard's own send log, which doubles
// as a simple record if you ever need to look one up.
//
// Requires env var: RESEND_API_KEY (already set on gemstar-web)
// Optional env vars:
//   WAITLIST_NOTIFY_EMAIL — where signups get sent (defaults to Gemstaraudio@gmail.com)
//   EMAIL_FROM             — sender identity (defaults to Gemstar <onboarding@resend.dev>)

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
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

  const email = (body.email || "").trim();
  const plan = (body.plan || "").trim() || "unspecified";
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !emailRe.test(email)) {
    res.status(200).json({ ok: false, error: "Valid email required" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "Waitlist not configured" });
    return;
  }

  const notifyTo = process.env.WAITLIST_NOTIFY_EMAIL || "Gemstaraudio@gmail.com";
  const from = process.env.EMAIL_FROM || "Gemstar <onboarding@resend.dev>";

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from,
        to: [notifyTo],
        reply_to: email,
        subject: `Gemstar waitlist: ${email}`,
        html:
          `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;">` +
          `<img src="https://gemstaraudio.com/email-logo.png" width="140" alt="Gemstar" style="display:block;margin:0 auto 20px;">` +
          `<h2 style="margin:0 0 12px;">New waitlist signup</h2>` +
          `<p style="color:#555;font-size:14px;">Email: <strong>${escapeHtml(email)}</strong></p>` +
          `<p style="color:#555;font-size:14px;">Interested plan: <strong>${escapeHtml(plan)}</strong></p>` +
          `<p style="color:#888;font-size:12px;">Submitted ${new Date().toISOString()}</p>` +
          `</div>`,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`Resend waitlist error ${resp.status}: ${errText}`);
      res.status(200).json({ ok: false, error: "Couldn't save that — try again." });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    res.status(200).json({ ok: false, error: "Couldn't save that — try again." });
  }
};
