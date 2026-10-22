-- Align the live video schema with the automation code.
-- Safe to rerun: columns and indexes are additive; checks are replaced with the
-- complete state set required by the current worker and editor.
alter table public.video_projects drop constraint if exists video_projects_status_check;
alter table public.video_projects add constraint video_projects_status_check
  check (status in ('draft','queued','directing','scripted','asset_ready','ready','rendering','published','failed','archived'));

alter table public.video_scenes drop constraint if exists video_scenes_status_check;
alter table public.video_scenes add constraint video_scenes_status_check
  check (status in ('todo','scripted','asset_ready','vo_ready','approved','failed'));

alter table public.video_projects add column if not exists retry_count integer not null default 0;
alter table public.video_projects add column if not exists publish_provider text;
alter table public.video_projects add column if not exists publish_queued_at timestamptz;
alter table public.video_projects add column if not exists publish_attempts integer not null default 0;
alter table public.video_renders add column if not exists retry_count integer not null default 0;

create index if not exists video_projects_queue_idx
  on public.video_projects(status,updated_at asc)
  where status in ('queued','directing','scripted','asset_ready','rendering');
create index if not exists video_projects_retry_idx
  on public.video_projects(status,retry_count,updated_at);
create index if not exists video_renders_retry_idx
  on public.video_renders(status,retry_count,created_at);
create index if not exists video_projects_publish_queue_idx
  on public.video_projects(status,publish_provider,publish_queued_at);
