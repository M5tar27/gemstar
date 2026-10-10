// Vercel serverless function: /api/update-layer
// The track owner reviews a layer: accept, mute, restore to pending, remove,
// adjust volume / timing, or report it (which also removes it and files a
// report row for Gemstar to review). Removing deletes the stored audio.
// Mix + Unlimited tiers only, and only for the layer's track owner.
//
// POST { token, deviceId, layerId, status?, volume?, offsetMs?, report?, reason? }
// -> { ok: true, layer: { id, status, volume, offsetMs } }

const C = require("./_lib/common");

const STATUSES = ["pending", "accepted", "muted", "removed"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.requireCollab(body, res);
  if (!who) return;

  const layerId = String(body.layerId || "");
  if (!C.UUID_RE.test(layerId)) return res.status(400).json({ error: "Invalid layer" });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  const patch = {};
  if (body.status !== undefined) {
    if (STATUSES.indexOf(body.status) === -1) return res.status(400).json({ error: "Invalid status" });
    patch.status = body.status;
  }
  if (body.volume !== undefined) {
    const v = parseFloat(body.volume);
    if (!Number.isFinite(v)) return res.status(400).json({ error: "Invalid volume" });
    patch.volume = Math.min(Math.max(Math.round(v * 100) / 100, 0), 1.5);
  }
  if (body.offsetMs !== undefined) {
    const o = parseInt(body.offsetMs, 10);
    if (!Number.isFinite(o)) return res.status(400).json({ error: "Invalid offset" });
    patch.offset_ms = Math.min(Math.max(o, -2000), 2000);
  }
  const isReport = body.report === true;
  if (isReport) patch.status = "removed";
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to update" });

  try {
    const layers = await C.sbRest(cfg,
      `gemstar_track_layers?id=eq.${layerId}&select=id,track_id,audio_path`);
    const layer = Array.isArray(layers) && layers[0];
    if (!layer) return res.status(404).json({ error: "Layer not found" });

    // Ownership is checked against the track, never trusted from the client.
    const owned = await C.sbRest(cfg,
      `gemstar_tracks?id=eq.${layer.track_id}&owner_email=eq.${encodeURIComponent(who.email)}&select=id`);
    if (!Array.isArray(owned) || owned.length === 0) return res.status(404).json({ error: "Layer not found" });

    if (isReport) {
      await C.sbRest(cfg, "gemstar_layer_reports", {
        method: "POST",
        headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
        body: JSON.stringify({
          layer_id: layerId, reporter_key: who.email,
          reason: String(body.reason || "reported by owner").slice(0, 300),
        }),
      });
    }

    const updated = await C.sbRest(cfg, `gemstar_track_layers?id=eq.${layerId}`, {
      method: "PATCH",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    const row = Array.isArray(updated) && updated[0];
    if (!row) return res.status(404).json({ error: "Layer not found" });

    // Removed layers lose their audio file too (best-effort; a report keeps
    // its row so Gemstar still has the reason).
    if (row.status === "removed") await C.deleteObject(cfg, layer.audio_path);

    return res.status(200).json({
      ok: true,
      layer: { id: row.id, status: row.status, volume: Number(row.volume), offsetMs: row.offset_ms },
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not update this layer" });
  }
};
