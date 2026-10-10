// Vercel serverless function: /api/my-tracks
// Lists the caller's collaborative tracks, newest first, with how many layers
// are waiting for review. Mix + Unlimited tiers only.
//
// POST { token, deviceId }
// -> { tracks: [{ id, title, bpm, createdAt, pending, accepted }] }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.requireCollab(body, res);
  if (!who) return;

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  try {
    const tracks = await C.sbRest(cfg,
      `gemstar_tracks?owner_email=eq.${encodeURIComponent(who.email)}&select=id,title,bpm,created_at&order=created_at.desc&limit=50`);
    const list = Array.isArray(tracks) ? tracks : [];
    const counts = {};
    if (list.length) {
      const ids = list.map((t) => t.id).join(",");
      const layers = await C.sbRest(cfg,
        `gemstar_track_layers?track_id=in.(${ids})&status=in.(pending,accepted)&select=track_id,status`);
      (Array.isArray(layers) ? layers : []).forEach((l) => {
        const c = counts[l.track_id] || (counts[l.track_id] = { pending: 0, accepted: 0 });
        c[l.status] += 1;
      });
    }
    return res.status(200).json({
      tracks: list.map((t) => ({
        id: t.id, title: t.title, bpm: t.bpm, createdAt: t.created_at,
        pending: (counts[t.id] || {}).pending || 0, accepted: (counts[t.id] || {}).accepted || 0,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load your tracks" });
  }
};
