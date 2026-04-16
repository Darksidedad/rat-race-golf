import { NextRequest, NextResponse } from "next/server";

type PlayerEntry = {
  name: string;
  position: number | null;
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePosition(raw: any): number | null {
  if (raw == null) return null;

  const text = String(raw).toUpperCase().trim();

  if (!text) return null;
  if (text === "CUT" || text === "WD" || text === "DQ") return null;

  const match = text.match(/(\d+)/);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function walkForPlayers(node: any, results: PlayerEntry[] = []): PlayerEntry[] {
  if (!node) return results;

  if (Array.isArray(node)) {
    for (const item of node) walkForPlayers(item, results);
    return results;
  }

  if (typeof node !== "object") return results;

  const possibleName =
    node?.athlete?.displayName ??
    node?.athlete?.fullName ??
    node?.player?.displayName ??
    node?.player?.fullName ??
    node?.displayName ??
    node?.fullName ??
    null;

  const possiblePosition =
    node?.status?.position?.displayName ??
    node?.status?.position ??
    node?.position?.displayName ??
    node?.position ??
    node?.pos ??
    node?.rank ??
    null;

  if (typeof possibleName === "string" && possibleName.trim()) {
    results.push({
      name: possibleName.trim(),
      position: parsePosition(possiblePosition),
    });
  }

  for (const value of Object.values(node)) {
    if (typeof value === "object" && value !== null) {
      walkForPlayers(value, results);
    }
  }

  return results;
}

function dedupePlayers(entries: PlayerEntry[]) {
  const map = new Map<string, PlayerEntry>();

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!map.has(key)) {
      map.set(key, entry);
      continue;
    }

    const existing = map.get(key)!;
    if (existing.position == null && entry.position != null) {
      map.set(key, entry);
    }
  }

  return Array.from(map.values());
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

function extractEventNameById(scoreboardJson: any, eventId: string | null) {
  const events = scoreboardJson?.events;
  if (!Array.isArray(events)) return null;
  if (!eventId) return events[0]?.name ?? null;

  const match = events.find((e: any) => String(e?.id) === String(eventId));
  return match?.name ?? null;
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const eventId = req.nextUrl.searchParams.get("eventId");

  try {
    const scoreboardUrl =
      "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
    const scoreboardJson = await fetchJson(scoreboardUrl);

    if (action === "events") {
      return NextResponse.json({
        ok: true,
        events: extractEvents(scoreboardJson),
      });
    }

    const chosenEventId =
      eventId ||
      (Array.isArray(scoreboardJson?.events) && scoreboardJson.events[0]?.id
        ? String(scoreboardJson.events[0].id)
        : null);

    const eventName = extractEventNameById(scoreboardJson, chosenEventId) ?? undefined;

    const candidateUrls = [
      chosenEventId
        ? `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event=${chosenEventId}`
        : null,
      chosenEventId
        ? `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=${chosenEventId}`
        : null,
      "https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard",
    ].filter(Boolean) as string[];

    let leaderboardJson: any = null;
    let usedUrl = "";

    for (const url of candidateUrls) {
      try {
        leaderboardJson = await fetchJson(url);
        usedUrl = url;
        break;
      } catch {
        // try next
      }
    }

    if (!leaderboardJson) {
      return NextResponse.json({
        ok: false,
        error: "Could not load ESPN leaderboard feed.",
      });
    }

    const rawPlayers = dedupePlayers(walkForPlayers(leaderboardJson));

    if (action === "field") {
      const names = rawPlayers
        .map((p) => p.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      return NextResponse.json({
        ok: true,
        eventName,
        players: names,
        source: usedUrl,
      });
    }

    if (action === "leaderboard") {
      const leaderboard: Record<string, number | null> = {};

      for (const player of rawPlayers) {
        leaderboard[normalizeName(player.name)] = player.position;
      }

      return NextResponse.json({
        ok: true,
        eventName,
        leaderboard,
        source: usedUrl,
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