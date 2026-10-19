-- MediaBot Viral Market Radar (manual-first MVP)
-- Run this migration in the Supabase SQL editor before using the Radar screen.

create table if not exists public.radar_video_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_key text not null,
  video_url text not null,
  title text not null,
  creator_name text,
  category text not null,
  platform text not null default 'douyin',
  published_at timestamptz,
  snapshot_at timestamptz not null default now(),
  views bigint not null default 0 check (views >= 0),
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares bigint not null default 0 check (shares >= 0),
  favorites bigint not null default 0 check (favorites >= 0),
  avg_watch_seconds numeric,
  completion_rate numeric,
  retention_3s numeric,
  retention_5s numeric,
  retention_10s numeric,
  source_type text not null default 'manual' check (source_type in ('manual','licensed_api','official_api','public_web')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists radar_video_snapshots_user_time_idx
  on public.radar_video_snapshots(user_id, snapshot_at desc);
create index if not exists radar_video_snapshots_user_key_time_idx
  on public.radar_video_snapshots(user_id, video_key, snapshot_at desc);
create index if not exists radar_video_snapshots_user_category_idx
  on public.radar_video_snapshots(user_id, category, published_at desc);

alter table public.radar_video_snapshots enable row level security;

drop policy if exists "Users read own radar snapshots" on public.radar_video_snapshots;
create policy "Users read own radar snapshots" on public.radar_video_snapshots
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users insert own radar snapshots" on public.radar_video_snapshots;
create policy "Users insert own radar snapshots" on public.radar_video_snapshots
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users delete own radar snapshots" on public.radar_video_snapshots;
create policy "Users delete own radar snapshots" on public.radar_video_snapshots
  for delete to authenticated using (auth.uid() = user_id);

comment on table public.radar_video_snapshots is
  'User-entered or permitted-source snapshots of public videos. Not a census of all Douyin content; never treat missing retention metrics as zero.';
