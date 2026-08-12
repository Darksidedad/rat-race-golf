import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizeProviderApi, consumeProviderQuota, forwardedProviderHeaders } from "@/lib/provider-api-auth";

const DATA_GOLF_BASE_URL = "https://feeds.datagolf.com";

type DataGolfEndpoint = {
  path: string;
  allowedParams: string[];
  cacheSeconds: number;
  defaults?: Record<string, string>;
  requiredParams?: string[];
};

const ENDPOINTS: Record<string, DataGolfEndpoint> = {
  "player-list": {
    path: "/get-player-list",
    allowedParams: ["file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { file_format: "json" },
  },
  schedule: {
    path: "/get-schedule",
    allowedParams: ["tour", "season", "upcoming_only", "file_format"],
    cacheSeconds: 60 * 60,
    defaults: { tour: "pga", upcoming_only: "no", file_format: "json" },
  },
  field: {
    path: "/field-updates",
    allowedParams: ["tour", "file_format"],
    cacheSeconds: 5 * 60,
    defaults: { tour: "pga", file_format: "json" },
  },
  "pre-tournament": {
    path: "/preds/pre-tournament",
    allowedParams: ["tour", "add_position", "dead_heat", "odds_format", "file_format"],
    cacheSeconds: 60 * 60,
    defaults: { tour: "pga", dead_heat: "yes", odds_format: "american", file_format: "json" },
  },
  "live-predictions": {
    path: "/preds/in-play",
    allowedParams: ["tour", "dead_heat", "odds_format", "file_format"],
    cacheSeconds: 5 * 60,
    defaults: { tour: "pga", dead_heat: "no", odds_format: "american", file_format: "json" },
  },
  "live-stats": {
    path: "/preds/live-tournament-stats",
    allowedParams: ["stats", "round", "display", "file_format"],
    cacheSeconds: 5 * 60,
    defaults: { round: "event_cumulative", display: "value", file_format: "json" },
  },
  "outright-odds": {
    path: "/betting-tools/outrights",
    allowedParams: ["tour", "market", "odds_format", "file_format"],
    cacheSeconds: 5 * 60,
    defaults: { tour: "pga", odds_format: "american", file_format: "json" },
    requiredParams: ["market"],
  },
  "historical-raw-event-list": {
    path: "/historical-raw-data/event-list",
    allowedParams: ["tour", "file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { tour: "pga", file_format: "json" },
  },
  "historical-raw-rounds": {
    path: "/historical-raw-data/rounds",
    allowedParams: ["tour", "event_id", "year", "file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { tour: "pga", file_format: "json" },
    requiredParams: ["tour", "event_id", "year"],
  },
  "historical-event-list": {
    path: "/historical-event-data/event-list",
    allowedParams: ["tour", "file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { tour: "pga", file_format: "json" },
  },
  "historical-event-results": {
    path: "/historical-event-data/events",
    allowedParams: ["tour", "event_id", "year", "file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { tour: "pga", file_format: "json" },
    requiredParams: ["tour", "event_id", "year"],
  },
  "historical-outrights": {
    path: "/historical-odds/outrights",
    allowedParams: ["tour", "event_id", "year", "market", "book", "odds_format", "file_format"],
    cacheSeconds: 24 * 60 * 60,
    defaults: { tour: "pga", odds_format: "american", file_format: "json" },
    requiredParams: ["market", "book"],
  },
};

type DataGolfScheduleEvent = {
  course?: string | null;
  event_id?: number | string | null;
  event_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  status?: string | null;
  tour?: string | null;
};

type DataGolfFieldPlayer = {
  dg_id?: number | string | null;
  player_name?: string | null;
  country?: string | null;
  dg_rank?: number | string | null;
  owgr_rank?: number | string | null;
  teetimes?: Array<{ round_num?: number | string | null; teetime?: string | null; start_hole?: number | string | null; wave?: string | null }>;
};

type DataGolfHistoricalResult = {
  fin_text?: string | number | null;
  player_name?: string | null;
};

type DataGolfHistoricalRound = {
  course_par?: number | string | null;
  score?: number | string | null;
};

type DataGolfHistoricalRoundsPlayer = DataGolfHistoricalResult & {
  round_1?: DataGolfHistoricalRound | null;
  round_2?: DataGolfHistoricalRound | null;
  round_3?: DataGolfHistoricalRound | null;
  round_4?: DataGolfHistoricalRound | null;
};

type DataGolfPredictionPlayer = {
  current_pos?: string | null;
  current_score?: number | string | null;
  dg_id?: number | string | null;
  end_hole?: number | string | null;
  make_cut?: string | number | null;
  player_name?: string | null;
  round?: number | string | null;
  thru?: number | string | null;
  top_10?: string | number | null;
  top_20?: string | number | null;
  win?: string | number | null;
};

function predictionHasStarted(row: DataGolfPredictionPlayer) {
  const thru = Number(row.thru);
  return Number.isFinite(thru) && thru > 0;
}

type DataGolfOddsPlayer = {
  datagolf?: { baseline?: string | number | null; baseline_history_fit?: string | number | null } | null;
  dg_id?: number | string | null;
  draftkings?: string | number | null;
  fanduel?: string | number | null;
  player_name?: string | null;
};

type DataGolfProxyPayload<T> = {
  ok: boolean;
  action?: string;
  source?: string;
  data?: T;
  error?: string;
};

type SharedTournamentSnapshot = {
  tournament_id: string;
  player_field: string[];
  odds: Record<string, number>;
  leaderboard: Record<string, number | null>;
  totals: Record<string, string | null>;
  leaderboard_rows: Array<{ name: string; position: number | null; positionLabel: string; total: string | null; thru: string | null }>;
  finalized: boolean;
  field_source: string | null;
  results_source: string | null;
  field_refreshed_at: string | null;
  results_refreshed_at: string | null;
};

function catalogClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function catalogProviderEventId(eventId: string, tour: string, season: number | string) {
  return eventId.startsWith("dg:") ? eventId : formatDataGolfEventId(tour, season, eventId);
}

async function ensureCatalogTournament(input: {
  providerEventId: string;
  tour: string;
  season: number;
  name: string;
  startDate?: string | null;
  course?: string | null;
  location?: string | null;
}) {
  const supabase = catalogClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("tournament_catalog").upsert({
    provider: "data-golf",
    provider_event_id: input.providerEventId,
    tour: input.tour,
    season: input.season,
    name: input.name,
    start_date: input.startDate ?? null,
    course: input.course ?? null,
    location: input.location ?? null,
  }, { onConflict: "provider,provider_event_id" }).select("id").single();
  if (error) {
    console.error("Tournament catalog upsert failed", error);
    return null;
  }
  return data.id as string;
}

async function loadSharedSnapshot(providerEventId: string) {
  const supabase = catalogClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("tournament_catalog")
    .select("id,tournament_snapshots(*)")
    .eq("provider", "data-golf")
    .eq("provider_event_id", providerEventId)
    .maybeSingle();
  if (error) {
    console.error("Tournament snapshot lookup failed", error);
    return null;
  }
  const snapshot = Array.isArray(data?.tournament_snapshots) ? data?.tournament_snapshots[0] : data?.tournament_snapshots;
  return snapshot as SharedTournamentSnapshot | null;
}

async function saveSharedSnapshot(tournamentId: string | null, values: Partial<SharedTournamentSnapshot>) {
  const supabase = catalogClient();
  if (!supabase || !tournamentId) return;
  const { error } = await supabase.from("tournament_snapshots").upsert({ tournament_id: tournamentId, ...values }, { onConflict: "tournament_id" });
  if (error) console.error("Tournament snapshot save failed", error);
  if (values.finalized) {
    const { error: statusError } = await supabase.from("tournament_catalog").update({ status: "completed" }).eq("id", tournamentId);
    if (statusError) console.error("Tournament catalog status update failed", statusError);
  }
}

function dataGolfKey() {
  return process.env.DATA_GOLF_API_KEY ?? process.env.DATAGOLF_API_KEY ?? "";
}

function normalizeTour(value: string | null) {
  const normalized = String(value ?? "pga").trim().toLowerCase();
  if (normalized === "eur") return "euro";
  if (normalized === "ntw") return "kft";
  if (normalized === "liv") return "alt";
  return normalized;
}

function cachedJson(body: unknown, cacheSeconds: number, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (cacheSeconds > 0 && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${Math.max(cacheSeconds, 60)}`);
  }
  return NextResponse.json(body, { ...init, headers });
}

function formatDataGolfPlayerName(value: string | null | undefined) {
  const name = String(value ?? "").trim();
  const match = name.match(/^([^,]+),\s*(.+)$/);
  return match ? `${match[2]} ${match[1]}`.replace(/\s+/g, " ").trim() : name;
}

function parseDataGolfEventId(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:^|:)(dg:)?(?:[a-z]+:)?(?:\d{4}:)?(\d+)$/i);
  return match?.[2] ?? raw;
}

function formatDataGolfEventId(tour: string, season: number | string, eventId: number | string | null | undefined) {
  return `dg:${normalizeTour(tour)}:${season}:${eventId}`;
}

function normalizedEventName(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bpresented by\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventNamesMatch(expected: string | null | undefined, actual: string | null | undefined) {
  const left = normalizedEventName(expected);
  const right = normalizedEventName(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

async function fetchHistoricalEvent(request: NextRequest, eventId: string) {
  const historicalUrl = new URL(request.url);
  historicalUrl.searchParams.set("action", "historical-event-results");
  historicalUrl.searchParams.set("event_id", eventId);
  historicalUrl.searchParams.set("year", request.nextUrl.searchParams.get("season") ?? String(new Date().getFullYear()));
  return fetchDataGolf<{
    event_id?: number | string;
    event_name?: string;
    event_stats?: DataGolfHistoricalResult[];
  }>(new NextRequest(historicalUrl), "historical-event-results");
}

async function fetchHistoricalRounds(request: NextRequest, eventId: string) {
  const historicalUrl = new URL(request.url);
  historicalUrl.searchParams.set("action", "historical-raw-rounds");
  historicalUrl.searchParams.set("event_id", eventId);
  historicalUrl.searchParams.set("year", request.nextUrl.searchParams.get("season") ?? String(new Date().getFullYear()));
  return fetchDataGolf<{
    event_id?: number | string;
    event_name?: string;
    scores?: DataGolfHistoricalRoundsPlayer[];
  }>(new NextRequest(historicalUrl), "historical-raw-rounds");
}

function parseAmericanOdds(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").replace(/[^\d+-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positionNumber(position: string | number | null | undefined) {
  if (typeof position === "number" && Number.isFinite(position)) return position;
  const match = String(position ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function scoreLabel(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
  return String(value);
}

function scoreNumber(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  if (value.toUpperCase() === "E") return 0;
  const parsed = Number(value.replace("+", ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function hasMeaningfulLeaderboard(rows: Array<{ position: number | null; total: string | null; thru: string | null }>) {
  if (!rows.length) return false;
  const normalized = rows.map((row) => ({
    position: row.position,
    total: String(row.total ?? "").trim().toUpperCase(),
    thru: String(row.thru ?? "").trim().toUpperCase(),
  }));
  const hasCompletedPlayer = normalized.some((row) => ["F", "CUT", "WD", "DQ"].includes(row.thru));
  const distinctResults = new Set(normalized.map((row) => `${row.position ?? ""}|${row.total}|${row.thru}`));
  return hasCompletedPlayer && distinctResults.size > 1;
}

function thruLabel(row: DataGolfPredictionPlayer) {
  const thru = Number(row.thru);
  const endHole = Number(row.end_hole);
  if (Number.isFinite(thru) && Number.isFinite(endHole) && thru >= endHole) return "F";
  if (Number.isFinite(thru) && thru > 0) return `Thru ${thru}`;
  return null;
}

function buildDataGolfUrl(request: NextRequest, endpoint: DataGolfEndpoint, key: string) {
  const url = new URL(endpoint.path, DATA_GOLF_BASE_URL);
  const params = request.nextUrl.searchParams;

  Object.entries(endpoint.defaults ?? {}).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });

  endpoint.allowedParams.forEach((name) => {
    const value = params.get(name);
    if (!value) return;
    url.searchParams.set(name, name === "tour" ? normalizeTour(value) : value);
  });

  url.searchParams.set("key", key);
  return url;
}

async function fetchDataGolf<T>(request: NextRequest, action: string): Promise<DataGolfProxyPayload<T>> {
  const endpoint = ENDPOINTS[action];
  if (!endpoint) throw new Error(`Missing Data Golf action: ${action}`);
  const key = dataGolfKey();
  if (!key) throw new Error("Missing DATA_GOLF_API_KEY server environment variable.");
  if (!await consumeProviderQuota("data-golf", 40)) throw new Error("DATA_GOLF_GLOBAL_RATE_LIMIT");
  const dataGolfUrl = buildDataGolfUrl(request, endpoint, key);
  const response = await fetch(dataGolfUrl, { next: { revalidate: endpoint.cacheSeconds } });
  if (!response.ok) throw new Error(`Data Golf ${action} request failed with ${response.status}.`);
  const payload = await response.json();
  return { ok: true, action, source: `${DATA_GOLF_BASE_URL}${endpoint.path}`, data: payload };
}

async function appEvents(request: NextRequest) {
  const tour = normalizeTour(request.nextUrl.searchParams.get("tour"));
  const season = request.nextUrl.searchParams.get("season") ?? String(new Date().getFullYear());
  const raw = await fetchDataGolf<{ schedule?: DataGolfScheduleEvent[] }>(request, "schedule");
  const eventRows = (raw.data?.schedule ?? [])
    .filter((event) => event.event_id !== null && event.event_id !== undefined && event.event_name)
    .filter((event) => !event.tour || normalizeTour(event.tour) === tour)
    .map((event) => ({
      id: formatDataGolfEventId(tour, season, event.event_id),
      name: String(event.event_name),
      season: Number(season),
      startDate: event.start_date ?? undefined,
      dateLabel: event.start_date ?? undefined,
      location: event.location ?? undefined,
      course: event.course ?? undefined,
    }));
  const events = await Promise.all(eventRows.map(async (event) => ({
    ...event,
    catalogId: await ensureCatalogTournament({
      providerEventId: event.id,
      tour,
      season: Number(season),
      name: event.name,
      startDate: event.startDate,
      course: event.course,
      location: event.location,
    }),
  })));

  return cachedJson({ ok: true, tour, events }, ENDPOINTS.schedule.cacheSeconds);
}

async function appOdds(request: NextRequest) {
  const raw = await fetchDataGolf<{ odds?: DataGolfOddsPlayer[] }>(request, "outright-odds");
  const odds: Record<string, number> = {};

  (raw.data?.odds ?? []).forEach((entry) => {
    const name = formatDataGolfPlayerName(entry.player_name);
    const value = parseAmericanOdds(entry.datagolf?.baseline ?? entry.draftkings ?? entry.fanduel);
    if (name && Number.isFinite(value)) odds[name] = value!;
  });

  return cachedJson({
    ok: true,
    eventName: (raw.data as { event_name?: string } | undefined)?.event_name,
    odds,
    source: raw.source,
  }, ENDPOINTS["outright-odds"].cacheSeconds);
}

async function appField(request: NextRequest) {
  const eventId = parseDataGolfEventId(request.nextUrl.searchParams.get("eventId"));
  const tour = normalizeTour(request.nextUrl.searchParams.get("tour"));
  const season = Number(request.nextUrl.searchParams.get("season") ?? new Date().getFullYear());
  const providerEventId = catalogProviderEventId(String(request.nextUrl.searchParams.get("eventId") ?? eventId), tour, season);
  const sharedSnapshot = await loadSharedSnapshot(providerEventId);
  const fieldRefreshedAt = sharedSnapshot?.field_refreshed_at ? new Date(sharedSnapshot.field_refreshed_at).getTime() : 0;
  if (sharedSnapshot?.player_field?.length && Date.now() - fieldRefreshedAt < 6 * 60 * 60 * 1000) {
    return cachedJson({
      ok: true,
      eventName: undefined,
      players: sharedSnapshot.player_field,
      odds: sharedSnapshot.odds ?? {},
      oddsSource: sharedSnapshot.field_source ?? "shared tournament snapshot",
      source: sharedSnapshot.field_source ?? "shared tournament snapshot",
      lastUpdated: sharedSnapshot.field_refreshed_at,
      cached: true,
    }, ENDPOINTS.field.cacheSeconds);
  }
  const raw = await fetchDataGolf<{ event_id?: number | string; event_name?: string; field?: DataGolfFieldPlayer[]; last_updated?: string }>(request, "field");
  const currentEventId = String(raw.data?.event_id ?? "");

  if (eventId && currentEventId && eventId !== currentEventId) {
    try {
      const historical = await fetchHistoricalEvent(request, eventId);
      const historicalEventId = String(historical.data?.event_id ?? "");
      const players = (historical.data?.event_stats ?? [])
        .map((player) => formatDataGolfPlayerName(player.player_name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      if (historicalEventId === eventId && players.length) {
        const tournamentId = await ensureCatalogTournament({
          providerEventId,
          tour,
          season,
          name: historical.data?.event_name ?? providerEventId,
        });
        await saveSharedSnapshot(tournamentId, {
          player_field: players,
          field_source: historical.source ?? null,
          field_refreshed_at: new Date().toISOString(),
        });
        return cachedJson({
          ok: true,
          eventName: historical.data?.event_name,
          players,
          odds: {},
          oddsSource: "",
          source: historical.source,
        }, ENDPOINTS["historical-event-results"].cacheSeconds);
      }
    } catch (error) {
      console.error("Historical field fallback failed", error);
    }

    return NextResponse.json({
      ok: false,
      error: `Data Golf field updates are currently for ${raw.data?.event_name ?? "the active event"} only, and no completed historical field was available.`,
      activeEventId: currentEventId,
    }, { status: 409 });
  }

  const players = (raw.data?.field ?? [])
    .map((player) => formatDataGolfPlayerName(player.player_name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  let odds: Record<string, number> = {};
  let oddsSource = "";
  try {
    const oddsRequest = new NextRequest(new URL(`${request.nextUrl.origin}${request.nextUrl.pathname}?action=outright-odds&tour=${encodeURIComponent(request.nextUrl.searchParams.get("tour") ?? "pga")}&market=win&odds_format=american`));
    const oddsResponse = await appOdds(oddsRequest);
    const oddsPayload = await oddsResponse.json();
    odds = oddsPayload.ok && oddsPayload.odds ? oddsPayload.odds : {};
    oddsSource = oddsPayload.source ?? "";
  } catch {
    odds = {};
  }

  const tournamentId = await ensureCatalogTournament({
    providerEventId,
    tour,
    season,
    name: raw.data?.event_name ?? providerEventId,
  });
  await saveSharedSnapshot(tournamentId, {
    player_field: players,
    odds,
    field_source: raw.source ?? null,
    field_refreshed_at: new Date().toISOString(),
  });

  return cachedJson({
    ok: true,
    eventName: raw.data?.event_name,
    players,
    odds,
    oddsSource,
    source: raw.source,
    lastUpdated: raw.data?.last_updated,
  }, ENDPOINTS.field.cacheSeconds);
}

async function appLeaderboard(request: NextRequest) {
  const requestedEventId = parseDataGolfEventId(request.nextUrl.searchParams.get("eventId"));
  const expectedEventName = request.nextUrl.searchParams.get("eventName");
  const tour = normalizeTour(request.nextUrl.searchParams.get("tour"));
  const season = Number(request.nextUrl.searchParams.get("season") ?? new Date().getFullYear());
  const providerEventId = catalogProviderEventId(String(request.nextUrl.searchParams.get("eventId") ?? requestedEventId), tour, season);
  const tournamentId = expectedEventName ? await ensureCatalogTournament({ providerEventId, tour, season, name: expectedEventName }) : null;
  const sharedSnapshot = await loadSharedSnapshot(providerEventId);
  const resultsRefreshedAt = sharedSnapshot?.results_refreshed_at ? new Date(sharedSnapshot.results_refreshed_at).getTime() : 0;
  if (sharedSnapshot?.leaderboard_rows?.length && (sharedSnapshot.finalized || Date.now() - resultsRefreshedAt < 5 * 60 * 1000)) {
    return cachedJson({
      ok: true,
      eventName: expectedEventName,
      leaderboard: sharedSnapshot.leaderboard,
      totals: sharedSnapshot.totals,
      rows: sharedSnapshot.leaderboard_rows,
      finalized: sharedSnapshot.finalized,
      source: sharedSnapshot.results_source ?? "shared tournament snapshot",
      cached: true,
    }, sharedSnapshot.finalized ? ENDPOINTS["historical-event-results"].cacheSeconds : ENDPOINTS["live-predictions"].cacheSeconds);
  }
  const raw = await fetchDataGolf<{ data?: DataGolfPredictionPlayer[]; info?: { event_id?: number | string; event_name?: string; current_round?: number | string; last_update?: string } }>(request, "live-predictions");
  const activeEventId = String(raw.data?.info?.event_id ?? "").trim();

  if (requestedEventId && activeEventId && requestedEventId !== activeEventId) {
    return NextResponse.json({
      ok: false,
      error: `Data Golf leaderboard updates are currently for ${raw.data?.info?.event_name ?? "the active event"} only.`,
      activeEventId,
      eventName: raw.data?.info?.event_name,
    }, { status: 409 });
  }

  if (expectedEventName && !eventNamesMatch(expectedEventName, raw.data?.info?.event_name)) {
    try {
      const season = request.nextUrl.searchParams.get("season") ?? String(new Date().getFullYear());
      const eventsResponse = await fetch(`${request.nextUrl.origin}/api/espn-golf?action=events&season=${encodeURIComponent(season)}`, { cache: "no-store", headers: forwardedProviderHeaders(request) });
      const eventsPayload = await eventsResponse.json() as { ok?: boolean; events?: Array<{ id?: string; name?: string }> };
      const matchingEvent = eventsPayload.events?.find((event) => event.id && eventNamesMatch(expectedEventName, event.name));
      if (eventsPayload.ok && matchingEvent?.id) {
        const leaderboardResponse = await fetch(`${request.nextUrl.origin}/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(matchingEvent.id)}&season=${encodeURIComponent(season)}`, { cache: "no-store", headers: forwardedProviderHeaders(request) });
        const leaderboardPayload = await leaderboardResponse.json() as {
          ok?: boolean;
          eventName?: string;
          leaderboard?: Record<string, number | null>;
          totals?: Record<string, string | null>;
          rows?: Array<{ name: string; position: number | null; positionLabel: string; total: string | null; thru: string | null }>;
          finalized?: boolean;
          source?: string;
        };
        if (
          leaderboardPayload.ok
          && eventNamesMatch(expectedEventName, leaderboardPayload.eventName)
          && leaderboardPayload.rows?.length
          && hasMeaningfulLeaderboard(leaderboardPayload.rows)
        ) {
          await saveSharedSnapshot(tournamentId, {
            leaderboard: leaderboardPayload.leaderboard ?? {},
            totals: leaderboardPayload.totals ?? {},
            leaderboard_rows: leaderboardPayload.rows,
            finalized: true,
            results_source: leaderboardPayload.source ?? "ESPN historical leaderboard",
            results_refreshed_at: new Date().toISOString(),
          });
          return cachedJson({ ...leaderboardPayload, finalized: true }, ENDPOINTS["historical-event-results"].cacheSeconds);
        }
      }
    } catch (error) {
      console.error("ESPN historical leaderboard fallback failed", error);
    }

    try {
      const [historical, historicalRounds] = await Promise.all([
        fetchHistoricalEvent(request, requestedEventId),
        fetchHistoricalRounds(request, requestedEventId),
      ]);
      const historicalEventId = String(historical.data?.event_id ?? "");
      const roundScoresByName = new Map(
        (historicalRounds.data?.scores ?? []).map((player) => {
          const rounds = [player.round_1, player.round_2, player.round_3, player.round_4].filter(Boolean) as DataGolfHistoricalRound[];
          const totalToPar = rounds.reduce((total, round) => {
            const score = Number(round.score);
            const par = Number(round.course_par);
            return total + (Number.isFinite(score) && Number.isFinite(par) ? score - par : 0);
          }, 0);
          return [formatDataGolfPlayerName(player.player_name), rounds.length ? scoreLabel(totalToPar) : null] as const;
        }),
      );
      const rows = (historical.data?.event_stats ?? []).map((player) => {
        const name = formatDataGolfPlayerName(player.player_name);
        const finish = String(player.fin_text ?? "").trim().toUpperCase();
        const position = positionNumber(finish);
        const status = ["CUT", "WD", "DQ"].includes(finish) ? finish : null;
        return {
          name,
          position,
          positionLabel: finish,
          total: roundScoresByName.get(name) ?? null,
          thru: status ?? (position ? "F" : null),
        };
      }).filter((row) => row.name);

      if (
        historicalEventId === requestedEventId
        && String(historicalRounds.data?.event_id ?? "") === requestedEventId
        && eventNamesMatch(historical.data?.event_name, historicalRounds.data?.event_name)
        && hasMeaningfulLeaderboard(rows)
      ) {
        const historicalLeaderboard = Object.fromEntries(rows.map((row) => [row.name, row.position]));
        const historicalTotals = Object.fromEntries(rows.map((row) => [row.name, `${row.total ?? ""}||${row.thru ?? ""}`]));
        await saveSharedSnapshot(tournamentId, {
          leaderboard: historicalLeaderboard,
          totals: historicalTotals,
          leaderboard_rows: rows,
          finalized: true,
          results_source: historical.source ?? null,
          results_refreshed_at: new Date().toISOString(),
        });
        return cachedJson({
          ok: true,
          eventName: historical.data?.event_name,
          leaderboard: historicalLeaderboard,
          totals: historicalTotals,
          rows,
          finalized: true,
          source: historical.source,
        }, ENDPOINTS["historical-event-results"].cacheSeconds);
      }
    } catch (error) {
      console.error("Historical leaderboard fallback failed", error);
    }

    return NextResponse.json({
      ok: false,
      error: `Leaderboard event mismatch: expected ${expectedEventName}, received ${raw.data?.info?.event_name ?? "an unidentified event"}.`,
      eventName: raw.data?.info?.event_name,
    }, { status: 409 });
  }

  // Data Golf publishes in-play prediction rows before the opening tee time. Those
  // rows contain projected positions and even-par scores, but they are not a live
  // leaderboard. Do not persist them: missing field members would also be rendered
  // as withdrawals by the draft leaderboard.
  if (!(raw.data?.data ?? []).some(predictionHasStarted)) {
    await saveSharedSnapshot(tournamentId, {
      leaderboard: {},
      totals: {},
      leaderboard_rows: [],
      finalized: false,
      results_source: raw.source ?? null,
      results_refreshed_at: new Date().toISOString(),
    });
    return cachedJson({
      ok: true,
      eventName: raw.data?.info?.event_name,
      leaderboard: {},
      totals: {},
      rows: [],
      finalized: false,
      notStarted: true,
      source: raw.source,
    }, ENDPOINTS["live-predictions"].cacheSeconds);
  }
  const leaderboard: Record<string, number | null> = {};
  const totals: Record<string, string | null> = {};
  const rows = (raw.data?.data ?? []).map((row) => {
    const name = formatDataGolfPlayerName(row.player_name);
    const position = positionNumber(row.current_pos);
    const total = scoreLabel(row.current_score);
    const thru = thruLabel(row);
    if (name) {
      leaderboard[name] = position;
      totals[name] = [total, thru].filter(Boolean).join("||") || null;
    }
    return {
      name,
      position,
      positionLabel: String(row.current_pos ?? ""),
      total,
      thru,
    };
  }).filter((row) => row.name)
    .sort((a, b) => {
      const aPosition = a.position ?? Number.POSITIVE_INFINITY;
      const bPosition = b.position ?? Number.POSITIVE_INFINITY;
      if (aPosition !== bPosition) return aPosition - bPosition;

      const aScore = scoreNumber(a.total);
      const bScore = scoreNumber(b.total);
      if (aScore !== bScore) return aScore - bScore;

      return a.name.localeCompare(b.name);
    });

  const round = Number(raw.data?.info?.current_round);
  const finalized = Number.isFinite(round) && round >= 4 && rows.length > 0 && rows.every((row) => row.thru === "F");

  await saveSharedSnapshot(tournamentId, {
    leaderboard,
    totals,
    leaderboard_rows: rows,
    finalized,
    results_source: raw.source ?? null,
    results_refreshed_at: new Date().toISOString(),
  });

  return cachedJson({
    ok: true,
    eventName: raw.data?.info?.event_name,
    leaderboard,
    totals,
    rows,
    finalized,
    source: raw.source,
  }, ENDPOINTS["live-predictions"].cacheSeconds);
}

async function handleGet(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") ?? "";
  if (action === "app-events") return appEvents(request);
  if (action === "app-field") return appField(request);
  if (action === "app-odds") return appOdds(request);
  if (action === "app-leaderboard") return appLeaderboard(request);

  const endpoint = ENDPOINTS[action];

  if (!endpoint) {
    return NextResponse.json({
      ok: false,
      error: `Missing or invalid Data Golf action. Use one of: ${Object.keys(ENDPOINTS).join(", ")}`,
    }, { status: 400 });
  }

  const key = dataGolfKey();
  if (!key) {
    return NextResponse.json({
      ok: false,
      error: "Missing DATA_GOLF_API_KEY server environment variable.",
    }, { status: 503 });
  }

  const missingParam = endpoint.requiredParams?.find((param) => !request.nextUrl.searchParams.get(param));
  if (missingParam) {
    return NextResponse.json({
      ok: false,
      error: `Missing required parameter: ${missingParam}`,
    }, { status: 400 });
  }

  const dataGolfUrl = buildDataGolfUrl(request, endpoint, key);
  if (!await consumeProviderQuota("data-golf", 40)) throw new Error("DATA_GOLF_GLOBAL_RATE_LIMIT");
  const response = await fetch(dataGolfUrl, {
    next: { revalidate: endpoint.cacheSeconds },
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const detail = contentType.includes("application/json") ? await response.json() : await response.text();
    return NextResponse.json({
      ok: false,
      error: "Data Golf request failed.",
      status: response.status,
      detail,
    }, { status: response.status });
  }

  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  return cachedJson({
    ok: true,
    action,
    source: `${DATA_GOLF_BASE_URL}${endpoint.path}`,
    data: payload,
  }, endpoint.cacheSeconds);
}

export async function GET(request: NextRequest) {
  const access = await authorizeProviderApi(request, "data-golf", 120);
  if (!access.ok) return access.response;
  try {
    return await handleGet(request);
  } catch (error) {
    if (error instanceof Error && error.message === "DATA_GOLF_GLOBAL_RATE_LIMIT") {
      return NextResponse.json(
        { ok: false, error: "Data Golf is temporarily at its shared request limit. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    throw error;
  }
}
