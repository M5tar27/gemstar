// Vercel serverless function: /api/projects
// Consolidates the cloud "My Projects" endpoints into one serverless
// function (save/list/get/delete/share), dispatched by body.action. These
// used to be five separate files (save-project.js, list-projects.js,
// get-project.js, delete-project.js, share-project.js) but the Vercel
// Hobby plan caps a deployment at 12 serverless functions, so they are
// merged here to stay under that limit. Behavior is unchanged from the
// original files -- only the entrypoint and routing are different.
//
// POST { token, deviceId, action, ...action-specific fields }
//
// action: "save"   { projectId?, name, settings, lead?, extras? }
//         "list"   {}
//         "get"    { projectId }
//         "delete" { projectId }
//         "share"  { projectId, email, remove? }  (Mix/Unlimited only)

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

// ---- save: creates or updates one of the caller cloud-saved projects ----
// Available to every verified tier (not just Mix/Unlimited) -- this is
// "do not lose your work", not a collaboration feature (see "share" below).
async function handleSave(body, who, cfg, res) {
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
}

// ---- list: projects the caller owns, plus ones shared with them ----------
async function handleList(body, who, cfg, res) {
  try {
    const emailEnc = encodeURIComponent(who.email);
    const filter = `or=(owner_email.eq.${emailEnc},shared_with.cs.{${who.email}})`;
    const rows = await C.sbRest(cfg,
      `gemstar_user_projects?${filter}&select=id,name,owner_email,shared_with,updated_at&order=updated_at.desc&limit=100`);
    const list = Array.isArray(rows) ? rows : [];
    return res.status(200).json({
      projects: list.map(function (r) {
        return {
          id: r.id, name: r.name, updatedAt: r.updated_at,
          ownerEmail: r.owner_email, isOwner: r.owner_email === who.email,
          sharedWith: Array.isArray(r.shared_with) ? r.shared_with : [],
        };
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load your projects" });
  }
}

// ---- get: one project full settings plus signed download URLs ----------
async function handleGet(body, who, cfg, res) {
  const projectId = String(body.projectId || "");
  if (!C.UUID_RE.test(projectId)) return res.status(400).json({ error: "Invalid project" });

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
}

// ---- delete: the owner permanently deletes one of their projects --------
async function handleDelete(body, who, cfg, res) {
  const projectId = String(body.projectId || "");
  if (!C.UUID_RE.test(projectId)) return res.status(400).json({ error: "Invalid project" });

  try {
    const rows = await C.sbRest(cfg,
      `gemstar_user_projects?id=eq.${projectId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,lead,extras`);
    const row = Array.isArray(rows) && rows[0];
    if (!row) return res.status(404).json({ error: "Project not found" });

    const paths = [];
    if (row.lead && row.lead.path) paths.push(row.lead.path);
    (Array.isArray(row.extras) ? row.extras : []).forEach(function (e) { if (e && e.path) paths.push(e.path); });

    await C.sbRest(cfg, `gemstar_user_projects?id=eq.${projectId}`, {
      method: "DELETE",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
    });
    await Promise.all(paths.map(function (p) { return C.deleteObject(cfg, p, C.PROJECTS_BUCKET); }));

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Could not delete this project" });
  }
}

// ---- share: the owner shares (or revokes) a project with another user ---
// Mix + Unlimited tiers only, like the rest of Gemstar collaboration
// features; the personal cloud save/sync itself (save/list/get/delete) is
// not gated this way. Uses C.requireCollab instead of verifyAccessToken, so
// it is handled separately in the dispatcher below.
async function handleShare(body, who, res) {
  const projectId = String(body.projectId || "");
  if (!C.UUID_RE.test(projectId)) return res.status(400).json({ error: "Invalid project" });

  const shareEmail = String(body.email || "").trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareEmail);
  if (!emailOk) return res.status(400).json({ error: "Enter a valid email" });
  if (shareEmail === who.email) return res.status(400).json({ error: "That is your own account" });

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
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const action = String(body.action || "");

  if (action === "share") {
    const who = C.requireCollab(body, res);
    if (!who) return;
    return handleShare(body, who, res);
  }

  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  switch (action) {
    case "save": return handleSave(body, who, cfg, res);
    case "list": return handleList(body, who, cfg, res);
    case "get": return handleGet(body, who, cfg, res);
    case "delete": return handleDelete(body, who, cfg, res);
    default: return res.status(400).json({ error: "Unknown action" });
  }
};
