-- Multi-platform trend intelligence layer. Provider data is normalized into trend items and canonical events.
create table if not exists public.trend_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  platform text not null,
  name text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready','error','disabled')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists trend_sources_user_idx on public.trend_sources(user_id,created_at desc);
alter table public.trend_sources enable row level security;
create policy "trend sources own" on public.trend_sources for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.trend_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.trend_sources(id) on delete set null,
  platform text not null,
  kind text not null default 'hot',
  external_id text,
  title text not null,
  url text,
  rank integer,
  hot_score numeric,
  growth_score numeric,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists trend_items_user_time_idx on public.trend_items(user_id,observed_at desc);
create index if not exists trend_items_platform_idx on public.trend_items(user_id,platform,kind,observed_at desc);
alter table public.trend_items enable row level security;
create policy "trend items own" on public.trend_items for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.trend_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_key text not null,
  title text not null,
  summary text,
  hot_score numeric not null default 0,
  cross_platform_score numeric not null default 0,
  growth_score numeric not null default 0,
  content_score numeric not null default 0,
  platforms text[] not null default array[]::text[],
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id,canonical_key)
);
create index if not exists trend_events_user_score_idx on public.trend_events(user_id,hot_score desc,last_seen_at desc);
alter table public.trend_events enable row level security;
create policy "trend events own" on public.trend_events for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.trend_event_items (
  event_id uuid not null references public.trend_events(id) on delete cascade,
  trend_item_id uuid not null references public.trend_items(id) on delete cascade,
  primary key(event_id,trend_item_id)
);
alter table public.trend_event_items enable row level security;
create policy "trend event items own" on public.trend_event_items for all to authenticated using (
  exists(select 1 from public.trend_events e where e.id=event_id and e.user_id=auth.uid())
) with check (
  exists(select 1 from public.trend_events e where e.id=event_id and e.user_id=auth.uid())
);

create table if not exists public.content_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.trend_events(id) on delete cascade,
  platform text not null,
  format text not null,
  score numeric not null default 0,
  rationale text,
  status text not null default 'new' check (status in ('new','drafted','published','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists content_opportunities_user_idx on public.content_opportunities(user_id,score desc,created_at desc);
alter table public.content_opportunities enable row level security;
create policy "content opportunities own" on public.content_opportunities for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
