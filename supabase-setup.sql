create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  team_name text,
  role text not null default 'member' check (role in ('commissioner', 'assistant_commissioner', 'member')),
  site_role text not null default 'user' check (site_role in ('site_admin', 'user')),
  active_league_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.league_memberships (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('commissioner', 'assistant_commissioner', 'member')),
  claimed_team_name text,
  created_at timestamptz not null default now(),
  constraint league_memberships_unique unique (league_id, user_id)
);
create table if not exists public.draft_sessions (
  id uuid primary key default gen_random_uuid(),
  event_tour text not null default 'pga',
  name text not null,
  event_id text,
  event_name text,
  player_input text not null default '',
  field_source text,
  field_refreshed_at timestamptz,
  odds_snapshot jsonb not null default '{}'::jsonb,
  odds_source text,
  odds_refreshed_at timestamptz,
  field_locked_at timestamptz,
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

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('commissioner', 'assistant_commissioner', 'member'));
alter table public.profiles drop constraint if exists profiles_team_name_key;
alter table public.profiles drop constraint if exists profiles_site_role_check;
alter table public.profiles add column if not exists site_role text not null default 'user';
alter table public.profiles add constraint profiles_site_role_check check (site_role in ('site_admin', 'user'));
alter table public.profiles add column if not exists active_league_id uuid;
alter table public.league_memberships add column if not exists claimed_team_name text;
alter table public.draft_sessions add column if not exists commissioner_id uuid references public.profiles(id) on delete set null;
alter table public.draft_sessions add column if not exists current_totals jsonb not null default '{}'::jsonb;
alter table public.draft_sessions add column if not exists league_id uuid references public.leagues(id) on delete cascade;
alter table public.draft_sessions add column if not exists event_tour text not null default 'pga';
alter table public.draft_sessions add column if not exists field_source text;
alter table public.draft_sessions add column if not exists field_refreshed_at timestamptz;
alter table public.draft_sessions add column if not exists odds_snapshot jsonb not null default '{}'::jsonb;
alter table public.draft_sessions add column if not exists odds_source text;
alter table public.draft_sessions add column if not exists odds_refreshed_at timestamptz;
alter table public.draft_sessions add column if not exists field_locked_at timestamptz;
alter table public.profiles drop constraint if exists profiles_active_league_fkey;
alter table public.profiles add constraint profiles_active_league_fkey foreign key (active_league_id) references public.leagues(id) on delete set null;
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

insert into public.leagues (name, slug, created_by)
values (
  'Rat Race Golf',
  'rat-race-golf',
  (
    select id
    from public.profiles
    where role = 'commissioner'
    order by created_at
    limit 1
  )
)
on conflict (slug) do update
  set name = excluded.name;

update public.draft_sessions
set league_id = (select id from public.leagues where slug = 'rat-race-golf')
where league_id is null;

insert into public.league_memberships (league_id, user_id, role, claimed_team_name)
select (select id from public.leagues where slug = 'rat-race-golf'), id, role, team_name
from public.profiles
where exists (select 1 from public.leagues where slug = 'rat-race-golf')
on conflict (league_id, user_id) do update
  set role = excluded.role,
      claimed_team_name = excluded.claimed_team_name;

update public.profiles
set active_league_id = (select id from public.leagues where slug = 'rat-race-golf')
where active_league_id is null
  and exists (select 1 from public.leagues where slug = 'rat-race-golf');
create index if not exists draft_sessions_commissioner_idx on public.draft_sessions(commissioner_id);
create index if not exists profiles_active_league_idx on public.profiles(active_league_id);
create index if not exists draft_sessions_league_idx on public.draft_sessions(league_id);
create index if not exists league_memberships_league_idx on public.league_memberships(league_id);
create index if not exists league_memberships_user_idx on public.league_memberships(user_id);
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

  if not exists (
    select 1
    from public.draft_sessions
    where id = target_session_id
      and public.is_league_admin(league_id)
  ) then
    raise exception 'Only a league admin can refresh scores';
  end if;

  update public.draft_sessions
  set current_positions = coalesce(leaderboard, '{}'::jsonb),
      current_totals = coalesce(totals, '{}'::jsonb),
      status = coalesce(nullif(next_status, ''), status)
  where id = target_session_id;
end;
$$;

create or replace function public.remove_member_account(target_league_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_league_commissioner(target_league_id) then
    raise exception 'Only the commissioner can remove members';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'The commissioner cannot remove their own account here';
  end if;

  select role
  into target_role
  from public.league_memberships
  where league_id = target_league_id
    and user_id = target_user_id;

  if target_role is null then
    raise exception 'That member is not in this league';
  end if;

  if target_role = 'commissioner' then
    raise exception 'Commissioner accounts cannot be removed here';
  end if;

  update public.draft_teams
  set owner_user_id = null
  where owner_user_id = target_user_id
    and exists (
      select 1
      from public.draft_sessions
      where draft_sessions.id = draft_teams.session_id
        and draft_sessions.league_id = target_league_id
    );

  delete from public.league_memberships
  where league_id = target_league_id
    and user_id = target_user_id;
end;
$$;

create or replace function public.set_member_role(target_league_id uuid, target_user_id uuid, next_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_role text;
  current_target_role text;
begin
  if not public.is_league_commissioner(target_league_id) then
    raise exception 'Only the commissioner can change member permissions';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'The commissioner cannot change their own role here';
  end if;

  normalized_role := lower(trim(coalesce(next_role, '')));
  if normalized_role not in ('assistant_commissioner', 'member') then
    raise exception 'Invalid role';
  end if;

  select role
  into current_target_role
  from public.league_memberships
  where league_id = target_league_id
    and user_id = target_user_id;

  if current_target_role is null then
    raise exception 'That member is not in this league';
  end if;

  if current_target_role = 'commissioner' then
    raise exception 'Commissioner accounts cannot be changed here';
  end if;

  update public.league_memberships
  set role = normalized_role
  where league_id = target_league_id
    and user_id = target_user_id;
end;
$$;

create or replace function public.create_league_for_site_admin(
  target_name text,
  target_slug text default null,
  commissioner_claimed_team_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_league_id uuid;
  normalized_name text;
  base_slug text;
  normalized_slug text;
  suffix integer := 1;
begin
  if not public.is_site_admin() then
    raise exception 'Only a site admin can create leagues';
  end if;

  normalized_name := nullif(trim(coalesce(target_name, '')), '');
  base_slug := lower(regexp_replace(trim(coalesce(nullif(target_slug, ''), normalized_name, '')), '[^a-z0-9]+', '-', 'g'));
  base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');

  if normalized_name is null then
    raise exception 'League name is required';
  end if;

  if base_slug = '' then
    base_slug := 'league';
  end if;

  base_slug := left(base_slug, 56);
  normalized_slug := base_slug;

  while exists (select 1 from public.leagues where slug = normalized_slug) loop
    suffix := suffix + 1;
    normalized_slug := left(base_slug, 56 - length('-' || suffix::text)) || '-' || suffix::text;
  end loop;

  insert into public.leagues (name, slug, created_by)
  values (normalized_name, normalized_slug, auth.uid())
  returning id into created_league_id;

  insert into public.league_memberships (league_id, user_id, role, claimed_team_name)
  values (created_league_id, auth.uid(), 'commissioner', nullif(trim(coalesce(commissioner_claimed_team_name, '')), ''))
  on conflict (league_id, user_id) do update
    set role = 'commissioner',
        claimed_team_name = excluded.claimed_team_name;

  update public.profiles
  set active_league_id = created_league_id
  where id = auth.uid();

  return created_league_id;
end;
$$;

create or replace function public.ensure_default_league_membership(claimed_team_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  default_league_id uuid;
  assigned_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id
  into default_league_id
  from public.leagues
  where slug = 'rat-race-golf'
  limit 1;

  if default_league_id is null then
    insert into public.leagues (name, slug, created_by)
    values ('Rat Race Golf', 'rat-race-golf', auth.uid())
    on conflict (slug) do update
      set name = excluded.name
    returning id into default_league_id;
  end if;

  assigned_role := coalesce((select role from public.profiles where id = auth.uid()), 'member');

  insert into public.league_memberships (league_id, user_id, role, claimed_team_name)
  values (
    default_league_id,
    auth.uid(),
    assigned_role,
    nullif(trim(coalesce(claimed_team_name, (select team_name from public.profiles where id = auth.uid()), '')), '')
  )
  on conflict (league_id, user_id) do update
    set claimed_team_name = coalesce(public.league_memberships.claimed_team_name, excluded.claimed_team_name);

  update public.profiles
  set active_league_id = default_league_id
  where id = auth.uid()
    and active_league_id is null;

  return default_league_id;
end;
$$;

grant execute on function public.ensure_default_league_membership(text) to authenticated;

create or replace function public.claim_draft_team_for_member(target_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_name text;
  claimed_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select league_memberships.claimed_team_name
  into claimed_name
  from public.draft_sessions
  join public.league_memberships on league_memberships.league_id = draft_sessions.league_id
  where draft_sessions.id = target_session_id
    and league_memberships.user_id = auth.uid()
  limit 1;

  if nullif(trim(coalesce(claimed_name, '')), '') is null then
    return 0;
  end if;

  update public.draft_teams
  set owner_user_id = auth.uid()
  where session_id = target_session_id
    and active = true
    and owner_user_id is null
    and lower(regexp_replace(name, '[^a-z0-9]+', '', 'gi')) = lower(regexp_replace(claimed_name, '[^a-z0-9]+', '', 'gi'));

  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$;

grant execute on function public.claim_draft_team_for_member(uuid) to authenticated;

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
declare
  default_league_id uuid;
  assigned_role text;
begin
  insert into public.profiles (id, username, team_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'team_name', '')
  )
  on conflict (id) do nothing;

  select id
  into default_league_id
  from public.leagues
  where slug = 'rat-race-golf'
  order by created_at
  limit 1;

  assigned_role := coalesce((select role from public.profiles where id = new.id), 'member');

  if default_league_id is not null then
    insert into public.league_memberships (league_id, user_id, role, claimed_team_name)
    values (default_league_id, new.id, assigned_role, nullif(new.raw_user_meta_data->>'team_name', ''))
    on conflict (league_id, user_id) do nothing;

    update public.profiles
    set active_league_id = default_league_id
    where id = new.id
      and active_league_id is null;
  end if;

  return new;
end;
$$;

create or replace function public.current_user_site_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select site_role from public.profiles where id = auth.uid()), 'user');
$$;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_site_role() = 'site_admin';
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select league_memberships.role
      from public.league_memberships
      join public.profiles on profiles.active_league_id = league_memberships.league_id
      where league_memberships.user_id = auth.uid()
        and profiles.id = auth.uid()
      limit 1
    ),
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

drop function if exists public.is_league_commissioner() cascade;
drop function if exists public.is_league_commissioner(uuid) cascade;

create or replace function public.is_league_commissioner(target_league_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_site_admin()
    or exists (
      select 1
      from public.league_memberships
      where league_id = coalesce(target_league_id, (select active_league_id from public.profiles where id = auth.uid()))
        and user_id = auth.uid()
        and role = 'commissioner'
    )
    or (
      target_league_id is null
      and public.current_user_role() = 'commissioner'
    );
$$;

drop function if exists public.is_league_admin() cascade;
drop function if exists public.is_league_admin(uuid) cascade;

create or replace function public.is_league_admin(target_league_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_site_admin()
    or exists (
      select 1
      from public.league_memberships
      where league_id = coalesce(target_league_id, (select active_league_id from public.profiles where id = auth.uid()))
        and user_id = auth.uid()
        and role in ('commissioner', 'assistant_commissioner')
    )
    or (
      target_league_id is null
      and public.current_user_role() in ('commissioner', 'assistant_commissioner')
    );
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
alter table public.leagues enable row level security;
alter table public.league_memberships enable row level security;
alter table public.draft_sessions enable row level security;
alter table public.draft_teams enable row level security;
alter table public.draft_picks enable row level security;

grant select on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
revoke delete on public.profiles from authenticated;
grant insert (id, username, team_name) on public.profiles to authenticated;
grant update (username, team_name, active_league_id) on public.profiles to authenticated;

grant select, insert, update, delete on public.leagues to authenticated;

grant select, delete on public.league_memberships to authenticated;
revoke insert on public.league_memberships from authenticated;
revoke update on public.league_memberships from authenticated;
grant insert (league_id, user_id, claimed_team_name) on public.league_memberships to authenticated;
grant update (claimed_team_name) on public.league_memberships to authenticated;

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
using (id = auth.uid() or public.is_league_admin())
with check (id = auth.uid() or public.is_league_admin());

drop policy if exists "leagues select member or site admin" on public.leagues;
create policy "leagues select member or site admin"
on public.leagues
for select
to authenticated
using (
  public.is_site_admin()
  or exists (
    select 1
    from public.league_memberships
    where league_memberships.league_id = leagues.id
      and league_memberships.user_id = auth.uid()
  )
);

drop policy if exists "leagues site admin write" on public.leagues;
create policy "leagues site admin write"
on public.leagues
for all
to authenticated
using (public.is_site_admin())
with check (public.is_site_admin());

drop policy if exists "league memberships select own league" on public.league_memberships;
create policy "league memberships select own league"
on public.league_memberships
for select
to authenticated
using (
  public.is_site_admin()
  or user_id = auth.uid()
  or public.is_league_admin(league_id)
);

drop policy if exists "league memberships admin write" on public.league_memberships;
drop policy if exists "league memberships admin insert" on public.league_memberships;
create policy "league memberships admin insert"
on public.league_memberships
for insert
to authenticated
with check (public.is_league_commissioner(league_id));

drop policy if exists "league memberships own claim or admin update" on public.league_memberships;
create policy "league memberships own claim or admin update"
on public.league_memberships
for update
to authenticated
using (user_id = auth.uid() or public.is_league_admin(league_id))
with check (user_id = auth.uid() or public.is_league_admin(league_id));

drop policy if exists "league memberships admin delete" on public.league_memberships;
create policy "league memberships admin delete"
on public.league_memberships
for delete
to authenticated
using (public.is_league_commissioner(league_id));

drop policy if exists "draft sessions select authenticated" on public.draft_sessions;
create policy "draft sessions select authenticated"
on public.draft_sessions
for select
to authenticated
using (
  public.is_site_admin()
  or exists (
    select 1
    from public.league_memberships
    where league_memberships.league_id = draft_sessions.league_id
      and league_memberships.user_id = auth.uid()
  )
);

drop policy if exists "draft sessions commissioner write" on public.draft_sessions;
create policy "draft sessions commissioner write"
on public.draft_sessions
for all
to authenticated
using (public.is_league_admin(league_id))
with check (public.is_league_admin(league_id));

drop policy if exists "draft teams select authenticated" on public.draft_teams;
create policy "draft teams select authenticated"
on public.draft_teams
for select
to authenticated
using (
  public.is_site_admin()
  or exists (
    select 1
    from public.draft_sessions
    join public.league_memberships on league_memberships.league_id = draft_sessions.league_id
    where draft_sessions.id = draft_teams.session_id
      and league_memberships.user_id = auth.uid()
  )
);

drop policy if exists "draft teams commissioner write" on public.draft_teams;
create policy "draft teams commissioner write"
on public.draft_teams
for all
to authenticated
using (
  public.is_site_admin()
  or exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_teams.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
)
with check (
  public.is_site_admin()
  or exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_teams.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
);

drop policy if exists "draft picks select authenticated" on public.draft_picks;
create policy "draft picks select authenticated"
on public.draft_picks
for select
to authenticated
using (
  public.is_site_admin()
  or exists (
    select 1
    from public.draft_sessions
    join public.league_memberships on league_memberships.league_id = draft_sessions.league_id
    where draft_sessions.id = draft_picks.session_id
      and league_memberships.user_id = auth.uid()
  )
);

drop policy if exists "draft picks insert owner or commissioner" on public.draft_picks;
create policy "draft picks insert owner or commissioner"
on public.draft_picks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_picks.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
  or exists (
    select 1
    from public.draft_teams
    join public.draft_sessions on draft_sessions.id = draft_teams.session_id
    where draft_teams.id = draft_picks.team_id
      and draft_sessions.id = draft_picks.session_id
      and draft_teams.owner_user_id = auth.uid()
  )
);

drop policy if exists "draft picks commissioner update" on public.draft_picks;
create policy "draft picks commissioner update"
on public.draft_picks
for update
to authenticated
using (
  exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_picks.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
)
with check (
  exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_picks.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
);

drop policy if exists "draft picks commissioner delete" on public.draft_picks;
create policy "draft picks commissioner delete"
on public.draft_picks
for delete
to authenticated
using (
  exists (
    select 1
    from public.draft_sessions
    where draft_sessions.id = draft_picks.session_id
      and public.is_league_admin(draft_sessions.league_id)
  )
);

do $realtime_profiles$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end;
$realtime_profiles$;

do $realtime_leagues$
begin
  alter publication supabase_realtime add table public.leagues;
exception
  when duplicate_object then null;
end;
$realtime_leagues$;

do $realtime_memberships$
begin
  alter publication supabase_realtime add table public.league_memberships;
exception
  when duplicate_object then null;
end;
$realtime_memberships$;

do $realtime_sessions$
begin
  alter publication supabase_realtime add table public.draft_sessions;
exception
  when duplicate_object then null;
end;
$realtime_sessions$;

do $realtime_teams$
begin
  alter publication supabase_realtime add table public.draft_teams;
exception
  when duplicate_object then null;
end;
$realtime_teams$;

do $realtime_picks$
begin
  alter publication supabase_realtime add table public.draft_picks;
exception
  when duplicate_object then null;
end;
$realtime_picks$;
