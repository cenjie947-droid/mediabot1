alter table public.video_projects
  add column if not exists publish_provider text;

alter table public.video_projects
  add column if not exists publish_queued_at timestamptz;

alter table public.video_projects
  add column if not exists publish_attempts integer not null default 0;

create index if not exists video_projects_publish_queue_idx
  on public.video_projects(status,publish_provider,publish_queued_at);
