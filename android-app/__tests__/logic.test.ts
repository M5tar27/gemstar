import { checkAccess, readTokenLocally, verifyCode, verifyToken } from '../src/api';
import { DEFAULT_VALUES, KNOB_DEFS, PRESETS } from '../src/knobs';
import { isTierAtLeast, normalizeTier } from '../src/tiers';

const fetchMock = jest.fn();
(globalThis as any).fetch = fetchMock;
const reply = (body: object, ok = true) =>
  fetchMock.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: async () => body });

beforeEach(() => fetchMock.mockReset());

describe('knobs', () => {
  it('has the same 14 knobs in defs, defaults and every preset', () => {
    const ids = KNOB_DEFS.map(d => d.id).sort();
    expect(ids).toHaveLength(14);
    expect(Object.keys(DEFAULT_VALUES).sort()).toEqual(ids);
    for (const [name, p] of Object.entries(PRESETS)) {
      expect({ name, keys: Object.keys(p).sort() }).toEqual({ name, keys: ids });
      for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(p)) expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('tiers', () => {
  it('ranks and normalizes', () => {
    expect(isTierAtLeast('unlimited', 'mix')).toBe(true);
    expect(isTierAtLeast('starter', 'mix')).toBe(false);
    expect(normalizeTier('bogus')).toBe('starter');
  });
});

describe('api', () => {
  it('founder allowlist returns a token straight away', async () => {
    reply({ access: true, token: 't', tier: 'unlimited' });
    expect(await checkAccess(' Me@X.com ')).toEqual({ kind: 'granted', token: 't', tier: 'unlimited' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'me@x.com' });
  });
  it('subscriber gets a code challenge', async () => {
    reply({ access: false, ok: true, challenge: 'c' });
    expect(await checkAccess('a@b.com')).toEqual({ kind: 'code_sent', challenge: 'c' });
  });
  it('no subscription', async () => {
    reply({ access: false });
    expect(await checkAccess('a@b.com')).toEqual({ kind: 'no_subscription' });
  });
  it('network failure is an error, not a crash', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect((await checkAccess('a@b.com')).kind).toBe('error');
  });
  it('verifyCode sends deviceId and maps tier', async () => {
    reply({ access: true, token: 'tok', tier: 'mix' });
    expect(await verifyCode('ch', ' 123456 ', 'dev1')).toEqual({ ok: true, token: 'tok', tier: 'mix' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ challenge: 'ch', code: '123456', deviceId: 'dev1' });
  });
  it('verifyCode surfaces the server message (e.g. device cap)', async () => {
    reply({ access: false, error: 'already active on 3 devices' });
    expect(await verifyCode('ch', '1', 'd')).toEqual({ ok: false, message: 'already active on 3 devices' });
  });
  it('verifyToken distinguishes valid / invalid / offline', async () => {
    reply({ valid: true, tier: 'starter' });
    expect(await verifyToken('t', 'd')).toEqual({ status: 'valid', tier: 'starter' });
    reply({ valid: false });
    expect(await verifyToken('t', 'd')).toEqual({ status: 'invalid' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await verifyToken('t', 'd')).toEqual({ status: 'offline' });
  });
  it('reads tier and expiry from a token locally', () => {
    expect(readTokenLocally('e.mix.d.1999999999.sig')).toEqual({ tier: 'mix', expiresAt: 1999999999000 });
    expect(readTokenLocally('old.style.token.4')).toBeNull();
  });
});
