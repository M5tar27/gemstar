export type Tier = 'starter' | 'mix' | 'unlimited';

export const TIER_RANK: Record<Tier, number> = { starter: 1, mix: 2, unlimited: 3 };
// Max vocal tracks per plan, same as PLAN_LIMITS in the web app.
export const PLAN_LIMITS: Record<Tier, number> = { starter: 1, mix: 3, unlimited: 8 };

export function isTierAtLeast(current: Tier, needed: Tier): boolean {
  return (TIER_RANK[current] ?? 1) >= (TIER_RANK[needed] ?? 1);
}

export function normalizeTier(t: unknown): Tier {
  return t === 'mix' || t === 'unlimited' || t === 'starter' ? t : 'starter';
}
