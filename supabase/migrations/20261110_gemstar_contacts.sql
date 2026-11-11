-- Durable email list for every Gemstar tier (free demo, waitlist, Starter,
-- Mix, Unlimited), so announcements / email blasts don't depend on digging
-- through inbox notifications or the Stripe dashboard.
--
-- Access: service-role only (RLS on, no policies). The /api functions write
-- via gemstar_upsert_contact(); nothing here is readable from the browser.

create table if not exists public.gemstar_contacts (
  email        text primary key,                       -- always lowercased
  tier         text not null default 'free'
               check (tier in ('free','starter','mix','unlimited')),
  source       text not null,                          -- first place we saw them
  sources      text[] not null default '{}',           -- every place we've seen them
  marketing_ok boolean not null default false,         -- ok to include in email blasts
  unsubscribed boolean not null default false,         -- hard opt-out; never email
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.gemstar_contacts enable row level security;

create or replace function public.gemstar_upsert_contact(
  p_email text, p_tier text, p_source text, p_marketing_ok boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_tier  text := case when p_tier in ('free','starter','mix','unlimited') then p_tier else 'free' end;
begin
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return;
  end if;
  insert into public.gemstar_contacts as c (email, tier, source, sources, marketing_ok)
  values (v_email, v_tier, p_source, array[p_source], coalesce(p_marketing_ok, false))
  on conflict (email) do update set
    -- never downgrade a tier
    tier = case
      when (array_position(array['free','starter','mix','unlimited'], excluded.tier))
         > (array_position(array['free','starter','mix','unlimited'], c.tier))
      then excluded.tier else c.tier end,
    sources = (select array(select distinct unnest(c.sources || excluded.sources))),
    -- opt-in only ever turns on here; unsubscribed is never touched by this function
    marketing_ok = c.marketing_ok or excluded.marketing_ok,
    updated_at = now();
end;
$$;

revoke all on function public.gemstar_upsert_contact(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.gemstar_upsert_contact(text,text,text,boolean) to service_role;
