-- Core MediaBot v7 schema required by the web app and background worker.
-- Safe to re-run; user-facing tables use RLS, service-only secrets live in private schema.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('douyin','xiaohongshu')),
  account_name text not null default '',
  display_name text,
  external_account_id text,
  status text not null default 'pending' check (status in ('pending','connected','expired','error','disconnected')),
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_accounts_user_idx on public.social_accounts(user_id, created_at desc);
alter table public.social_accounts enable row level security;
drop policy if exists "Users read own social accounts" on public.social_accounts;
create policy "Users read own social accounts" on public.social_accounts for select to authenticated using (auth.uid()=user_id);
drop policy if exists "Users update own social accounts" on public.social_accounts;
create policy "Users update own social accounts" on public.social_accounts for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  platform text not null default 'all',
  status text not null default 'draft',
  ai_score numeric,
  scheduled_at timestamptz,
  published_at timestamptz,
  media_urls jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_items_user_created_idx on public.content_items(user_id, created_at desc);
alter table public.content_items enable row level security;
drop policy if exists "Users manage own content" on public.content_items;
create policy "Users manage own content" on public.content_items for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.hot_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source text,
  url text,
  heat_score numeric,
  ai_score numeric,
  recommendation text,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists hot_topics_user_discovered_idx on public.hot_topics(user_id, discovered_at desc);
alter table public.hot_topics enable row level security;
drop policy if exists "Users manage own hot topics" on public.hot_topics;
create policy "Users manage own hot topics" on public.hot_topics for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform text not null,
  status text not null default 'queued' check (status in ('queued','publishing','published','failed','cancelled','needs_review')),
  scheduled_at timestamptz,
  started_at timestamptz,
  published_at timestamptz,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_due_idx on public.publish_jobs(status, scheduled_at);
create index if not exists publish_jobs_user_idx on public.publish_jobs(user_id, created_at desc);
alter table public.publish_jobs enable row level security;
drop policy if exists "Users manage own publish jobs" on public.publish_jobs;
create policy "Users manage own publish jobs" on public.publish_jobs for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  task_type text not null,
  cron_expression text not null default '*/15 * * * *',
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  run_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_tasks_due_idx on public.scheduled_tasks(enabled, next_run_at);
alter table public.scheduled_tasks enable row level security;
drop policy if exists "Users manage own scheduled tasks" on public.scheduled_tasks;
create policy "Users manage own scheduled tasks" on public.scheduled_tasks for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  task_type text not null default 'system',
  level text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists run_logs_user_created_idx on public.run_logs(user_id, created_at desc);
alter table public.run_logs enable row level security;
drop policy if exists "Users read own run logs" on public.run_logs;
create policy "Users read own run logs" on public.run_logs for select to authenticated using (auth.uid()=user_id);

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  content_id uuid references public.content_items(id) on delete set null,
  prompt text,
  model text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ai_generations enable row level security;
drop policy if exists "Users read own AI generations" on public.ai_generations;
create policy "Users read own AI generations" on public.ai_generations for select to authenticated using (exists(select 1 from public.content_items c where c.id=ai_generations.content_id and c.user_id=auth.uid()));

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.social_account_secrets (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists private.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
revoke all on all tables in schema private from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;
grant all on public.oauth_states to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('publish-media','publish-media',false,1073741824,array['video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/wav','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false;
