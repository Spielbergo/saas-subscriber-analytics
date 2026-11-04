-- Optional. Run once in the Supabase SQL editor to enable:
--   * invoice / client / time-entry / expense usage per user  (admin_get_usage)
--   * cohort retention from login history                     (admin_get_login_days)
-- Both are SECURITY DEFINER and locked to the service role — only the
-- dashboard's secret key can call them. The dashboard works without them
-- (usage and retention just show a "setup needed" note).

-- Per-user product usage, computed inside Postgres so the big companies.data
-- JSON (bank statement text etc.) never leaves the database.
create or replace function public.admin_get_usage()
returns table (
  user_id uuid,
  invoices bigint,
  invoices_sent bigint,
  invoices_paid bigint,
  invoiced_total numeric,
  first_invoice_at text,
  last_invoice_at text,
  clients bigint,
  time_entries bigint,
  expenses bigint,
  bank_statements bigint,
  recurring_invoices bigint,
  recurring_expenses bigint,
  proposals bigint
)
language sql
security definer
set search_path = public
as $$
  with c as (
    select user_id, data from public.companies where user_id is not null
  ),
  fy as (
    select c.user_id, f.value as year
    from c,
         jsonb_each(case when jsonb_typeof(c.data -> 'fiscalYears') = 'object'
                         then c.data -> 'fiscalYears' else '{}'::jsonb end) f
  ),
  inv as (
    select fy.user_id, i.value as inv
    from fy,
         jsonb_array_elements(case when jsonb_typeof(fy.year -> 'invoices') = 'array'
                                   then fy.year -> 'invoices' else '[]'::jsonb end) i
  ),
  inv_agg as (
    select user_id,
      count(*) as invoices,
      count(*) filter (where coalesce(inv ->> 'sentAt', '') <> '') as invoices_sent,
      count(*) filter (where inv ->> 'status' = 'paid') as invoices_paid,
      sum(case when (inv ->> 'total') ~ '^-?[0-9]+(\.[0-9]+)?$' then (inv ->> 'total')::numeric else 0 end) as invoiced_total,
      min(left(inv ->> 'createdAt', 10)) as first_invoice_at,
      max(left(inv ->> 'createdAt', 10)) as last_invoice_at
    from inv group by user_id
  ),
  fy_agg as (
    select user_id,
      sum(case when jsonb_typeof(year -> 'expenses') = 'array' then jsonb_array_length(year -> 'expenses') else 0 end) as expenses,
      sum(case when jsonb_typeof(year -> 'bankStatements') = 'array' then jsonb_array_length(year -> 'bankStatements') else 0 end) as bank_statements
    from fy group by user_id
  ),
  top_agg as (
    select user_id,
      sum(case when jsonb_typeof(data -> 'clients') = 'array' then jsonb_array_length(data -> 'clients') else 0 end) as clients,
      sum(case when jsonb_typeof(data -> 'timeEntries') = 'array' then jsonb_array_length(data -> 'timeEntries') else 0 end) as time_entries,
      sum(case when jsonb_typeof(data -> 'recurringInvoices') = 'array' then jsonb_array_length(data -> 'recurringInvoices') else 0 end) as recurring_invoices,
      sum(case when jsonb_typeof(data -> 'recurringExpenses') = 'array' then jsonb_array_length(data -> 'recurringExpenses') else 0 end) as recurring_expenses,
      sum(case when jsonb_typeof(data -> 'proposals') = 'array' then jsonb_array_length(data -> 'proposals') else 0 end) as proposals
    from c group by user_id
  )
  select t.user_id,
    coalesce(i.invoices, 0), coalesce(i.invoices_sent, 0), coalesce(i.invoices_paid, 0),
    coalesce(i.invoiced_total, 0), i.first_invoice_at, i.last_invoice_at,
    coalesce(t.clients, 0), coalesce(t.time_entries, 0),
    coalesce(f.expenses, 0), coalesce(f.bank_statements, 0),
    coalesce(t.recurring_invoices, 0), coalesce(t.recurring_expenses, 0), coalesce(t.proposals, 0)
  from top_agg t
  left join inv_agg i on i.user_id = t.user_id
  left join fy_agg f on f.user_id = t.user_id
$$;

revoke all on function public.admin_get_usage() from public, anon, authenticated;
grant execute on function public.admin_get_usage() to service_role;

-- Distinct days each user logged in (for cohort retention). Supabase keeps
-- auth.audit_log_entries for a limited time, so very old logins may be gone.
create or replace function public.admin_get_login_days()
returns table (user_id uuid, day date)
language sql
security definer
set search_path = auth, public
as $$
  select distinct (payload ->> 'actor_id')::uuid as user_id, created_at::date as day
  from auth.audit_log_entries
  where payload ->> 'action' = 'login'
    and payload ->> 'actor_id' is not null
    and created_at > now() - interval '400 days'
$$;

revoke all on function public.admin_get_login_days() from public, anon, authenticated;
grant execute on function public.admin_get_login_days() to service_role;
