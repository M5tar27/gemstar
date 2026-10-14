// Vercel serverless function: /api/get-track
// Owner view of one track: the base audio plus every non-removed layer, each
// with a short-lived signed playback URL. Guest authors are anonymized
// ("Guest 1", "Guest 2", ...) so no identifiers leave the server.
// Mix + Unlimited tiers only, and only for the track's owner.
//
// POST { token, deviceId, trackId }
// -> { track, baseUrl, layers: [{ id, label, status, offsetMs, volume, createdAt, url }], spotsLeft }

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
    const tracks = await C.sbRest(cfg,
      `gemstar_tracks?id=eq.${trackId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,title,bpm,base_audio_path,max_collaborators`);
    const track = Array.isArray(tracks) && tracks[0];
    if (!track) return res.status(404).json({ error: "Track not found" });

    const rows = await C.sbRest(cfg,
      `gemstar_track_layers?track_id=eq.${trackId}&status=neq.removed&select=id,author_key,audio_path,offset_ms,volume,status,created_at&order=created_at.asc`);
    const layers = Array.isArray(rows) ? rows : [];

    const members = await C.sbRest(cfg,
      `gemstar_track_members?track_id=eq.${trackId}&role=eq.collaborator&select=member_key`);
    const spotsLeft = Math.max(0, track.max_collaborators - (Array.isArray(members) ? members.length : 0));

    // Stable anonymous labels in order of first appearance. Layers already
    // arrive sorted oldest-first (see the query above), so when one guest
    // has recorded more than one layer, each of theirs gets a "(take N)"
    // suffix in that same order -- otherwise every layer from the same
    // guest showed the identical "Guest N" label, with no way to tell
    // which one they recorded first, second, third...
    const labels = {};
    let n = 0;
    layers.forEach((l) => { if (!labels[l.author_key]) labels[l.author_key] = `Guest ${++n}`; });

    const totalByAuthor = {};
    layers.forEach((l) => { totalByAuthor[l.author_key] = (totalByAuthor[l.author_key] || 0) + 1; });

    const seen = {};
    const layerLabels = layers.map((l) => {
      seen[l.author_key] = (seen[l.author_key] || 0) + 1;
      const base = labels[l.author_key];
      return totalByAuthor[l.author_key] > 1 ? `${base} (take ${seen[l.author_key]})` : base;
    });

    const [baseUrl, urls] = await Promise.all([
      track.base_audio_path ? C.signedDownloadUrl(cfg, track.base_audio_path, 3600) : null,
      Promise.all(layers.map((l) => C.signedDownloadUrl(cfg, l.audio_path, 3600))),
    ]);

    return res.status(200).json({
      track: { id: track.id, title: track.title, bpm: track.bpm },
      baseUrl,
      spotsLeft,
      layers: layers.map((l, i) => ({
        id: l.id, label: layerLabels[i], status: l.status,
        offsetMs: l.offset_ms, volume: Number(l.volume), createdAt: l.created_at, url: urls[i],
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load this track" });
  }
};
