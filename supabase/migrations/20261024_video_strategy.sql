-- Strategy layer: turn performance snapshots into reusable creator rules.
create table if not exists public.video_strategy_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'douyin',
  scope text not null default 'account',
  rule_type text not null,
  title text not null,
  insight text not null,
  recommendation text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_strategy_user_idx on public.video_strategy_rules(user_id,platform,active,updated_at desc);
alter table public.video_strategy_rules enable row level security;
create policy "video strategy own" on public.video_strategy_rules for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
