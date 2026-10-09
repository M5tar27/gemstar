// Vercel serverless function: /api/create-track
// Creates a collaborative track owned by the caller and returns a short-lived
// signed URL the browser uploads the base audio to directly.
// Mix + Unlimited tiers only.
//
// POST { token, deviceId, title?, bpm?, ext? }
// -> { trackId, uploadUrl, audioPath }

const crypto = require("crypto");
const C = require("./_lib/common");

const ALLOWED_EXT = ["wav", "mp3", "m4a", "webm", "ogg"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });
  if (!C.canCollaborate(who.tier)) {
    return res.status(403).json({ error: "Collaboration is available on the Mix and Unlimited plans.", upgrade: true });
  }

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  const title = String(body.title || "Untitled track").trim().slice(0, 80) || "Untitled track";
  let bpm = parseFloat(body.bpm);
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) bpm = null;
  const ext = ALLOWED_EXT.indexOf(String(body.ext || "wav").toLowerCase()) === -1 ? "wav" : String(body.ext).toLowerCase();

  try {
    const trackId = crypto.randomUUID();
    const audioPath = `${trackId}/base.${ext}`;

    const uploadUrl = await C.signedUploadUrl(cfg, audioPath);
    if (!uploadUrl) return res.status(502).json({ error: "Could not prepare upload. Try again." });

    await C.sbRest(cfg, "gemstar_tracks", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({ id: trackId, owner_email: who.email, title, bpm, base_audio_path: audioPath }),
    });
    await C.sbRest(cfg, "gemstar_track_members", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({ track_id: trackId, member_key: who.email, role: "owner" }),
    });

    return res.status(200).json({ trackId, uploadUrl, audioPath });
  } catch (err) {
    return res.status(500).json({ error: "Could not create track" });
  }
};
