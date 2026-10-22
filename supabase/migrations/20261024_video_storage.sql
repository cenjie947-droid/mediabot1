-- Rendered MP4s are generated server-side and uploaded with the service role.
-- The bucket is public so the Creator Studio can open a durable video URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-renders', 'video-renders', true, 52428800, array['video/mp4'])
on conflict (id) do update set public=true, file_size_limit=52428800, allowed_mime_types=array['video/mp4'];
