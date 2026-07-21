begin;

create table if not exists public.tournament_catalog (
  id uuid primary key default gen_random_uuid(),
  tour text not null,
  season integer not null,
  provider text not null,
  provider_event_id text not null,
  name text not null,
  start_date timestamptz,
  course text,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_catalog_provider_event_unique unique (provider, provider_event_id)
);

create table if not exists public.tournament_snapshots (
  tournament_id uuid primary key references public.tournament_catalog(id) on delete cascade,
  player_field jsonb not null default '[]'::jsonb,
  odds jsonb not null default '{}'::jsonb,
  leaderboard jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  leaderboard_rows jsonb not null default '[]'::jsonb,
  finalized boolean not null default false,
  field_source text,
  results_source text,
  field_refreshed_at timestamptz,
  results_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.draft_sessions
  add column if not exists tournament_id uuid references public.tournament_catalog(id) on delete set null;

drop trigger if exists tournament_catalog_set_updated_at on public.tournament_catalog;
create trigger tournament_catalog_set_updated_at
before update on public.tournament_catalog
for each row execute function public.set_updated_at();

drop trigger if exists tournament_snapshots_set_updated_at on public.tournament_snapshots;
create trigger tournament_snapshots_set_updated_at
before update on public.tournament_snapshots
for each row execute function public.set_updated_at();

alter table public.tournament_catalog enable row level security;
alter table public.tournament_snapshots enable row level security;

revoke all on public.tournament_catalog from authenticated;
grant select on public.tournament_catalog to authenticated;
revoke all on public.tournament_snapshots from authenticated;
grant select on public.tournament_snapshots to authenticated;

drop policy if exists "tournament catalog authenticated read" on public.tournament_catalog;
create policy "tournament catalog authenticated read"
on public.tournament_catalog for select to authenticated using (true);

drop policy if exists "tournament snapshots authenticated read" on public.tournament_snapshots;
create policy "tournament snapshots authenticated read"
on public.tournament_snapshots for select to authenticated using (true);

insert into public.tournament_catalog (tour, season, provider, provider_event_id, name, status)
select distinct on (draft_sessions.event_id)
  coalesce(draft_sessions.event_tour, 'pga'),
  coalesce(draft_sessions.event_season, extract(year from draft_sessions.created_at)::integer),
  case when draft_sessions.event_id like 'dg:%' then 'data-golf' else 'espn' end,
  draft_sessions.event_id,
  coalesce(draft_sessions.event_name, draft_sessions.name),
  case when draft_sessions.status = 'finalized' then 'completed' else 'scheduled' end
from public.draft_sessions
where draft_sessions.event_id is not null
order by draft_sessions.event_id, draft_sessions.updated_at desc
on conflict (provider, provider_event_id) do update set
  name = excluded.name,
  tour = excluded.tour,
  season = excluded.season;

update public.draft_sessions
set tournament_id = tournament_catalog.id
from public.tournament_catalog
where draft_sessions.tournament_id is null
  and draft_sessions.event_id = tournament_catalog.provider_event_id;

with newest_session as (
  select distinct on (draft_sessions.tournament_id)
    draft_sessions.*
  from public.draft_sessions
  where draft_sessions.tournament_id is not null
  order by draft_sessions.tournament_id, draft_sessions.updated_at desc
)
insert into public.tournament_snapshots (
  tournament_id,
  player_field,
  odds,
  leaderboard,
  totals,
  finalized,
  field_source,
  results_source,
  field_refreshed_at,
  results_refreshed_at
)
select
  newest_session.tournament_id,
  coalesce((
    select jsonb_agg(line order by ordinal)
    from unnest(string_to_array(newest_session.player_input, E'\n')) with ordinality as player(line, ordinal)
    where btrim(line) <> ''
  ), '[]'::jsonb),
  coalesce(newest_session.odds_snapshot, '{}'::jsonb),
  coalesce(newest_session.current_positions, '{}'::jsonb),
  coalesce(newest_session.current_totals, '{}'::jsonb),
  newest_session.status = 'finalized',
  newest_session.field_source,
  case when coalesce(newest_session.current_positions, '{}'::jsonb) <> '{}'::jsonb then 'existing draft session' else null end,
  newest_session.field_refreshed_at,
  case when coalesce(newest_session.current_positions, '{}'::jsonb) <> '{}'::jsonb then newest_session.updated_at else null end
from newest_session
on conflict (tournament_id) do nothing;

commit;
