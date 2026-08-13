import { NextRequest, NextResponse } from "next/server";

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
    // Share one provider response across all users, but keep manual leaderboard
    // refreshes close to Data Golf's live feed during tournament play.
    cacheSeconds: 60,
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

function teeTimeLabel(player: DataGolfFieldPlayer) {
  const teeTime = player.teetimes?.find((entry) => Number(entry.round_num) === 1);
  const match = String(teeTime?.teetime ?? "").match(/\b(\d{1,2}):(\d{2})$/);
  if (!match) return "Tee time pending";
  const hour = Number(match[1]);
  const minute = match[2];
  const displayHour = hour % 12 || 12;
  const period = hour >= 12 ? "PM" : "AM";
  const startingHole = Number(teeTime?.start_hole);
  return `Tee ${displayHour}:${minute} ${period}${startingHole > 1 ? ` (Hole ${startingHole})` : ""}`;
}

async function preTournamentLeaderboard(request: NextRequest, expectedEventName: string | null, source: string | undefined) {
  const field = await fetchDataGolf<{ event_name?: string; field?: DataGolfFieldPlayer[] }>(request, "field");
  const fieldMatches = !expectedEventName || eventNamesMatch(expectedEventName, field.data?.event_name);
  const rows = fieldMatches ? (field.data?.field ?? []).map((player) => {
    const name = formatDataGolfPlayerName(player.player_name);
    return { name, position: null, positionLabel: "", total: null, thru: teeTimeLabel(player) };
  }).filter((row) => row.name).sort((a, b) => a.name.localeCompare(b.name)) : [];
  return cachedJson({
    ok: true,
    eventName: expectedEventName ?? field.data?.event_name,
    leaderboard: Object.fromEntries(rows.map((row) => [row.name, null])),
    totals: Object.fromEntries(rows.map((row) => [row.name, `||${row.thru}`])),
    rows,
    finalized: false,
    notStarted: true,
    source: field.source ?? source,
  }, ENDPOINTS.field.cacheSeconds);
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

function thruLabel(row: DataGolfPredictionPlayer) {
  const thru = Number(row.thru);
  const endHole = Number(row.end_hole);
  if (Number.isFinite(thru) && Number.isFinite(endHole) && thru >= endHole) return "F";
  if (Number.isFinite(thru) && thru > 0) return `Thru ${thru}`;
  return null;
}

function predictionStatus(row: DataGolfPredictionPlayer) {
  return [row.current_pos, row.current_score]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .find((value) => value === "CUT" || value === "WD" || value === "DQ") ?? null;
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
  const events = (raw.data?.schedule ?? [])
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
  const raw = await fetchDataGolf<{ event_id?: number | string; event_name?: string; field?: DataGolfFieldPlayer[]; last_updated?: string }>(request, "field");
  const currentEventId = String(raw.data?.event_id ?? "");

  if (eventId && currentEventId && eventId !== currentEventId) {
    return NextResponse.json({
      ok: false,
      error: `Data Golf field updates are currently for ${raw.data?.event_name ?? "the active event"} only.`,
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
  const raw = await fetchDataGolf<{ data?: DataGolfPredictionPlayer[]; info?: { event_name?: string; current_round?: number | string; last_update?: string } }>(request, "live-predictions");
  const expectedEventName = request.nextUrl.searchParams.get("eventName");
  if (expectedEventName && !eventNamesMatch(expectedEventName, raw.data?.info?.event_name)) {
    return preTournamentLeaderboard(request, expectedEventName, raw.source);
  }
  // Data Golf exposes projected positions and even-par scores before the first
  // tee time. They are not live results and missing players would appear as WD.
  if (!(raw.data?.data ?? []).some(predictionHasStarted)) {
    return preTournamentLeaderboard(request, expectedEventName ?? raw.data?.info?.event_name ?? null, raw.source);
  }
  const leaderboard: Record<string, number | null> = {};
  const totals: Record<string, string | null> = {};
  const rows = (raw.data?.data ?? []).map((row) => {
    const name = formatDataGolfPlayerName(row.player_name);
    const status = predictionStatus(row);
    const position = status ? null : positionNumber(row.current_pos);
    const total = status ?? scoreLabel(row.current_score);
    const thru = status ?? thruLabel(row);
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
  const finalized = Number.isFinite(round)
    && round >= 4
    && rows.length > 0
    && rows.every((row) => ["F", "CUT", "WD", "DQ"].includes(String(row.thru ?? "").toUpperCase()));

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

export async function GET(request: NextRequest) {
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
