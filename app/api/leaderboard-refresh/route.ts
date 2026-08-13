import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type DraftSessionForRefresh = {
  id: string;
  event_id: string | null;
  event_tour: string | null;
  event_season: number | null;
  event_name: string | null;
  status: string;
  current_positions: Record<string, number | null> | null;
  current_totals: Record<string, string | null> | null;
  updated_at: string | null;
};

type TournamentLeaderboardRow = {
  name: string;
  position: number | null;
  positionLabel: string;
  total: string | null;
  thru: string | null;
};

type EspnLeaderboardResponse = {
  ok: boolean;
  eventName?: string;
  leaderboard?: Record<string, number | null>;
  totals?: Record<string, string | null>;
  rows?: TournamentLeaderboardRow[];
  finalized?: boolean;
  notStarted?: boolean;
  error?: string;
};

const ACTIVE_REFRESH_STATUSES = ["draft_complete", "scored"];
const OFF_HOURS_REFRESH_MS = 60 * 60 * 1000;
const RECENT_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const CRON_SCHEDULE = "*/5 * * * *";

function isAuthorizedCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") return true;

  const authorization = request.headers.get("authorization") ?? "";
  if (secret && authorization === `Bearer ${secret}`) return true;

  const userAgent = request.headers.get("user-agent") ?? "";
  const schedule = request.headers.get("x-vercel-cron-schedule") ?? "";
  return userAgent.includes("vercel-cron/1.0") && schedule === CRON_SCHEDULE;
}

function storedThruFromTotal(value: string | null | undefined) {
  if (!value?.includes("||")) return null;
  const [, thru] = value.split("||");
  return thru?.trim() || null;
}

function isLiveThru(thru: string | null | undefined) {
  const normalized = String(thru ?? "").trim().toUpperCase();
  return /^THRU\s+\d+$/.test(normalized) || normalized.startsWith("PLAYOFF");
}

function rowsHavePlayersOnCourse(rows: TournamentLeaderboardRow[] | undefined) {
  return (rows ?? []).some((row) => isLiveThru(row.thru));
}

function totalsHavePlayersOnCourse(totals: Record<string, string | null> | null | undefined) {
  return Object.values(totals ?? {}).some((value) => isLiveThru(storedThruFromTotal(value)));
}

function totalsHavePendingTeeTimes(totals: Record<string, string | null> | null | undefined) {
  return Object.values(totals ?? {}).some((value) => String(storedThruFromTotal(value) ?? "").startsWith("Tee "));
}

function sessionNeedsHourlyRefresh(session: DraftSessionForRefresh, now: number) {
  const updatedAt = session.updated_at ? new Date(session.updated_at).getTime() : 0;
  const age = now - updatedAt;
  return Number.isFinite(updatedAt) && updatedAt > 0 && age >= OFF_HOURS_REFRESH_MS && age <= RECENT_SESSION_MS;
}

function sessionWasRecentlyActive(session: DraftSessionForRefresh, now: number) {
  const updatedAt = session.updated_at ? new Date(session.updated_at).getTime() : 0;
  return Number.isFinite(updatedAt) && updatedAt > 0 && now - updatedAt <= RECENT_SESSION_MS;
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

async function fetchLeaderboard(origin: string, session: DraftSessionForRefresh) {
  if (!session.event_id) throw new Error("Missing event id");
  const isDataGolfEvent = session.event_id.startsWith("dg:");
  const params = new URLSearchParams({
    action: isDataGolfEvent ? "app-leaderboard" : "leaderboard",
    eventId: session.event_id,
    season: String(session.event_season ?? new Date().getFullYear()),
  });
  if (session.event_tour) params.set("tour", session.event_tour);
  if (isDataGolfEvent && session.event_name) params.set("eventName", session.event_name);

  const route = isDataGolfEvent ? "data-golf" : "espn-golf";
  const response = await fetch(`${origin}/api/${route}?${params.toString()}`, { cache: "no-store" });
  const payload = (await response.json()) as EspnLeaderboardResponse;
  if (!payload.ok || !payload.leaderboard) {
    throw new Error(payload.error || "Leaderboard response did not include scoring data.");
  }
  return payload;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase server refresh configuration." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("draft_sessions")
    .select("id,event_id,event_tour,event_season,event_name,status,current_positions,current_totals,updated_at")
    .not("event_id", "is", null)
    .in("status", ACTIVE_REFRESH_STATUSES);

  if (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "Could not load sessions to refresh." }, { status: 500 });
  }

  const now = Date.now();
  const sessions = ((data ?? []) as DraftSessionForRefresh[]).filter((session) => {
    if (!sessionWasRecentlyActive(session, now)) return false;
    const hasSavedScores = Object.keys(session.current_positions ?? {}).length > 0;
    return !hasSavedScores
      || totalsHavePendingTeeTimes(session.current_totals)
      || totalsHavePlayersOnCourse(session.current_totals)
      || sessionNeedsHourlyRefresh(session, now);
  });

  const results = [];
  const leaderboardRequests = new Map<string, Promise<EspnLeaderboardResponse>>();
  for (const session of sessions) {
    const hadPlayersOnCourse = totalsHavePlayersOnCourse(session.current_totals);
    const needsHourlyRefresh = sessionNeedsHourlyRefresh(session, now);

    try {
      const requestKey = [session.event_id, session.event_tour, session.event_season, session.event_name].join("|");
      let leaderboardRequest = leaderboardRequests.get(requestKey);
      if (!leaderboardRequest) {
        leaderboardRequest = fetchLeaderboard(request.nextUrl.origin, session);
        leaderboardRequests.set(requestKey, leaderboardRequest);
      }
      const payload = await leaderboardRequest;
      if (session.event_name && !eventNamesMatch(session.event_name, payload.eventName)) {
        throw new Error(`Leaderboard event mismatch: expected ${session.event_name ?? "the selected event"}, received ${payload.eventName ?? "an unidentified event"}.`);
      }
      const hasPlayersOnCourse = rowsHavePlayersOnCourse(payload.rows);
      const hasNoSavedScores = Object.keys(session.current_positions ?? {}).length === 0;

      if (!hasPlayersOnCourse && !hadPlayersOnCourse && !needsHourlyRefresh && !hasNoSavedScores) {
        results.push({ sessionId: session.id, refreshed: false, reason: "throttled" });
        continue;
      }

      const { error: updateError } = await supabase
        .from("draft_sessions")
        .update({
          event_name: payload.eventName ?? session.event_name,
          current_positions: payload.leaderboard,
          current_totals: payload.totals ?? {},
          status: payload.finalized ? "finalized" : payload.notStarted ? "draft_complete" : "scored",
        })
        .eq("id", session.id);

      if (updateError) throw updateError;

      results.push({
        sessionId: session.id,
        refreshed: true,
        mode: hasPlayersOnCourse || hadPlayersOnCourse ? "active" : "hourly",
        playersOnCourse: hasPlayersOnCourse,
      });
    } catch (refreshError) {
      console.error(refreshError);
      results.push({
        sessionId: session.id,
        refreshed: false,
        error: refreshError instanceof Error ? refreshError.message : "Unknown refresh error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: (data ?? []).length,
    eligible: sessions.length,
    results,
  });
}
