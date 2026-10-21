-- Creator OS: WeChat Official Account + Toutiao content workspace
create table if not exists public.creator_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('wechat','toutiao')),
  name text not null,
  status text not null default 'pending' check (status in ('pending','connected','error')),
  publish_enabled boolean not null default true,
  secret_payload text,
  last_published_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists creator_accounts_user_idx on public.creator_accounts(user_id,created_at desc);
alter table public.creator_accounts enable row level security;
create policy "creator accounts own" on public.creator_accounts for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.content_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  summary text,
  body_html text not null,
  cover_url text,
  platforms text[] not null default array[]::text[],
  status text not null default 'draft' check (status in ('draft','review','scheduled','published','failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_refs jsonb not null default '[]'::jsonb,
  ai_score numeric,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_posts_user_idx on public.content_posts(user_id,created_at desc);
create index if not exists content_posts_schedule_idx on public.content_posts(status,scheduled_at);
alter table public.content_posts enable row level security;
create policy "content posts own" on public.content_posts for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.publish_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.content_posts(id) on delete cascade,
  account_id uuid references public.creator_accounts(id) on delete set null,
  platform text not null,
  status text not null default 'queued' check (status in ('queued','running','success','failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  external_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists publish_tasks_queue_idx on public.publish_tasks(status,run_at);
alter table public.publish_tasks enable row level security;
create policy "publish tasks own" on public.publish_tasks for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.content_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  platform text not null default 'general',
  description text,
  prompt text,
  created_at timestamptz not null default now()
);
alter table public.content_templates enable row level security;
create policy "templates readable" on public.content_templates for select to authenticated using (user_id is null or auth.uid()=user_id);
create policy "templates own insert" on public.content_templates for insert to authenticated with check (auth.uid()=user_id);
create policy "templates own update" on public.content_templates for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "templates own delete" on public.content_templates for delete to authenticated using (auth.uid()=user_id);

create table if not exists public.creator_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'image',
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.creator_materials enable row level security;
create policy "materials own" on public.creator_materials for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create table if not exists public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.content_posts(id) on delete cascade,
  platform text not null,
  title text,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  favorites bigint not null default 0,
  followers bigint not null default 0,
  recorded_at timestamptz not null default now()
);
create index if not exists performance_user_time_idx on public.performance_snapshots(user_id,recorded_at desc);
alter table public.performance_snapshots enable row level security;
create policy "performance own" on public.performance_snapshots for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

insert into public.content_templates(user_id,name,platform,description,prompt)
select null,'公众号深度文章','wechat','观点 + 案例 + 方法，适合长文阅读。','先用一个真实场景开头，再拆解问题、给出 3 个方法，最后总结行动建议。'
where not exists(select 1 from public.content_templates where user_id is null and name='公众号深度文章');
insert into public.content_templates(user_id,name,platform,description,prompt)
select null,'头条高点击图文','toutiao','标题更直接，段落更短，强调信息密度。','先给结论，再用 3-5 个小标题快速解释，标题突出结果、冲突或数字。'
where not exists(select 1 from public.content_templates where user_id is null and name='头条高点击图文');
insert into public.content_templates(user_id,name,platform,description,prompt)
select null,'双平台通用主稿','general','一份主稿，交给 AI 自动适配不同平台。','保持核心事实和观点一致，分别优化公众号的深度阅读感与头条的信息密度。'
where not exists(select 1 from public.content_templates where user_id is null and name='双平台通用主稿');
