-- Video performance feedback loop: published identity + metric snapshots.
alter table public.video_projects
  add column if not exists external_work_id text,
  add column if not exists external_url text,
  add column if not exists publish_meta jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz;
create index if not exists video_projects_external_work_idx on public.video_projects(external_work_id);

create table if not exists public.video_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.video_projects(id) on delete cascade,
  platform text not null default 'douyin',
  external_work_id text,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  favorites bigint not null default 0,
  reposts bigint not null default 0,
  follower_count bigint not null default 0,
  popularity_score numeric,
  recorded_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb
);
create index if not exists video_perf_project_time_idx on public.video_performance_snapshots(project_id,recorded_at desc);
create index if not exists video_perf_user_time_idx on public.video_performance_snapshots(user_id,recorded_at desc);
alter table public.video_performance_snapshots enable row level security;
create policy "video performance own" on public.video_performance_snapshots for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
