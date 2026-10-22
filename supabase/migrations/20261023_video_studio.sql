-- Native short-video production layer: director plans, scenes, assets and render jobs.
create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.trend_events(id) on delete set null,
  title text not null,
  platform text not null default 'douyin',
  status text not null default 'draft' check (status in ('draft','scripted','ready','rendering','published','archived')),
  hook text,
  duration integer,
  cta text,
  verdict text,
  structure text,
  script jsonb not null default '{}'::jsonb,
  director_notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_projects_user_idx on public.video_projects(user_id,updated_at desc);
create index if not exists video_projects_event_idx on public.video_projects(event_id);
alter table public.video_projects enable row level security;
create policy "video projects own" on public.video_projects for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.video_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  scene_no integer not null,
  duration integer not null default 4,
  visual text,
  voiceover text,
  onscreen_text text,
  asset_hint text,
  asset_url text,
  status text not null default 'todo' check (status in ('todo','asset_ready','vo_ready','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,scene_no)
);
create index if not exists video_scenes_project_idx on public.video_scenes(project_id,scene_no);
alter table public.video_scenes enable row level security;
create policy "video scenes own" on public.video_scenes for all to authenticated using (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
) with check (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
);

create table if not exists public.video_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  scene_id uuid references public.video_scenes(id) on delete set null,
  provider text not null default 'manual',
  kind text not null default 'image',
  source_url text,
  title text,
  license_note text,
  status text not null default 'candidate' check (status in ('candidate','selected','downloaded','rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists video_assets_project_idx on public.video_assets(project_id,created_at desc);
alter table public.video_assets enable row level security;
create policy "video assets own" on public.video_assets for all to authenticated using (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
) with check (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
);

create table if not exists public.video_renders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  provider text not null default 'pending',
  status text not null default 'queued' check (status in ('queued','rendering','completed','failed')),
  output_url text,
  error text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists video_renders_project_idx on public.video_renders(project_id,created_at desc);
alter table public.video_renders enable row level security;
create policy "video renders own" on public.video_renders for all to authenticated using (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
) with check (
  exists(select 1 from public.video_projects p where p.id=project_id and p.user_id=auth.uid())
);
