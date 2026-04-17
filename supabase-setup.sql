create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  team_name text unique,
  role text not null default 'member' check (role in ('commissioner', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists public.draft_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_id text,
  event_name text,
  player_input text not null default '',
  manual_leaderboard_input text not null default '',
  current_positions jsonb not null default '{}'::jsonb,
  current_totals jsonb not null default '{}'::jsonb,
  status text not null default 'setup',
  commissioner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.draft_sessions(id) on delete cascade,
  name text not null,
  draft_slot integer,
  active boolean not null default true,
  owner_user_id uuid references public.profiles(id) on delete set null,
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

alter table public.draft_sessions add column if not exists commissioner_id uuid references public.profiles(id) on delete set null;
alter table public.draft_sessions add column if not exists current_totals jsonb not null default '{}'::jsonb;
alter table public.draft_teams add column if not exists owner_user_id uuid references public.profiles(id) on delete set null;

update public.draft_teams
set owner_user_id = profiles.id
from public.profiles
where public.draft_teams.owner_user_id is null
  and lower(regexp_replace(public.draft_teams.name, '[^a-z0-9]+', '', 'gi')) = lower(regexp_replace(public.profiles.team_name, '[^a-z0-9]+', '', 'gi'));

update public.draft_sessions
set commissioner_id = profiles.id
from public.profiles
where public.draft_sessions.commissioner_id is null
  and public.profiles.role = 'commissioner';

create index if not exists profiles_team_name_idx on public.profiles(team_name);
create index if not exists draft_sessions_commissioner_idx on public.draft_sessions(commissioner_id);
create index if not exists draft_teams_session_idx on public.draft_teams(session_id);
create index if not exists draft_teams_owner_idx on public.draft_teams(owner_user_id);
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

create or replace function public.sync_session_status_from_picks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
  assigned_count integer;
  pick_count integer;
begin
  target_session_id := coalesce(new.session_id, old.session_id);

  select count(*)
  into assigned_count
  from public.draft_teams
  where session_id = target_session_id
    and draft_slot is not null;

  select count(*)
  into pick_count
  from public.draft_picks
  where session_id = target_session_id;

  update public.draft_sessions
  set status = case
    when assigned_count = 0 then 'setup'
    when pick_count = 0 then 'setup'
    when pick_count >= assigned_count * 4 then 'draft_complete'
    else 'drafting'
  end
  where id = target_session_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_session_leaderboard(
  target_session_id uuid,
  leaderboard jsonb,
  totals jsonb default '{}'::jsonb,
  next_status text default 'scored'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.draft_sessions
  set current_positions = coalesce(leaderboard, '{}'::jsonb),
      current_totals = coalesce(totals, '{}'::jsonb),
      status = coalesce(nullif(next_status, ''), status)
  where id = target_session_id;
end;
$$;

create or replace function public.assign_first_commissioner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where role = 'commissioner'
      and id <> new.id
  ) then
    new.role = 'commissioner';
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, team_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'team_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'member'
  );
$$;

create or replace function public.is_commissioner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'commissioner';
$$;

drop trigger if exists draft_sessions_set_updated_at on public.draft_sessions;
create trigger draft_sessions_set_updated_at
before update on public.draft_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists draft_picks_sync_session_status on public.draft_picks;
create trigger draft_picks_sync_session_status
after insert or update or delete on public.draft_picks
for each row
execute function public.sync_session_status_from_picks();

drop trigger if exists profiles_assign_first_commissioner on public.profiles;
create trigger profiles_assign_first_commissioner
before insert on public.profiles
for each row
execute function public.assign_first_commissioner();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.draft_sessions enable row level security;
alter table public.draft_teams enable row level security;
alter table public.draft_picks enable row level security;

drop policy if exists "public draft_sessions access" on public.draft_sessions;
drop policy if exists "public draft_teams access" on public.draft_teams;
drop policy if exists "public draft_picks access" on public.draft_picks;

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles update own or commissioner" on public.profiles;
create policy "profiles update own or commissioner"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_commissioner())
with check (id = auth.uid() or public.is_commissioner());

drop policy if exists "draft sessions select authenticated" on public.draft_sessions;
create policy "draft sessions select authenticated"
on public.draft_sessions
for select
to authenticated
using (true);

drop policy if exists "draft sessions commissioner write" on public.draft_sessions;
create policy "draft sessions commissioner write"
on public.draft_sessions
for all
to authenticated
using (public.is_commissioner())
with check (public.is_commissioner());

drop policy if exists "draft teams select authenticated" on public.draft_teams;
create policy "draft teams select authenticated"
on public.draft_teams
for select
to authenticated
using (true);

drop policy if exists "draft teams commissioner write" on public.draft_teams;
create policy "draft teams commissioner write"
on public.draft_teams
for all
to authenticated
using (public.is_commissioner())
with check (public.is_commissioner());

drop policy if exists "draft picks select authenticated" on public.draft_picks;
create policy "draft picks select authenticated"
on public.draft_picks
for select
to authenticated
using (true);

drop policy if exists "draft picks insert owner or commissioner" on public.draft_picks;
create policy "draft picks insert owner or commissioner"
on public.draft_picks
for insert
to authenticated
with check (
  public.is_commissioner()
  or exists (
    select 1
    from public.draft_teams
    where draft_teams.id = draft_picks.team_id
      and draft_teams.owner_user_id = auth.uid()
  )
);

drop policy if exists "draft picks commissioner update" on public.draft_picks;
create policy "draft picks commissioner update"
on public.draft_picks
for update
to authenticated
using (public.is_commissioner())
with check (public.is_commissioner());

drop policy if exists "draft picks commissioner delete" on public.draft_picks;
create policy "draft picks commissioner delete"
on public.draft_picks
for delete
to authenticated
using (public.is_commissioner());

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.draft_sessions;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.draft_teams;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.draft_picks;
exception
  when duplicate_object then null;
end $$;
