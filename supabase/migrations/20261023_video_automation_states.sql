-- Expand production states used by the automated video pipeline.
-- Keeps existing rows valid while allowing queued/directing/asset_ready/rendering/failed.
alter table public.video_projects drop constraint if exists video_projects_status_check;
alter table public.video_projects add constraint video_projects_status_check
  check (status in ('draft','queued','directing','scripted','asset_ready','ready','rendering','published','failed','archived'));

alter table public.video_scenes drop constraint if exists video_scenes_status_check;
alter table public.video_scenes add constraint video_scenes_status_check
  check (status in ('todo','scripted','asset_ready','vo_ready','approved','failed'));

create index if not exists video_projects_queue_idx
  on public.video_projects(status,updated_at asc)
  where status in ('queued','directing','scripted','asset_ready','rendering');
