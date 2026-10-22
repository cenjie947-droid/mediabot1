alter table public.video_projects
  add column if not exists retry_count integer not null default 0;

create index if not exists video_projects_retry_idx
  on public.video_projects(status,retry_count,updated_at);

alter table public.video_renders
  add column if not exists retry_count integer not null default 0;

create index if not exists video_renders_retry_idx
  on public.video_renders(status,retry_count,created_at);
