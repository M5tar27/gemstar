// Vercel serverless function: /api/delete-track
// The owner permanently deletes one of their collaborative tracks: the base
// audio, every layer's audio, and (via ON DELETE CASCADE) the track row, its
// members, invite links, layers and reports. Mix + Unlimited tiers only, and
// only for the track's owner.
//
// POST { token, deviceId, trackId }
// -> { ok: true }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.requireCollab(body, res);
  if (!who) return;

  const trackId = String(body.trackId || "");
  if (!C.UUID_RE.test(trackId)) return res.status(400).json({ error: "Invalid track" });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  try {
    // Ownership is checked against the track row, never trusted from the client.
    const tracks = await C.sbRest(cfg,
      `gemstar_tracks?id=eq.${trackId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,base_audio_path`);
    const track = Array.isArray(tracks) && tracks[0];
    if (!track) return res.status(404).json({ error: "Track not found" });

    const layers = await C.sbRest(cfg, `gemstar_track_layers?track_id=eq.${trackId}&select=audio_path`);
    const paths = (Array.isArray(layers) ? layers : []).map((l) => l.audio_path);
    if (track.base_audio_path) paths.push(track.base_audio_path);

    // Delete the database rows first so the track disappears even if a file
    // delete fails; leftover files are unreachable (private bucket, no rows).
    await C.sbRest(cfg, `gemstar_tracks?id=eq.${trackId}`, {
      method: "DELETE",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
    });
    await Promise.all(paths.filter(Boolean).map((p) => C.deleteObject(cfg, p)));

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Could not delete this track" });
  }
};
