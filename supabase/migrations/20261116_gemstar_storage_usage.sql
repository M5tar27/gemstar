-- Total bytes stored across all Storage buckets, for the daily storage-warning
-- email (/api/log-error?job=storage-check). Service-role only: the browser
-- can never call it.

create or replace function public.gemstar_storage_usage()
returns bigint
language sql
security definer
set search_path = public, storage
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects;
$$;

revoke all on function public.gemstar_storage_usage() from public, anon, authenticated;
grant execute on function public.gemstar_storage_usage() to service_role;
