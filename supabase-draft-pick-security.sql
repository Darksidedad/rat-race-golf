begin;

create or replace function public.draft_player_key(player_name text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(player_name, '')), '\s*/\s*', '/', 'g'), '[.''’]', '', 'g'), '\s+', ' ', 'g'), '\s*[-–—]\s*(amateur|a)$', '', 'i'));
$$;

create or replace function public.submit_draft_pick(target_session_id uuid, target_player_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_session public.draft_sessions%rowtype;
  ordered_team_ids uuid[]; ordered_team_owners uuid[];
  team_count integer; pick_count integer; next_pick_number integer; next_round_number integer;
  round_index integer; expected_team_index integer; expected_team_id uuid; expected_owner_id uuid;
  cleaned_player_name text; cleaned_player_key text; inserted_pick public.draft_picks%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target_session from public.draft_sessions where id = target_session_id for update;
  if not found then raise exception 'Draft session not found'; end if;
  if target_session.status not in ('setup', 'drafting') then raise exception 'This draft is not open for picks'; end if;
  select array_agg(id order by draft_slot), array_agg(owner_user_id order by draft_slot), count(*)
  into ordered_team_ids, ordered_team_owners, team_count from public.draft_teams
  where session_id = target_session_id and active and draft_slot is not null;
  if team_count = 0 then raise exception 'Set the draft order before making picks'; end if;
  if exists (select 1 from (select draft_slot, row_number() over (order by draft_slot) expected_slot from public.draft_teams where session_id = target_session_id and active and draft_slot is not null) ordered where draft_slot <> expected_slot) then raise exception 'The draft order is invalid'; end if;
  select count(*) into pick_count from public.draft_picks where session_id = target_session_id;
  if pick_count >= team_count * 4 then raise exception 'The draft is already complete'; end if;
  next_pick_number := pick_count + 1; next_round_number := ((next_pick_number - 1) / team_count) + 1; round_index := ((next_pick_number - 1) % team_count) + 1;
  expected_team_index := case when next_round_number % 2 = 1 then round_index else team_count - round_index + 1 end;
  expected_team_id := ordered_team_ids[expected_team_index]; expected_owner_id := ordered_team_owners[expected_team_index];
  if not public.is_league_admin(target_session.league_id) and expected_owner_id is distinct from auth.uid() then raise exception 'You can only draft when your team is on the clock'; end if;
  cleaned_player_name := regexp_replace(btrim(coalesce(target_player_name, '')), '\s+', ' ', 'g'); cleaned_player_key := public.draft_player_key(cleaned_player_name);
  if cleaned_player_key = '' then raise exception 'Choose a golfer before drafting'; end if;
  if not exists (select 1 from unnest(string_to_array(target_session.player_input, E'\n')) field_line where lower(btrim(regexp_replace(field_line, '\s+[+-][0-9]+\s*$', '', 'i'))) = lower(cleaned_player_name)) then raise exception 'That golfer is not in this tournament field'; end if;
  if exists (select 1 from public.draft_picks where session_id = target_session_id and (player_key = cleaned_player_key or lower(player_name) = lower(cleaned_player_name))) then raise exception '% has already been drafted', cleaned_player_name; end if;
  insert into public.draft_picks (session_id, team_id, player_name, player_key, pick_number, round_number)
  values (target_session_id, expected_team_id, cleaned_player_name, cleaned_player_key, next_pick_number, next_round_number) returning * into inserted_pick;
  if target_session.field_locked_at is null then update public.draft_sessions set field_locked_at = now() where id = target_session_id; end if;
  return to_jsonb(inserted_pick);
end;
$$;

create or replace function public.auto_draft_session(target_session_id uuid, player_names jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare target_league_id uuid; player_name jsonb; inserted_count integer := 0;
begin
  select league_id into target_league_id from public.draft_sessions where id = target_session_id;
  if target_league_id is null then raise exception 'Draft session not found'; end if;
  if not public.is_league_admin(target_league_id) then raise exception 'Only a league admin can run the random draft'; end if;
  if jsonb_typeof(player_names) <> 'array' then raise exception 'Player list must be an array'; end if;
  for player_name in select value from jsonb_array_elements(player_names) loop
    perform public.submit_draft_pick(target_session_id, player_name #>> '{}'); inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.draft_player_key(text) from public, anon;
grant execute on function public.draft_player_key(text) to authenticated, service_role;
revoke all on function public.submit_draft_pick(uuid, text) from public, anon;
grant execute on function public.submit_draft_pick(uuid, text) to authenticated;
revoke all on function public.auto_draft_session(uuid, jsonb) from public, anon;
grant execute on function public.auto_draft_session(uuid, jsonb) to authenticated;
revoke insert on public.draft_picks from authenticated;

commit;
