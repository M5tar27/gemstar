-- Gemstar: "Invite a friend to a track" (collaborative layers) — Phase 1
--
-- NOT applied to production yet. Review, then apply to a Supabase branch first.
--
-- Auth model: Gemstar does not use Supabase Auth. Owners are identified by the
-- email inside Gemstar's signed access token; guests by a server-signed guest
-- id. All reads/writes go through /api/* serverless functions using the
-- service-role key. So RLS is ENABLED with NO policies on every table: the
-- anon/authenticated keys can read and write nothing, and only the server can.

create table if not exists public.gemstar_tracks (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text not null,
  title           text not null default 'Untitled track',
  bpm             numeric(6,2),
  base_audio_path text,                       -- path inside the gemstar-tracks bucket
  max_collaborators int not null default 4 check (max_collaborators between 1 and 8),
  created_at      timestamptz not null default now()
);
create index if not exists gemstar_tracks_owner_idx on public.gemstar_tracks (owner_email);

create table if not exists public.gemstar_track_members (
  track_id    uuid not null references public.gemstar_tracks(id) on delete cascade,
  member_key  text not null,                  -- lowercased email, or 'guest:<id>'
  role        text not null default 'collaborator' check (role in ('owner','collaborator')),
  joined_at   timestamptz not null default now(),
  primary key (track_id, member_key)
);

create table if not exists public.gemstar_track_invites (
  token       text primary key,               -- random, unguessable
  track_id    uuid not null references public.gemstar_tracks(id) on delete cascade,
  created_by  text not null,
  max_uses    int not null default 10 check (max_uses between 1 and 100),
  used_count  int not null default 0,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists gemstar_track_invites_track_idx on public.gemstar_track_invites (track_id);

create table if not exists public.gemstar_track_layers (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references public.gemstar_tracks(id) on delete cascade,
  author_key  text not null,                  -- lowercased email, or 'guest:<id>'
  audio_path  text not null,
  offset_ms   int not null default 0 check (offset_ms between -2000 and 2000),
  volume      numeric(3,2) not null default 1.00 check (volume between 0 and 1.5),
  status      text not null default 'pending' check (status in ('pending','accepted','muted','removed')),
  created_at  timestamptz not null default now()
);
create index if not exists gemstar_track_layers_track_idx on public.gemstar_track_layers (track_id);

create table if not exists public.gemstar_layer_reports (
  id          uuid primary key default gen_random_uuid(),
  layer_id    uuid not null references public.gemstar_track_layers(id) on delete cascade,
  reporter_key text,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- Lock everything to the service role (no policies = deny for anon/authenticated).
alter table public.gemstar_tracks         enable row level security;
alter table public.gemstar_track_members  enable row level security;
alter table public.gemstar_track_invites  enable row level security;
alter table public.gemstar_track_layers   enable row level security;
alter table public.gemstar_layer_reports  enable row level security;

-- Private audio bucket. Files are only ever served through short-lived signed
-- URLs minted by the API; 25 MB cap per file, audio types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gemstar-tracks', 'gemstar-tracks', false, 26214400,
        array['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg'])
on conflict (id) do nothing;
