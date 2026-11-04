-- Optional. Run this once in Supabase's SQL editor to enable the
-- "Logins" count column in the dashboard. Without it, the dashboard
-- still works fine — it just shows "—" for that column and keeps
-- showing "Last login" (which comes from Supabase Auth directly and
-- needs no setup).
--
-- This reads auth.audit_log_entries, which isn't exposed over the API
-- by default. The function below is SECURITY DEFINER so it can read
-- that table, lives in the public schema so PostgREST can call it as
-- an RPC, and is locked down to service_role only — the dashboard's
-- secret key is the only thing that can call it. Nothing public-facing
-- (anon/publishable key, or your main app's own users) gets access.

create or replace function public.admin_get_login_counts()
returns table (user_id uuid, login_count bigint, last_login timestamptz)
language sql
security definer
set search_path = auth, public
as $$
  select
    (payload ->> 'actor_id')::uuid as user_id,
    count(*) as login_count,
    max(created_at) as last_login
  from auth.audit_log_entries
  where payload ->> 'action' = 'login'
  group by (payload ->> 'actor_id')::uuid
$$;

-- Lock it down: only the service role (your dashboard's secret key)
-- may call this. Revoke first in case PostgREST granted a default.
revoke all on function public.admin_get_login_counts() from public, anon, authenticated;
grant execute on function public.admin_get_login_counts() to service_role;
