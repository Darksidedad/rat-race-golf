create extension if not exists pgcrypto;

create table if not exists public.draft_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_id text,
  event_name text,
  player_input text not null default '',
  manual_leaderboard_input text not null default '',
  current_positions jsonb not null default '{}'::jsonb,
  status text not null default 'setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.draft_sessions(id) on delete cascade,
  name text not null,
  draft_slot integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.draft_sessions(id) on delete cascade,
  team_id uuid not null references public.draft_teams(id) on delete cascade,
  player_name text not null,
  player_key text not null,
  pick_number integer not null,
  round_number integer not null,
  created_at timestamptz not null default now(),
  constraint draft_picks_session_pick_unique unique (session_id, pick_number),
  constraint draft_picks_session_player_unique unique (session_id, player_key)
);

create index if not exists draft_teams_session_idx on public.draft_teams(session_id);
create index if not exists draft_picks_session_idx on public.draft_picks(session_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists draft_sessions_set_updated_at on public.draft_sessions;
create trigger draft_sessions_set_updated_at
before update on public.draft_sessions
for each row
execute function public.set_updated_at();

alter table public.draft_sessions enable row level security;
alter table public.draft_teams enable row level security;
alter table public.draft_picks enable row level security;

drop policy if exists "public draft_sessions access" on public.draft_sessions;
create policy "public draft_sessions access"
on public.draft_sessions
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public draft_teams access" on public.draft_teams;
create policy "public draft_teams access"
on public.draft_teams
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public draft_picks access" on public.draft_picks;
create policy "public draft_picks access"
on public.draft_picks
for all
to anon, authenticated
using (true)
with check (true);

alter publication supabase_realtime add table public.draft_sessions;
alter publication supabase_realtime add table public.draft_teams;
alter publication supabase_realtime add table public.draft_picks;

