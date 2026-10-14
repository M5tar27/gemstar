// Vercel serverless function: /api/save-project
// Creates or updates one of the caller's cloud-saved projects: the named,
// reopenable "My Projects" entries, but tied to their verified email
// instead of living only in one browser's storage. Available to every
// verified tier (not just Mix/Unlimited) -- this is "don't lose your
// work", not a collaboration feature (see /api/share-project for that).
// Returns short-lived signed URLs the browser uploads the lead vocal and
// any extra vocal files to directly.
//
// POST { token, deviceId, projectId?, name, settings, lead?, extras? }
//   lead/extras items: { name, type, ext }
// -> { projectId, name, updatedAt, leadUploadUrl, extraUploadUrls: [] }

const crypto = require("crypto");
const C = require("./_lib/common");

const ALLOWED_EXT = ["wav", "mp3", "m4a", "webm", "ogg"];
const MAX_EXTRAS = 20;

function cleanFileMeta(f) {
  if (!f || typeof f !== "object") return null;
  const name = String(f.name || "").slice(0, 200);
  const ext = ALLOWED_EXT.indexOf(String(f.ext || "").toLowerCase()) === -1 ? "wav" : String(f.ext).toLowerCase();
  return { name, ext };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  const name = String(body.name || "Untitled").trim().slice(0, 80) || "Untitled";
  let settings = body.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) settings = {};

  const lead = cleanFileMeta(body.lead);
  const extrasIn = Array.isArray(body.extras) ? body.extras.slice(0, MAX_EXTRAS) : [];
  const extras = extrasIn.map(cleanFileMeta).filter(Boolean);

  let projectId = String(body.projectId || "");
  const isUpdate = C.UUID_RE.test(projectId);

  try {
    if (isUpdate) {
      // Only the owner may overwrite an existing cloud project -- a stale
      // or spoofed id just gets a 404, never a silent takeover.
      const existing = await C.sbRest(cfg, `gemstar_user_projects?id=eq.${projectId}&select=id,owner_email`);
      const row = Array.isArray(existing) && existing[0];
      if (!row || row.owner_email !== who.email) return res.status(404).json({ error: "Project not found" });
    } else {
      projectId = crypto.randomUUID();
    }

    const leadPath = lead ? `${projectId}/lead.${lead.ext}` : null;
    const extraPaths = extras.map(function (e, i) { return `${projectId}/extra-${i}.${e.ext}`; });

    const [leadUploadUrl, extraUploadUrls] = await Promise.all([
      leadPath ? C.signedUploadUrl(cfg, leadPath, C.PROJECTS_BUCKET) : Promise.resolve(null),
      Promise.all(extraPaths.map(function (p) { return C.signedUploadUrl(cfg, p, C.PROJECTS_BUCKET); })),
    ]);
    if (lead && !leadUploadUrl) return res.status(502).json({ error: "Could not prepare upload. Try again." });
    if (extraPaths.length && extraUploadUrls.indexOf(null) !== -1) {
      return res.status(502).json({ error: "Could not prepare upload. Try again." });
    }

    const updatedAt = new Date().toISOString();
    const row = {
      id: projectId,
      owner_email: who.email,
      name: name,
      settings: settings,
      lead: lead ? { name: lead.name, path: leadPath } : null,
      extras: extras.map(function (e, i) { return { name: e.name, path: extraPaths[i] }; }),
      updated_at: updatedAt,
    };

    // Upsert: only the columns present in `row` are written, so an existing
    // project's created_at and shared_with are left untouched (PostgREST
    // merge-duplicates only sets the columns it was given).
    await C.sbRest(cfg, "gemstar_user_projects", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(row),
    });

    return res.status(200).json({
      projectId: projectId, name: name, updatedAt: updatedAt,
      leadUploadUrl: leadUploadUrl, extraUploadUrls: extraUploadUrls,
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not save this project" });
  }
};
