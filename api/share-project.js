// Vercel serverless function: /api/share-project
// The owner shares one of their cloud-saved projects with another Gemstar
// user by email (or revokes a share), so that person's own "My Projects"
// list picks it up too -- the actual hand-off for working on a project
// together across two different accounts/computers (e.g. with Jewels).
// Mix + Unlimited tiers only, like the rest of Gemstar's collaboration
// features; the personal cloud save/sync itself (save-project etc.) is
// not gated this way.
//
// POST { token, deviceId, projectId, email, remove? }
// -> { ok: true, sharedWith: [] }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.requireCollab(body, res);
  if (!who) return;

  const projectId = String(body.projectId || "");
  if (!C.UUID_RE.test(projectId)) return res.status(400).json({ error: "Invalid project" });

  const shareEmail = String(body.email || "").trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareEmail);
  if (!emailOk) return res.status(400).json({ error: "Enter a valid email" });
  if (shareEmail === who.email) return res.status(400).json({ error: "That's your own account" });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  try {
    const rows = await C.sbRest(cfg,
      `gemstar_user_projects?id=eq.${projectId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,name,shared_with`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return res.status(404).json({ error: "Project not found" });

    let current = Array.isArray(row.shared_with) ? row.shared_with.slice() : [];
    const remove = body.remove === true;
    if (remove) {
      current = current.filter(function (e) { return e !== shareEmail; });
    } else if (current.indexOf(shareEmail) === -1) {
      current.push(shareEmail);
    }

    const updated = await C.sbRest(cfg, `gemstar_user_projects?id=eq.${projectId}`, {
      method: "PATCH",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=representation" }),
      body: JSON.stringify({ shared_with: current }),
    });
    const newRow = Array.isArray(updated) && updated[0];

    if (!remove) {
      C.sendEmail(
        shareEmail,
        `${who.email} shared a Gemstar project with you`,
        `<p><strong>${C.escapeHtml(who.email)}</strong> shared their Gemstar project "${C.escapeHtml(row.name || "Untitled")}" with you.</p>
         <p>Open <a href="${C.siteUrl()}/">Gemstar</a> and verify with this email (${C.escapeHtml(shareEmail)}) to see it under My Projects.</p>`
      );
    }

    return res.status(200).json({ ok: true, sharedWith: (newRow && newRow.shared_with) || current });
  } catch (err) {
    return res.status(500).json({ error: "Could not update sharing" });
  }
};
