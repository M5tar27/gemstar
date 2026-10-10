// Vercel serverless function: /api/submit-layer
// A guest (holding a guest token from /api/resolve-invite) adds a layer to a
// track. Validates the invite, enforces the collaborator cap and a per-person
// layer limit, records the layer as 'pending' for the owner to accept, and
// returns a short-lived signed URL the browser uploads the recording to.
//
// POST { invite, guestToken, ext?, offsetMs? }
// -> { layerId, uploadUrl }

const crypto = require("crypto");
const C = require("./_lib/common");

const ALLOWED_EXT = ["webm", "m4a", "mp4", "ogg", "wav"];
const MAX_LAYERS_PER_PERSON = 3;

function fail(res, status, reason, error) {
  return res.status(status).json({ error, reason });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const guest = C.verifyGuestToken(body.guestToken);
  if (!guest) return fail(res, 401, "session", "Your session expired. Reload the invite link and try again.");

  const inviteToken = String(body.invite || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(inviteToken)) return fail(res, 404, "invalid", "This invite link isn't valid.");

  const cfg = C.sbConfig();
  if (!cfg) return res.status(500).json({ error: "Server not configured" });

  let ext = String(body.ext || "webm").toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) === -1) ext = "webm";
  let offsetMs = parseInt(body.offsetMs, 10);
  if (!Number.isFinite(offsetMs)) offsetMs = 0;
  offsetMs = Math.min(Math.max(offsetMs, -2000), 2000);

  const memberKey = `guest:${guest.guestId}`;

  try {
    const invites = await C.sbRest(cfg,
      `gemstar_track_invites?token=eq.${inviteToken}&select=track_id,max_uses,used_count,expires_at,revoked`);
    const inv = Array.isArray(invites) && invites[0];
    if (!inv || inv.revoked) return fail(res, 404, "invalid", "This invite link isn't valid.");
    if (new Date(inv.expires_at).getTime() <= Date.now()) {
      return fail(res, 410, "expired", "This invite link has expired. Ask your friend for a new one.");
    }
    const trackId = inv.track_id;

    const tracks = await C.sbRest(cfg, `gemstar_tracks?id=eq.${trackId}&select=max_collaborators,owner_email,title`);
    const track = Array.isArray(tracks) && tracks[0];
    if (!track) return fail(res, 404, "invalid", "This track is no longer available.");

    const collabs = await C.sbRest(cfg,
      `gemstar_track_members?track_id=eq.${trackId}&role=eq.collaborator&select=member_key`);
    const keys = (Array.isArray(collabs) ? collabs : []).map((m) => m.member_key);
    const isMember = keys.indexOf(memberKey) !== -1;

    if (!isMember) {
      if (keys.length >= track.max_collaborators) {
        return fail(res, 409, "full", "This track already has all its collaborators.");
      }
      if (inv.used_count >= inv.max_uses) {
        return fail(res, 410, "used_up", "This invite link has been used up. Ask your friend for a new one.");
      }
      // Compare-and-set so two guests can't both claim the last use: the
      // PATCH only matches if used_count is still what we just read.
      const bumped = await C.sbRest(cfg,
        `gemstar_track_invites?token=eq.${inviteToken}&used_count=eq.${inv.used_count}`, {
          method: "PATCH",
          headers: Object.assign({}, cfg.headers, { Prefer: "return=representation" }),
          body: JSON.stringify({ used_count: inv.used_count + 1 }),
        });
      if (!Array.isArray(bumped) || bumped.length === 0) {
        return fail(res, 409, "busy", "Someone else just joined. Please try again.");
      }
      await C.sbRest(cfg, "gemstar_track_members", {
        method: "POST",
        headers: Object.assign({}, cfg.headers, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({ track_id: trackId, member_key: memberKey, role: "collaborator" }),
      });
    } else {
      const mine = await C.sbRest(cfg,
        `gemstar_track_layers?track_id=eq.${trackId}&author_key=eq.${encodeURIComponent(memberKey)}&status=neq.removed&select=id`);
      if (Array.isArray(mine) && mine.length >= MAX_LAYERS_PER_PERSON) {
        return fail(res, 429, "limit", `You can add up to ${MAX_LAYERS_PER_PERSON} layers to a track.`);
      }
    }

    const layerId = crypto.randomUUID();
    const audioPath = `${trackId}/layers/${layerId}.${ext}`;
    const uploadUrl = await C.signedUploadUrl(cfg, audioPath);
    if (!uploadUrl) return res.status(502).json({ error: "Could not prepare upload. Try again." });

    await C.sbRest(cfg, "gemstar_track_layers", {
      method: "POST",
      headers: Object.assign({}, cfg.headers, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        id: layerId, track_id: trackId, author_key: memberKey,
        audio_path: audioPath, offset_ms: offsetMs, status: "pending",
      }),
    });

    // Let the owner know (best-effort: a failed email never fails the save).
    if (track.owner_email) {
      const title = C.escapeHtml(track.title || "your track");
      await C.sendEmail(
        track.owner_email,
        "A friend added a layer to your Gemstar track",
        `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;">` +
        `<img src="https://gemstaraudio.com/email-logo.png" width="140" alt="Gemstar" style="display:block;margin:0 auto 20px;">` +
        `<h2 style="margin:0 0 12px;">New layer on "${title}"</h2>` +
        `<p style="color:#555;font-size:14px;">Someone you invited just recorded a layer. Listen, then accept or mute it.</p>` +
        `<p style="margin:24px 0;"><a href="${C.siteUrl()}/track.html?id=${trackId}" ` +
        `style="background:#FF2E88;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Review the layer</a></p>` +
        `</div>`
      );
    }

    return res.status(200).json({ layerId, uploadUrl });
  } catch (err) {
    return res.status(500).json({ error: "Could not save your layer" });
  }
};
