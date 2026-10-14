// Vercel serverless function: /api/get-project
// Returns one cloud-saved project's full settings plus short-lived signed
// download URLs for its audio files, so the browser can reopen it exactly
// as it was. Only the owner or someone it's been shared with may fetch it.
//
// POST { token, deviceId, projectId }
// -> { id, name, settings, ownerEmail, isOwner, sharedWith,
//      lead: { name, url } | null, extras: [{ name, url }] }

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
      `gemstar_user_projects?id=eq.${projectId}&select=id,owner_email,name,settings,lead,extras,shared_with`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return res.status(404).json({ error: "Project not found" });

    const isOwner = row.owner_email === who.email;
    const sharedWith = Array.isArray(row.shared_with) ? row.shared_with : [];
    if (!isOwner && sharedWith.indexOf(who.email) === -1) {
      return res.status(404).json({ error: "Project not found" });
    }

    const extras = Array.isArray(row.extras) ? row.extras : [];
    const [leadUrl, extraUrls] = await Promise.all([
      row.lead && row.lead.path ? C.signedDownloadUrl(cfg, row.lead.path, 3600, C.PROJECTS_BUCKET) : Promise.resolve(null),
      Promise.all(extras.map(function (e) {
        return e && e.path ? C.signedDownloadUrl(cfg, e.path, 3600, C.PROJECTS_BUCKET) : Promise.resolve(null);
      })),
    ]);

    return res.status(200).json({
      id: row.id, name: row.name, settings: row.settings || {},
      ownerEmail: row.owner_email, isOwner: isOwner, sharedWith: sharedWith,
      lead: row.lead ? { name: row.lead.name, url: leadUrl } : null,
      extras: extras.map(function (e, i) { return { name: e.name, url: extraUrls[i] }; }),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load this project" });
  }
};
