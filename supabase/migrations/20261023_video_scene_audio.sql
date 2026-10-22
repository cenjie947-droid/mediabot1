-- Persist generated TTS audio URLs for automated and manual video production.
alter table public.video_scenes add column if not exists tts_audio_url text;
create index if not exists video_scenes_tts_idx
  on public.video_scenes(project_id, status)
  where tts_audio_url is not null;
