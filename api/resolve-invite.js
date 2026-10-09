// Vercel serverless function: /api/resolve-invite
// Public (no login): validates an invite link and returns what the guest
// landing page needs: the track's title/BPM, a short-lived URL to stream the
// base audio, how many collaborator spots remain, and a 24h guest session
// token. Never exposes the owner's email.
//
// POST { invite }
// -> { title, bpm, audioUrl, spotsLeft, guestToken }  |  { error, reason }

const C = require("./_lib/common");

function fail(res, status, reason, error) {
  return res.status(status).json({ error, reason });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const inviteToken = String(body.invite || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(inviteToken)) {
    return fail(res, 404, "invalid", "This invite link isn't valid.");
  }

  const cfg = C.sbConfig();
  if (!cfg || !process.env.ACCESS_TOKEN_SECRET) return res.status(500).json({ error: "Server not configured" });

  try {
    const invites = await C.sbRest(cfg,
      `gemstar_track_invites?token=eq.${inviteToken}&select=track_id,max_uses,used_count,expires_at,revoked`);
    const inv = Array.isArray(invites) && invites[0];
    if (!inv || inv.revoked) return fail(res, 404, "invalid", "This invite link isn't valid.");
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      return fail(res, 410, "expired", "This invite link has expired. Ask your friend for a new one.");
    }
    if (inv.used_count >= inv.max_uses) {
      return fail(res, 410, "used_up", "This invite link has been used up. Ask your friend for a new one.");
    }

    const tracks = await C.sbRest(cfg,
      `gemstar_tracks?id=eq.${inv.track_id}&select=title,bpm,base_audio_path,max_collaborators`);
    const track = Array.isArray(tracks) && tracks[0];
    if (!track || !track.base_audio_path) return fail(res, 404, "invalid", "This track is no longer available.");

    const collabs = await C.sbRest(cfg,
      `gemstar_track_members?track_id=eq.${inv.track_id}&role=eq.collaborator&select=member_key`);
    const spotsLeft = Math.max(0, track.max_collaborators - (Array.isArray(collabs) ? collabs.length : 0));

    const audioUrl = await C.signedDownloadUrl(cfg, track.base_audio_path, 3600);
    const guest = C.signGuestToken();

    return res.status(200).json({
      title: track.title, bpm: track.bpm, audioUrl, spotsLeft, guestToken: guest.token,
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load this invite" });
  }
};
