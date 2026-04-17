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

type EventOption = {
  id: string;
  name: string;
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['’]/g, "")
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
  return normalizeGolfScore(competitor.score) ?? normalizeGolfScore(competitor.linescores?.[0]?.displayValue ?? null);
}

function extractEventsFromScoreboard(scoreboardJson: any) {
  const events = scoreboardJson?.events;
  if (!Array.isArray(events)) return [];

  return events
    .map((event: any) => ({
      id: String(event?.id ?? ""),
      name: String(event?.name ?? event?.shortName ?? "").trim(),
    }))
    .filter((event: EventOption) => event.id && event.name);
}

function extractEventsFromScheduleHtml(html: string) {
  const matches = [...html.matchAll(/leaderboard\?tournamentId=(\d+)[\s\S]{0,400}?eventAndLocation__tournamentLink">([^<]+)</g)];
  const deduped = new Map<string, EventOption>();

  for (const match of matches) {
    const id = match[1]?.trim();
    const name = match[2]?.trim();
    if (!id || !name || deduped.has(id)) continue;
    deduped.set(id, { id, name });
  }

  return Array.from(deduped.values());
}

function mergeEvents(...collections: EventOption[][]) {
  const merged = new Map<string, EventOption>();

  for (const collection of collections) {
    for (const event of collection) {
      if (!merged.has(event.id)) merged.set(event.id, event);
    }
  }

  return Array.from(merged.values());
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

function displayGolfScore(raw: string | null | undefined) {
  if (raw == null) return null;
  const text = String(raw).trim().toUpperCase();
  if (!text || text === "-") return null;
  if (text === "EVEN") return "E";
  return text;
}

function buildLeaderboard(competitors: EspnCompetitor[]) {
  const rankedPlayers = competitors
    .map((competitor) => ({
      name: competitor.athlete?.displayName ?? competitor.athlete?.fullName ?? "",
      score: fetchableScore(competitor),
      total: displayGolfScore(competitor.score) ?? displayGolfScore(competitor.linescores?.[0]?.displayValue ?? null),
    }))
    .filter((entry) => entry.name.trim());

  const leaderboard: Record<string, number | null> = {};
  const totals: Record<string, string | null> = {};
  let lastScore: number | null = null;
  let lastPosition = 0;

  rankedPlayers.forEach((entry, index) => {
    totals[normalizeName(entry.name)] = entry.total;
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

  return { positions: leaderboard, totals };
}

function parseOddsFromArticle(articleHtml: string) {
  const normalized = articleHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, "&");

  const odds = new Map<string, number>();
  const regex = /([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,3})\s+\+(\d{3,6})/g;

  for (const match of normalized.matchAll(regex)) {
    const playerName = match[1].replace(/\s+/g, " ").trim();
    const value = Number(match[2]);
    if (!playerName || !Number.isFinite(value)) continue;
    const key = normalizeName(playerName);
    if (!odds.has(key)) odds.set(key, value);
  }

  return odds;
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

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${url}`);
  }

  return res.text();
}

async function findCbsOddsArticle(eventName: string) {
  const year = new Date().getFullYear();
  const query = encodeURIComponent(`site:cbssports.com/golf/news ${year} ${eventName} odds picks field favorites`);
  const searchHtml = await fetchText(`https://html.duckduckgo.com/html/?q=${query}`);
  const urls = [...searchHtml.matchAll(/uddg=([^&"]+)/g)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((url) => url.includes("cbssports.com/golf/news/"));

  return urls[0] ?? null;
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const eventId = req.nextUrl.searchParams.get("eventId");
  const eventNameParam = req.nextUrl.searchParams.get("eventName");

  try {
    const scoreboardUrl = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
    const scoreboardJson = await fetchJson(scoreboardUrl);

    if (action === "events") {
      const scheduleHtml = await fetchText("https://www.espn.com/golf/schedule");
      const events = mergeEvents(extractEventsFromScoreboard(scoreboardJson), extractEventsFromScheduleHtml(scheduleHtml));
      return NextResponse.json({
        ok: true,
        events,
      });
    }

    if (action === "odds") {
      if (!eventNameParam?.trim()) {
        return NextResponse.json({
          ok: false,
          error: "Missing eventName for odds lookup.",
        });
      }

      const articleUrl = await findCbsOddsArticle(eventNameParam.trim());
      if (!articleUrl) {
        return NextResponse.json({
          ok: false,
          error: "Could not find a CBS Sports odds article for that event.",
        });
      }

      const articleHtml = await fetchText(articleUrl);
      const oddsEntries = parseOddsFromArticle(articleHtml);
      const odds = Object.fromEntries(oddsEntries.entries());

      return NextResponse.json({
        ok: true,
        eventName: eventNameParam.trim(),
        odds,
        source: articleUrl,
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
        const liveLeaderboard = buildLeaderboard(competitors);
        return NextResponse.json({
          ok: true,
          eventName,
          leaderboard: liveLeaderboard.positions,
          totals: liveLeaderboard.totals,
          source: scoreboardUrl,
        });
      }

    return NextResponse.json({
      ok: false,
      error: "Missing or invalid action. Use ?action=events, field, leaderboard, or odds",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({
      ok: false,
      error: "Could not connect to the live golf feed.",
    });
  }
}
