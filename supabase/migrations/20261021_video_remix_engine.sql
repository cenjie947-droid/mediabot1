-- MediaBot user-owned video assets and remix jobs
create table if not exists public.video_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  duration_seconds numeric,
  status text not null default 'ready' check (status in ('uploading','ready','processing','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, storage_path)
);
create index if not exists video_assets_user_created_idx on public.video_assets(user_id, created_at desc);
alter table public.video_assets enable row level security;
drop policy if exists "Users manage own video assets" on public.video_assets;
create policy "Users manage own video assets" on public.video_assets for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.video_remix_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_url text,
  reference_notes text,
  input_asset_ids uuid[] not null default '{}',
  music_storage_path text,
  status text not null default 'queued' check (status in ('queued','analyzing','rendering','completed','failed')),
  output_storage_path text,
  edit_plan jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists video_remix_jobs_user_created_idx on public.video_remix_jobs(user_id, created_at desc);
alter table public.video_remix_jobs enable row level security;
drop policy if exists "Users read own remix jobs" on public.video_remix_jobs;
create policy "Users read own remix jobs" on public.video_remix_jobs for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users create own remix jobs" on public.video_remix_jobs;
create policy "Users create own remix jobs" on public.video_remix_jobs for insert to authenticated with check (auth.uid() = user_id);
