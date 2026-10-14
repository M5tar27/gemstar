// Vercel serverless function: /api/delete-project
// The owner permanently deletes one of their cloud-saved projects: its
// audio files and the database row. Only the project's owner may delete it
// -- someone it was shared with can only lose access via /api/share-project
// (remove: true) from the owner's side.
//
// POST { token, deviceId, projectId }
// -> { ok: true }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });

  const projectId = String(body.projectId || "");
  if (!C.UUID_RE.test(projectId)) return res.status(400).json({ error: "Invalid project" });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  try {
    const rows = await C.sbRest(cfg,
      `gemstar_user_projects?id=eq.${projectId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,lead,extras`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return res.status(404).json({ error: "Project not found" });

    const paths = [];
    if (row.lead && row.lead.path) paths.push(row.lead.path);
    (Array.isArray(row.extras) ? row.extras : []).forEach(function (e) { if (e && e.path) paths.push(e.path); });

    // Delete the database row first so the project disappears even if a
    // file delete fails; leftover files are unreachable (private bucket, no row).
    await C.sbRest(cfg, `gemstar_user_projects?id=eq.${projectId}`, {
      method: "DELETE",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
    });
    await Promise.all(paths.map(function (p) { return C.deleteObject(cfg, p, C.PROJECTS_BUCKET); }));

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Could not delete this project" });
  }
};
