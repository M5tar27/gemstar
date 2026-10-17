// Vercel serverless function: /api/layer
// Combines the two Collab layer endpoints behind one `action`, so adding
// /api/stripe-webhook for the pricing rework doesn't push this project past
// Vercel's 12-serverless-function cap on the Hobby plan.
//
// action "submit": a guest (holding a guest token from /api/invite's
//   "resolve" action) adds a layer to a track. Validates the invite,
//   enforces the collaborator cap and a per-person layer limit, records the
//   layer as 'pending' for the owner to accept, and returns a short-lived
//   signed URL the browser uploads the recording to.
//   POST { action:"submit", invite, guestToken, ext?, offsetMs?, label? }
//   -> { layerId, uploadUrl }
//
// action "update": the track owner reviews a layer: accept, mute, restore
//   to pending, remove, adjust volume/timing, or report it (which also
//   removes it and files a report row for Gemstar to review). Removing
//   deletes the stored audio. Mix + Unlimited tiers only, and only for the
//   layer's track owner.
//   POST { action:"update", token, deviceId, layerId, status?, volume?,
//          offsetMs?, label?, trimStartMs?, trimEndMs?, report?, reason? }
//   -> { ok: true, layer: { id, status, volume, offsetMs, label, trimStartMs, trimEndMs } }

const crypto = require("crypto");
const C = require("./_lib/common");

const ALLOWED_EXT = ["webm", "m4a", "mp4", "ogg", "wav"];
const MAX_LAYERS_PER_PERSON = 3;
const STATUSES = ["pending", "accepted", "muted", "removed"];

function fail(res, status, reason, error) {
  return res.status(status).json({ error, reason });
}

async function handleSubmit(body, res) {
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

  // Free-text label ( "lead", "ad lib"... ) the guest can give their own
  // take right when they record it, so it isn't just an anonymous "Guest
  // N" in the owner's review list. Optional -- /api/get-track falls back
  // to the anonymous label when this is blank.
  const label = String(body.label || "").trim().slice(0, 40) || null;

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
        audio_path: audioPath, offset_ms: offsetMs, status: "pending", label: label,
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
}

async function handleUpdate(body, res) {
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
  // Free-text label: the owner can set or clear it here at any time (a
  // guest sets the initial one in the "submit" action, when they record).
  if (body.label !== undefined) {
    const raw = body.label === null ? "" : String(body.label);
    patch.label = raw.trim().slice(0, 40) || null;
  }
  // Start/end trim ("cuts"): both in ms from the start of the recording.
  // trimEndMs may be explicitly cleared back to null ("play to the end").
  if (body.trimStartMs !== undefined) {
    const ts = parseInt(body.trimStartMs, 10);
    if (!Number.isFinite(ts) || ts < 0) return res.status(400).json({ error: "Invalid trim start" });
    patch.trim_start_ms = ts;
  }
  if (body.trimEndMs !== undefined) {
    if (body.trimEndMs === null) {
      patch.trim_end_ms = null;
    } else {
      const te = parseInt(body.trimEndMs, 10);
      if (!Number.isFinite(te) || te < 0) return res.status(400).json({ error: "Invalid trim end" });
      patch.trim_end_ms = te;
    }
  }
  if (patch.trim_start_ms !== undefined && patch.trim_end_ms !== undefined &&
      patch.trim_end_ms !== null && patch.trim_end_ms <= patch.trim_start_ms) {
    return res.status(400).json({ error: "Trim end must be after trim start" });
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
      layer: {
        id: row.id, status: row.status, volume: Number(row.volume), offsetMs: row.offset_ms,
        label: row.label, trimStartMs: row.trim_start_ms, trimEndMs: row.trim_end_ms,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not update this layer" });
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = C.parseBody(req);
  const action = String(body.action || "");

  if (action === "submit") return handleSubmit(body, res);
  if (action === "update") return handleUpdate(body, res);
  return res.status(400).json({ error: "Unknown action" });
};
