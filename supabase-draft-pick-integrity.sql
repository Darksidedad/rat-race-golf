begin;

-- Zero-downtime rollout order:
-- 1. Apply this additive migration while the existing application is still live.
-- 2. Deploy the application version that writes picks only through these RPCs.
-- 3. Apply supabase-draft-pick-permission-hardening.sql to remove legacy direct writes.

create or replace function public.draft_player_key(player_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(btrim(coalesce(player_name, '')), '\s*/\s*', '/', 'g'),
          '[.''’]', '', 'g'
        ),
        '\s+', ' ', 'g'
      ),
      '\s*[-–—]\s*(amateur|a)$', '', 'i'
    )
  );
$$;

create or replace function public.submit_draft_pick(target_session_id uuid, target_player_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.draft_sessions%rowtype;
  ordered_team_ids uuid[];
  ordered_team_owners uuid[];
  active_team_count integer;
  ordered_team_count integer;
  pick_count integer;
  next_pick_number integer;
  next_round_number integer;
  round_index integer;
  expected_team_index integer;
  expected_team_id uuid;
  expected_owner_id uuid;
  cleaned_player_name text;
  cleaned_player_key text;
  inserted_pick public.draft_picks%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into target_session
  from public.draft_sessions
  where id = target_session_id
  for update;
  if not found then raise exception 'Draft session not found'; end if;

  if not public.is_site_admin() and not exists (
    select 1 from public.league_memberships
    where league_id = target_session.league_id and user_id = auth.uid()
  ) then raise exception 'You do not have access to this draft'; end if;
  if target_session.status not in ('setup', 'drafting') then raise exception 'This draft is not open for picks'; end if;

  select count(*) into active_team_count
  from public.draft_teams where session_id = target_session_id and active;
  select array_agg(id order by draft_slot), array_agg(owner_user_id order by draft_slot), count(*)
  into ordered_team_ids, ordered_team_owners, ordered_team_count
  from public.draft_teams
  where session_id = target_session_id and active and draft_slot is not null;

  if active_team_count = 0 or ordered_team_count <> active_team_count then
    raise exception 'Set the draft order before making picks';
  end if;
  if exists (
    select 1 from (
      select draft_slot, row_number() over (order by draft_slot) expected_slot
      from public.draft_teams where session_id = target_session_id and active
    ) ordered where draft_slot <> expected_slot
  ) then raise exception 'The draft order is invalid'; end if;

  select count(*) into pick_count from public.draft_picks where session_id = target_session_id;
  if pick_count >= ordered_team_count * 4 then raise exception 'The draft is already complete'; end if;

  next_pick_number := pick_count + 1;
  next_round_number := ((next_pick_number - 1) / ordered_team_count) + 1;
  round_index := ((next_pick_number - 1) % ordered_team_count) + 1;
  expected_team_index := case when next_round_number % 2 = 1 then round_index else ordered_team_count - round_index + 1 end;
  expected_team_id := ordered_team_ids[expected_team_index];
  expected_owner_id := ordered_team_owners[expected_team_index];

  if not public.is_league_admin(target_session.league_id) and expected_owner_id is distinct from auth.uid() then
    raise exception 'You can only draft when your team is on the clock';
  end if;

  cleaned_player_name := regexp_replace(btrim(coalesce(target_player_name, '')), '\s+', ' ', 'g');
  cleaned_player_key := public.draft_player_key(cleaned_player_name);
  if cleaned_player_key = '' then raise exception 'Choose a golfer before drafting'; end if;
  if not exists (
    select 1 from unnest(string_to_array(target_session.player_input, E'\n')) field_line
    where public.draft_player_key(regexp_replace(field_line, '\s+[+-][0-9]+\s*$', '', 'i')) = cleaned_player_key
  ) then raise exception 'That golfer is not in this tournament field'; end if;

  insert into public.draft_picks (session_id, team_id, player_name, player_key, pick_number, round_number)
  values (target_session_id, expected_team_id, cleaned_player_name, cleaned_player_key, next_pick_number, next_round_number)
  returning * into inserted_pick;

  update public.draft_sessions
  set field_locked_at = coalesce(field_locked_at, now()),
      status = case
        when next_pick_number >= ordered_team_count * 4 then 'draft_complete'
        else 'drafting'
      end
  where id = target_session_id;
  return to_jsonb(inserted_pick);
exception
  when unique_violation then
    raise exception 'That golfer has already been drafted or the draft advanced; refresh and try again';
end;
$$;

create or replace function public.auto_draft_session(target_session_id uuid, player_names jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_league_id uuid;
  player_name jsonb;
  inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select league_id into target_league_id from public.draft_sessions where id = target_session_id;
  if target_league_id is null then raise exception 'Draft session not found'; end if;
  if not public.is_league_admin(target_league_id) then raise exception 'Only a league admin can run the random draft'; end if;
  if jsonb_typeof(player_names) <> 'array' then raise exception 'Player list must be an array'; end if;

  for player_name in select value from jsonb_array_elements(player_names)
  loop
    if jsonb_typeof(player_name) <> 'string' then raise exception 'Every player name must be a string'; end if;
    perform public.submit_draft_pick(target_session_id, player_name #>> '{}');
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

create or replace function public.undo_last_draft_pick(target_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.draft_sessions%rowtype;
  removed_pick public.draft_picks%rowtype;
  remaining_pick_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target_session from public.draft_sessions where id = target_session_id for update;
  if not found then raise exception 'Draft session not found'; end if;
  if not public.is_league_admin(target_session.league_id) then raise exception 'Only a league admin can undo picks'; end if;
  if target_session.status not in ('setup', 'drafting', 'draft_complete') then raise exception 'Picks cannot be undone after scoring has started'; end if;

  select * into removed_pick from public.draft_picks
  where session_id = target_session_id
  order by pick_number desc limit 1;
  if not found then raise exception 'There is no pick to undo'; end if;

  delete from public.draft_picks where id = removed_pick.id;
  select count(*) into remaining_pick_count from public.draft_picks where session_id = target_session_id;
  update public.draft_sessions
  set field_locked_at = case when remaining_pick_count = 0 then null else field_locked_at end,
      status = 'drafting'
  where id = target_session_id;
  return to_jsonb(removed_pick);
end;
$$;

revoke all on function public.draft_player_key(text) from public, anon;
grant execute on function public.draft_player_key(text) to authenticated, service_role;
revoke all on function public.submit_draft_pick(uuid, text) from public, anon;
grant execute on function public.submit_draft_pick(uuid, text) to authenticated;
revoke all on function public.auto_draft_session(uuid, jsonb) from public, anon;
grant execute on function public.auto_draft_session(uuid, jsonb) to authenticated;
revoke all on function public.undo_last_draft_pick(uuid) from public, anon;
grant execute on function public.undo_last_draft_pick(uuid) to authenticated;

commit;
