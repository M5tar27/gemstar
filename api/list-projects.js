// Vercel serverless function: /api/list-projects
// Lists cloud-saved projects for the caller's verified email: ones they
// own, plus ones another Gemstar user has shared with them (see
// /api/share-project). Available to every verified tier.
//
// POST { token, deviceId }
// -> { projects: [{ id, name, updatedAt, ownerEmail, isOwner, sharedWith }] }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

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
};
