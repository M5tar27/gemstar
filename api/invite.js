// Vercel serverless function: /api/invite
// Consolidates the Collab invite-link endpoints into one serverless
// function (create/resolve), dispatched by body.action. These used to be
// two separate files (create-invite.js, resolve-invite.js) but the Vercel
// Hobby plan caps a deployment at 12 serverless functions, so they are
// merged here to stay under that limit alongside the new cloud-projects
// endpoints. Behavior is unchanged from the original files -- only the
// entrypoint and routing are different.
//
// POST { action: "create", token, deviceId, trackId, maxUses?, days? }
//   Mints a shareable invite link for a track the caller owns.
//   Mix + Unlimited tiers only. Refuses if the track is already full.
//   -> { link, expiresAt, spotsLeft }
//
// POST { action: "resolve", invite }  (public, no login)
//   Validates an invite link and returns what the guest landing page needs.
//   Never exposes the owner email.
//   -> { title, bpm, audioUrl, spotsLeft, guestToken }  |  { error, reason }

const C = require("./_lib/common");

function fail(res, status, reason, error) {
  return res.status(status).json({ error, reason });
}

async function handleCreate(body, res) {
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
}

async function handleResolve(body, res) {
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
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const action = String(body.action || (body.invite ? "resolve" : ""));

  if (action === "resolve") return handleResolve(body, res);
  if (action === "create") return handleCreate(body, res);
  return res.status(400).json({ error: "Unknown action" });
};
