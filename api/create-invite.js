// Vercel serverless function: /api/create-invite
// Mints a shareable invite link for a track the caller owns.
// Mix + Unlimited tiers only. Refuses if the track is already full.
//
// POST { token, deviceId, trackId, maxUses?, days? }
// -> { link, expiresAt, spotsLeft }

const C = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const who = C.verifyAccessToken(body.token, body.deviceId);
  if (!who) return res.status(401).json({ error: "Please verify your Gemstar account first." });
  if (!C.canCollaborate(who.tier)) {
    return res.status(403).json({ error: "Inviting friends is available on the Mix and Unlimited plans.", upgrade: true });
  }

  const trackId = String(body.trackId || "");
  if (!C.UUID_RE.test(trackId)) return res.status(400).json({ error: "Invalid track" });

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  let maxUses = parseInt(body.maxUses, 10);
  if (!Number.isFinite(maxUses)) maxUses = 10;
  maxUses = Math.min(Math.max(maxUses, 1), 100);
  let days = parseInt(body.days, 10);
  if (!Number.isFinite(days)) days = 7;
  days = Math.min(Math.max(days, 1), 30);

  try {
    const tracks = await C.sbRest(cfg,
      `gemstar_tracks?id=eq.${trackId}&owner_email=eq.${encodeURIComponent(who.email)}&select=id,max_collaborators`);
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(404).json({ error: "Track not found" });
    }
    const track = tracks[0];

    const collabs = await C.sbRest(cfg,
      `gemstar_track_members?track_id=eq.${trackId}&role=eq.collaborator&select=member_key`);
    const spotsLeft = track.max_collaborators - (Array.isArray(collabs) ? collabs.length : 0);
    if (spotsLeft <= 0) {
      return res.status(409).json({ error: `This track already has ${track.max_collaborators} collaborators.` });
    }

    const inviteToken = C.newInviteToken();
    const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
    await C.sbRest(cfg, "gemstar_track_invites", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        token: inviteToken, track_id: trackId, created_by: who.email,
        max_uses: maxUses, expires_at: expiresAt,
      }),
    });

    const site = (process.env.SITE_URL || "https://gemstaraudio.com").replace(/\/+$/, "");
    return res.status(200).json({ link: `${site}/join.html?t=${inviteToken}`, expiresAt, spotsLeft });
  } catch (err) {
    return res.status(500).json({ error: "Could not create invite" });
  }
};
