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

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") ?? "";
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
