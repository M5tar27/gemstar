-- One row per (email, billing source) saying "this email has this plan until
-- this date". This is what lets a subscription bought OUTSIDE Stripe (the
-- Apple App Store / Google Play apps) unlock the website, and lets the apps
-- see the same plan a person bought on the website, because
-- /api/check-access takes the highest tier across Stripe AND this table.
--
-- Stripe stays the source of truth for website subscriptions (it is read live,
-- so nothing is copied here for them). The app builds write 'apple' / 'google'
-- rows from their verified store receipts / server notifications. 'manual'
-- is for comps and support fixes.
--
-- Access: service-role only (RLS on, no policies) -- never readable or
-- writable from the browser.

create table if not exists public.gemstar_entitlements (
  email       text        not null,                    -- always lowercased
  source      text        not null check (source in ('apple','google','manual')),
  tier        text        not null check (tier in ('starter','mix','unlimited')),
  external_id text,                                    -- store transaction / purchase id
  expires_at  timestamptz not null,                    -- access ends here (renewals push it out)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (email, source)
);

create index if not exists gemstar_entitlements_email_idx
  on public.gemstar_entitlements (email, expires_at);

alter table public.gemstar_entitlements enable row level security;
