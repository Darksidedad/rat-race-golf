import { NextRequest, NextResponse } from "next/server";

type EspnCompetitor = {
  athlete?: {
    displayName?: string;
    fullName?: string;
  };
  score?: string | null;
  linescores?: Array<{
    displayValue?: string | null;
    value?: number | null;
  }>;
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['â€™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGolfScore(raw: string | null | undefined) {
  if (raw == null) return null;

  const text = String(raw).trim().toUpperCase();
  if (!text || text === "-") return null;
  if (text === "E") return 0;
  if (text === "CUT" || text === "WD" || text === "DQ") return null;

  const match = text.match(/^([+-]?)(\d+)$/);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  return sign * Number(match[2]);
}

function fetchableScore(competitor: EspnCompetitor) {
  return (
    normalizeGolfScore(competitor.score) ??
    normalizeGolfScore(competitor.linescores?.[0]?.displayValue ?? null)
  );
}

function extractEvents(scoreboardJson: any) {
  const events = scoreboardJson?.events;
  if (!Array.isArray(events)) return [];

  return events
    .map((event: any) => ({
      id: String(event?.id ?? ""),
      name: String(event?.name ?? event?.shortName ?? "").trim(),
    }))
    .filter((event: any) => event.id && event.name);
}

function extractEventById(scoreboardJson: any, eventId: string | null) {
  const events = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
  if (!events.length) return null;
  if (!eventId) return events[0] ?? null;
  return events.find((event: any) => String(event?.id) === String(eventId)) ?? events[0] ?? null;
}

function extractCompetitors(scoreboardJson: any, eventId: string | null) {
  const event = extractEventById(scoreboardJson, eventId);
  const competitors = event?.competitions?.[0]?.competitors;
  return Array.isArray(competitors) ? competitors : [];
}

function extractPlayerField(competitors: EspnCompetitor[]) {
  return competitors
    .map((competitor) => competitor.athlete?.displayName ?? competitor.athlete?.fullName ?? "")
    .filter((name) => !!name.trim())
    .sort((a, b) => a.localeCompare(b));
}

function buildLeaderboard(competitors: EspnCompetitor[]) {
  const rankedPlayers = competitors
    .map((competitor) => ({
      name: competitor.athlete?.displayName ?? competitor.athlete?.fullName ?? "",
      score: fetchableScore(competitor),
    }))
    .filter((entry) => entry.name.trim());

  const leaderboard: Record<string, number | null> = {};
  let lastScore: number | null = null;
  let lastPosition = 0;

  rankedPlayers.forEach((entry, index) => {
    if (entry.score === null) {
      leaderboard[normalizeName(entry.name)] = null;
      return;
    }

    if (lastScore === null || entry.score !== lastScore) {
      lastPosition = index + 1;
      lastScore = entry.score;
    }

    leaderboard[normalizeName(entry.name)] = lastPosition;
  });

  return leaderboard;
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${url}`);
  }

  return res.json();
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const eventId = req.nextUrl.searchParams.get("eventId");

  try {
    const scoreboardUrl = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
    const scoreboardJson = await fetchJson(scoreboardUrl);

    if (action === "events") {
      return NextResponse.json({
        ok: true,
        events: extractEvents(scoreboardJson),
      });
    }

    const event = extractEventById(scoreboardJson, eventId);
    const competitors = extractCompetitors(scoreboardJson, eventId);
    const eventName = event?.name ?? undefined;

    if (!competitors.length) {
      return NextResponse.json({
        ok: false,
        error: "Could not load ESPN competitors for that event.",
      });
    }

    if (action === "field") {
      return NextResponse.json({
        ok: true,
        eventName,
        players: extractPlayerField(competitors),
        source: scoreboardUrl,
      });
    }

    if (action === "leaderboard") {
      return NextResponse.json({
        ok: true,
        eventName,
        leaderboard: buildLeaderboard(competitors),
        source: scoreboardUrl,
      });
    }

    return NextResponse.json({
      ok: false,
      error: "Missing or invalid action. Use ?action=events, field, or leaderboard",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      ok: false,
      error: "Could not connect to ESPN feed.",
    });
  }
}
