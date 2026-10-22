-- Multi-platform trend intelligence layer.
-- This migration is additive: it does not drop or delete existing live data.
create table if not exists public.trend_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source text not null default 'redfox',
  platform text not null,
  kind text not null default 'hot',
  title text not null,
  url text,
  rank integer,
  heat_score numeric default 0,
  likes bigint default 0,
  comments bigint default 0,
  shares bigint default 0,
  favorites bigint default 0,
  author_name text,
  category text,
  published_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists trend_items_lookup_idx on public.trend_items(platform,kind,fetched_at desc);
create index if not exists trend_items_title_idx on public.trend_items using gin (to_tsvector('simple',title));
alter table public.trend_items enable row level security;
create policy "trend items readable" on public.trend_items for select to authenticated using (user_id is null or auth.uid()=user_id);
create policy "trend items own insert" on public.trend_items for insert to authenticated with check (user_id is null or auth.uid()=user_id);
create policy "trend items own update" on public.trend_items for update to authenticated using (user_id is null or auth.uid()=user_id) with check (user_id is null or auth.uid()=user_id);
create policy "trend items own delete" on public.trend_items for delete to authenticated using (user_id is null or auth.uid()=user_id);

create table if not exists public.trend_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  canonical_key text not null,
  title text not null,
  score numeric not null default 0,
  platforms text[] not null default array[]::text[],
  source_count integer not null default 1,
  representative_url text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, canonical_key)
);
create index if not exists trend_events_score_idx on public.trend_events(user_id,score desc,last_seen_at desc);
alter table public.trend_events enable row level security;
create policy "trend events own" on public.trend_events for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.content_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.trend_events(id) on delete set null,
  platform text not null,
  format text not null,
  score numeric not null default 0,
  reason text,
  status text not null default 'new' check (status in ('new','writing','used','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists content_opportunities_user_idx on public.content_opportunities(user_id,score desc,created_at desc);
alter table public.content_opportunities enable row level security;
create policy "opportunities own" on public.content_opportunities for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- Keep trend data separate from the old generic material table. A trend is an opportunity source, not a media file.
