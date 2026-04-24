import { NextRequest, NextResponse } from "next/server";

type EspnCompetitor = {
  athlete?: {
    displayName?: string;
    fullName?: string;
  };
  team?: {
    displayName?: string;
    name?: string;
    shortDisplayName?: string;
  };
  score?: string | null;
  linescores?: Array<{
    displayValue?: string | null;
    value?: number | null;
    linescores?: Array<{
      displayValue?: string | null;
      value?: number | null;
      period?: number | null;
    }>;
    statistics?: {
      categories?: Array<{
        stats?: Array<{
          displayValue?: string | null;
          value?: number | null;
        }>;
      }>;
    };
  }>;
};

type EventOption = {
  id: string;
  name: string;
};

function decodeHtmlText(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\./g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function competitorName(competitor: EspnCompetitor) {
  return competitor.athlete?.displayName
    ?? competitor.athlete?.fullName
    ?? competitor.team?.displayName
    ?? competitor.team?.name
    ?? competitor.team?.shortDisplayName
    ?? "";
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

function extractPlayerFieldFromLeaderboardHtml(html: string) {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");
  const fieldStart = text.indexOf("Tournament Field");
  const glossaryStart = text.indexOf("Glossary", fieldStart);
  const fieldText = fieldStart >= 0 ? text.slice(fieldStart, glossaryStart > fieldStart ? glossaryStart : undefined) : text;
  const seen = new Set<string>();
  const players: string[] = [];

  for (const rawLine of fieldText.split("\n")) {
    const line = decodeHtmlText(rawLine)
      .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\*?\b/gi, " ")
      .replace(/\bTEAM\b|\bTEE TIME\b|\bAuto Update:On\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line.includes("/")) continue;

    const team = line
      .replace(/\*+/g, "")
      .split(/\s*\/\s*/)
      .map((player) => player.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" / ");
    const key = normalizeName(team);
    if (!team || seen.has(key)) continue;
    seen.add(key);
    players.push(team);
  }

  return players.sort((a, b) => a.localeCompare(b));
}

function displayGolfScore(raw: string | null | undefined) {
  if (raw == null) return null;
  const text = String(raw).trim().toUpperCase();
  if (!text || text === "-") return null;
  if (text === "EVEN") return "E";
  return text;
}

function teeTimeFromRound(round: NonNullable<EspnCompetitor["linescores"]>[number]) {
  const raw = round.statistics?.categories?.[0]?.stats?.[6]?.displayValue?.trim();
  if (!raw) return null;

  const match = raw.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;

  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  const meridiem = hour >= 12 ? "PM" : "AM";

  return `${normalizedHour}:${minute} ${meridiem} CT`;
}

function competitorThru(competitor: EspnCompetitor) {
  const rounds = Array.isArray(competitor.linescores) ? competitor.linescores : [];
  const activeRound = rounds.find((round) => Array.isArray(round?.linescores) && round.linescores.length > 0 && round.linescores.length < 18);
  if (activeRound?.linescores?.length) {
    return `Thru ${activeRound.linescores.length}`;
  }

  const upcomingRound = rounds.find((round) => !round?.linescores?.length && round?.displayValue === "-");
  const teeTime = upcomingRound ? teeTimeFromRound(upcomingRound) : null;
  if (teeTime) return teeTime;

  const completedRound = [...rounds].reverse().find((round) => Array.isArray(round?.linescores) && round.linescores.length >= 18);
  if (completedRound?.linescores?.length) return "F";

  return null;
}

function encodeTotalWithThru(total: string | null, thru: string | null) {
  if (!total && !thru) return null;
  return `${total ?? ""}||${thru ?? ""}`;
}

function buildLeaderboard(competitors: EspnCompetitor[]) {
  const rankedPlayers = competitors
    .map((competitor) => ({
      name: competitorName(competitor),
      score: fetchableScore(competitor),
      total: displayGolfScore(competitor.score) ?? displayGolfScore(competitor.linescores?.[0]?.displayValue ?? null),
      thru: competitorThru(competitor),
    }))
    .filter((entry) => entry.name.trim())
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      if (a.score !== b.score) return a.score - b.score;
      return a.name.localeCompare(b.name);
    });

  const leaderboard: Record<string, number | null> = {};
  const totals: Record<string, string | null> = {};
  let lastScore: number | null = null;
    let lastPosition = 0;
  
    rankedPlayers.forEach((entry, index) => {
      totals[normalizeName(entry.name)] = encodeTotalWithThru(entry.total, entry.thru);
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

  const teamRegex = /([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\s*(?:\/|&|and)\s*([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\s+\+(\d{3,6})/g;
  for (const match of normalized.matchAll(teamRegex)) {
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;

    for (const name of [match[1], match[2]]) {
      const playerName = name.replace(/\s+/g, " ").trim();
      const key = normalizeName(playerName);
      if (playerName && !odds.has(key)) odds.set(key, value);
    }
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

async function fetchLeaderboardHtmlForEvent(eventId: string) {
  const year = new Date().getFullYear();
  const urls = [
    `https://www.espn.com/golf/leaderboard/_/tournamentId/${eventId}/season/${year}`,
    `https://www.espn.com/golf/leaderboard/_/tournamentId/${eventId}/season/${year - 1}`,
    `https://www.espn.com/golf/leaderboard/_/tournamentId/${eventId}`,
  ];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      if (html.includes("Tournament Field") || html.includes("Leaderboard")) {
        return { html, url };
      }
    } catch {
      // Try the next ESPN URL shape. Tournament pages are not consistent year to year.
    }
  }

  return null;
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

    const scoreboardPlayers = extractPlayerField(competitors);

    if (action === "field" && eventId && (!competitors.length || !scoreboardPlayers.length)) {
      const page = await fetchLeaderboardHtmlForEvent(eventId);
      const players = page ? extractPlayerFieldFromLeaderboardHtml(page.html) : [];

      if (players.length) {
        return NextResponse.json({
          ok: true,
          eventName,
          players,
          source: page?.url,
        });
      }
    }

    if (!competitors.length) {
      return NextResponse.json({
        ok: false,
        error: "Could not load ESPN competitors for that event. ESPN may not publish the full field through its live feed until the tournament starts.",
      });
    }

    if (action === "field") {
      if (!scoreboardPlayers.length) {
        return NextResponse.json({
          ok: false,
          error: "ESPN has the event, but did not publish player names in the live feed yet.",
        });
      }

      return NextResponse.json({
        ok: true,
        eventName,
        players: scoreboardPlayers,
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
