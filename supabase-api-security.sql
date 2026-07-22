begin;

create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  window_start timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, route)
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  target_user_id uuid,
  target_route text,
  request_limit integer,
  window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if target_user_id is null or nullif(btrim(target_route), '') is null then
    return false;
  end if;
  if request_limit < 1 or window_seconds < 1 then
    return false;
  end if;

  insert into public.api_rate_limits (user_id, route, window_start, request_count)
  values (target_user_id, btrim(target_route), now(), 1)
  on conflict (user_id, route) do update
  set window_start = case
        when api_rate_limits.window_start <= now() - make_interval(secs => window_seconds) then now()
        else api_rate_limits.window_start
      end,
      request_count = case
        when api_rate_limits.window_start <= now() - make_interval(secs => window_seconds) then 1
        else api_rate_limits.request_count + 1
      end
  returning request_count into next_count;

  return next_count <= request_limit;
end;
$$;

revoke all on function public.consume_api_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(uuid, text, integer, integer) to service_role;

commit;
