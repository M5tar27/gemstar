import { API_BASE } from './config';
import { normalizeTier, Tier } from './tiers';

async function post(path: string, body: object): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = {};
  try {
    json = await resp.json();
  } catch {
    // non-JSON error page
  }
  if (!resp.ok && !json.error) json.error = `Server error (${resp.status})`;
  return json;
}

export type CheckAccessResult =
  | { kind: 'granted'; token: string; tier: Tier }   // founder allowlist: no code needed
  | { kind: 'code_sent'; challenge: string }         // subscriber: email a 6-digit code
  | { kind: 'no_subscription' }
  | { kind: 'error'; message: string };

export async function checkAccess(email: string): Promise<CheckAccessResult> {
  try {
    const r = await post('/api/check-access', { email: email.trim().toLowerCase() });
    if (r.access && r.token) return { kind: 'granted', token: r.token, tier: normalizeTier(r.tier) };
    if (r.ok && r.challenge) return { kind: 'code_sent', challenge: r.challenge };
    if (r.error) return { kind: 'error', message: r.error };
    return { kind: 'no_subscription' };
  } catch {
    return { kind: 'error', message: 'Could not reach Gemstar. Check your connection.' };
  }
}

export type VerifyCodeResult =
  | { ok: true; token: string; tier: Tier }
  | { ok: false; message: string };

export async function verifyCode(challenge: string, code: string, deviceId: string): Promise<VerifyCodeResult> {
  try {
    const r = await post('/api/verify-code', { challenge, code: code.trim(), deviceId });
    if (r.access && r.token) return { ok: true, token: r.token, tier: normalizeTier(r.tier) };
    return { ok: false, message: r.error || 'That code did not work.' };
  } catch {
    return { ok: false, message: 'Could not reach Gemstar. Check your connection.' };
  }
}

export type VerifyTokenResult =
  | { status: 'valid'; tier: Tier }
  | { status: 'invalid' }
  | { status: 'offline' };

/** Checks a stored token against the server for this device. */
export async function verifyToken(token: string, deviceId: string): Promise<VerifyTokenResult> {
  try {
    const r = await post('/api/verify-token', { token, deviceId });
    return r.valid ? { status: 'valid', tier: normalizeTier(r.tier) } : { status: 'invalid' };
  } catch {
    return { status: 'offline' };
  }
}

/**
 * Reads tier and expiry out of a token without the secret (the signature is
 * only checked server-side). Used so a stored, unexpired token still works
 * with no connection: the audio processing itself is entirely on-device.
 */
export function readTokenLocally(token: string): { tier: Tier; expiresAt: number } | null {
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const expiry = parseInt(parts[3], 10);
  if (!Number.isFinite(expiry)) return null;
  return { tier: normalizeTier(parts[1]), expiresAt: expiry * 1000 };
}
