-- Admin-dashboard tables. Run once in Supabase's SQL editor.
-- Everything is optional: the dashboard falls back to a local file cache
-- (.seo-cache/) for anything it can't store here, so nothing breaks if you
-- skip this — but snapshots/notes won't survive a Vercel deploy without it.
--
-- RLS is enabled with NO policies on purpose: only the secret key (used by
-- this dashboard's server) can read or write these. Your main app's users
-- can't see them.

-- Daily metric snapshots → trend lines, MRR movement, churn, LTV.
create table if not exists public.admin_snapshots (
  day date primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Notes you pin to chart dates ("posted on Reddit", "launched Pro Plus").
create table if not exists public.admin_annotations (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  label text not null,
  created_at timestamptz not null default now()
);

-- CRM: one row per user you've tagged / staged / scheduled a follow-up for.
create table if not exists public.admin_crm_contacts (
  user_id uuid primary key,
  stage text,
  tags text[] not null default '{}',
  follow_up_on date,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_crm_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_crm_notes_user_idx on public.admin_crm_notes (user_id, created_at desc);

-- Marketing post log (pairs with the UTM builder).
create table if not exists public.admin_posts (
  id uuid primary key default gen_random_uuid(),
  posted_on date not null,
  platform text,
  title text,
  url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  notes text,
  created_at timestamptz not null default now()
);

-- Uptime / SSL checks recorded by /api/cron/monitor.
create table if not exists public.admin_monitor_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  target text not null,
  ok boolean not null,
  status int,
  latency_ms int,
  detail text
);
create index if not exists admin_monitor_checks_idx on public.admin_monitor_checks (target, checked_at desc);

-- Small key/value store (alert de-duplication, crawl history, etc.).
create table if not exists public.admin_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_snapshots enable row level security;
alter table public.admin_annotations enable row level security;
alter table public.admin_crm_contacts enable row level security;
alter table public.admin_crm_notes enable row level security;
alter table public.admin_posts enable row level security;
alter table public.admin_monitor_checks enable row level security;
alter table public.admin_kv enable row level security;
