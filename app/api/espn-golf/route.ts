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
  dateLabel?: string;
  location?: string;
  course?: string;
};

const TOUR_ENDPOINTS: Record<string, { label: string; slug: string; scheduleSlug: string }> = {
  pga: { label: "PGA TOUR", slug: "pga", scheduleSlug: "pga" },
  lpga: { label: "LPGA Tour", slug: "lpga", scheduleSlug: "lpga" },
  ntw: { label: "Korn Ferry Tour", slug: "ntw", scheduleSlug: "ntw" },
  eur: { label: "DP World Tour", slug: "eur", scheduleSlug: "eur" },
  champions: { label: "PGA TOUR Champions", slug: "champions-tour", scheduleSlug: "champions-tour" },
  liv: { label: "LIV Golf", slug: "liv", scheduleSlug: "liv" },
};

const US_OPEN_2026_EVENT_ID = "401811952";
const TRAVELERS_2026_EVENT_ID = "401811953";
const US_OPEN_2026_FIELD = [
  "Aaron Rai",
  "Adam Scott",
  "Adrien Dumont de Chassart",
  "Adrien Saddier",
  "Akshay Bhatia",
  "Alejandro Tosti",
  "Alex Fitzpatrick",
  "Alex Noren",
  "Alex Smalley",
  "Andrew Novak",
  "Andrew Putnam",
  "Angel Hidalgo",
  "Arni Sveinsson",
  "Ben Griffin",
  "Ben James",
  "Ben Kohles",
  "Ben Silverman",
  "Billy Horschel",
  "Brandon Holtz",
  "Brandon Wu",
  "Brian Harman",
  "Brooks Koepka",
  "Bryan Lee",
  "Bryson DeChambeau",
  "Bud Cauley",
  "Caleb Surratt",
  "Cameron Smith",
  "Cameron Young",
  "Carl Yuan",
  "Carlos Ortiz",
  "Chandler Phillips",
  "Chase Kyes",
  "Chris Gotterup",
  "Chris Kirk",
  "Cole Hammer",
  "Collin Morikawa",
  "Cooper Dossey",
  "Corey Conners",
  "Daniel Berger",
  "David Puig",
  "Davis Thompson",
  "Dustin Johnson",
  "Dylan Wu",
  "Emiliano Grillo",
  "Eric Lee",
  "Ethan Fang",
  "Filippo Celli",
  "Gary Woodland",
  "Giuseppe Puebla",
  "Graeme McDowell",
  "Greyson Leach",
  "Hamilton Coleman",
  "Harris English",
  "Harry Hall",
  "Harry Higgs",
  "Hennie du Plessis",
  "Hideki Matsuyama",
  "J.B. Holmes",
  "J.J. Spaun",
  "J.T. Poston",
  "Jack Schoenberger",
  "Jackson Herrington",
  "Jackson Koivun",
  "Jackson Ormond",
  "Jackson Suber",
  "Jackson Van Paris",
  "Jacob Bridgeman",
  "Jake Knapp",
  "Jake Peacock",
  "Jake Sollon",
  "James Nicholas",
  "Jason Day",
  "Jayden Schaper",
  "Jimmy Stanger",
  "Joaquin Niemann",
  "John Parry",
  "Johnny Keefer",
  "Jon Rahm",
  "Jordan Spieth",
  "Justin Rose",
  "Justin Thomas",
  "Kaito Onishi",
  "Keegan Bradley",
  "Keith Mitchell",
  "Kevin Roy",
  "Kristoffer Reitan",
  "Kurt Kitayama",
  "Laurie Canter",
  "Logan Reilly",
  "Lucas Herbert",
  "Ludvig Åberg",
  "Manav Shah",
  "Marcelo Rozo",
  "Marek Fleming",
  "Mason Howell",
  "Mateo Pulcini",
  "Matt Fitzpatrick",
  "Matt McCarty",
  "Matthew Jordan",
  "Matthew Robles",
  "Matti Schmid",
  "Maverick McNealy",
  "Max Greyserman",
  "Max McGreevy",
  "Michael Brennan",
  "Michael Kim",
  "Miles Russell",
  "Min Woo Lee",
  "Nathan Kimsey",
  "Neal Shipley",
  "Nick Hardy",
  "Nick Taylor",
  "Nicolai Højgaard",
  "Nicolas Echavarria",
  "Niklas Norgaard",
  "Padraig Harrington",
  "Patrick Cantlay",
  "Patrick Reed",
  "Patrick Rodgers",
  "Peter Uihlein",
  "Pierceson Coody",
  "Preston Stout",
  "Rickie Fowler",
  "Robbie Higgins",
  "Robert MacIntyre",
  "Rocco Repetto Taylor",
  "Rory McIlroy",
  "Russell Henley",
  "Ryan Fox",
  "Ryan Gerard",
  "Ryder Cowan",
  "Ryo Hisatsune",
  "Ryuichi Oiwa",
  "Sahith Theegala",
  "Sam Burns",
  "Sam Stevens",
  "Scottie Scheffler",
  "Sepp Straka",
  "Shane Lowry",
  "Si Woo Kim",
  "Spencer Tibbits",
  "Sudarshan Yellamaraju",
  "Sungjae Im",
  "T.K. Kim",
  "Taihei Sato",
  "Taylor Montgomery",
  "Tom Kim",
  "Tommy Fleetwood",
  "Tyrrell Hatton",
  "Ugo Coussaud",
  "Vaughn Harber",
  "Viktor Hovland",
  "William Mouw",
  "Wyndham Clark",
  "Xander Schauffele",
  "Zac Blair",
];

const TRAVELERS_2026_FIELD = [
  "Aaron Rai",
  "Adam Scott",
  "Akshay Bhatia",
  "Alex Fitzpatrick",
  "Alex Noren",
  "Alex Smalley",
  "Andrew Novak",
  "Ben Griffin",
  "Ben James",
  "Brandt Snedeker",
  "Brian Campbell",
  "Brian Harman",
  "Bud Cauley",
  "Cameron Young",
  "Chris Gotterup",
  "Collin Morikawa",
  "Corey Conners",
  "Daniel Berger",
  "Denny McCarthy",
  "Eric Cole",
  "Gary Woodland",
  "Harris English",
  "Harry Hall",
  "Hideki Matsuyama",
  "J.J. Spaun",
  "J.T. Poston",
  "Jackson Suber",
  "Jacob Bridgeman",
  "Jake Knapp",
  "Jason Day",
  "Jhonattan Vegas",
  "Jordan Spieth",
  "Justin Rose",
  "Justin Thomas",
  "Keegan Bradley",
  "Kristoffer Reitan",
  "Kurt Kitayama",
  "Lucas Glover",
  "Ludvig Aberg",
  "Mac Meissner",
  "Mark Hubbard",
  "Matt Fitzpatrick",
  "Matt McCarthy",
  "Maverick McNealy",
  "Michael Kim",
  "Min Woo Lee",
  "Nico Echavarria",
  "Nicolai Hojgaard",
  "Nick Taylor",
  "Patrick Cantlay",
  "Rickie Fowler",
  "Robert MacIntyre",
  "Russell Henley",
  "Ryan Fox",
  "Ryan Gerard",
  "Ryo Hisatsune",
  "Sahith Theegala",
  "Sam Burns",
  "Sam Stevens",
  "Scottie Scheffler",
  "Sepp Straka",
  "Shane Lowry",
  "Si Woo Kim",
  "Sungjae Im",
  "Taylor Pendrith",
  "Tom Hoge",
  "Tommy Fleetwood",
  "Tony Finau",
  "Viktor Hovland",
  "Wyndham Clark",
  "Xander Schauffele",
];

function resolveTour(rawTour: string | null) {
  return TOUR_ENDPOINTS[String(rawTour ?? "pga").toLowerCase()] ?? TOUR_ENDPOINTS.pga;
}

function tourSearchOrder(rawTour: string | null) {
  const selected = TOUR_ENDPOINTS[String(rawTour ?? "").toLowerCase()];
  const tours = Object.values(TOUR_ENDPOINTS);
  return selected ? [selected, ...tours.filter((tour) => tour.slug !== selected.slug)] : tours;
}

function decodeHtmlText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHtmlText(html: string) {
  return decodeHtmlText(html.replace(/<[^>]+>/g, " "));
}

function formatEventDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return undefined;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return undefined;

  const endDate = end ? new Date(end) : null;
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
  const startMonth = month.format(startDate);
  const startDay = day.format(startDate);

  if (!endDate || Number.isNaN(endDate.getTime())) return `${startMonth} ${startDay}`;

  const endMonth = month.format(endDate);
  const endDay = day.format(endDate);
  return startMonth === endMonth ? `${startMonth} ${startDay} - ${endDay}` : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

function splitCourseAndLocation(rawLocation: string | undefined) {
  if (!rawLocation) return {};
  const [course, ...rest] = rawLocation.split(/\s+-\s+/);
  const cleanedCourse = course?.trim();
  const location = rest.join(" - ").trim();
  return {
    course: cleanedCourse || undefined,
    location: location || rawLocation,
  };
}

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
      dateLabel: formatEventDateRange(event?.date, event?.endDate),
    }))
    .filter((event: EventOption) => event.id && event.name);
}

function extractEventsFromScheduleHtml(html: string) {
  const matches = [...html.matchAll(/<tr[^>]*>([\s\S]*?leaderboard\?tournamentId=(\d+)[\s\S]*?)<\/tr>/g)];
  const deduped = new Map<string, EventOption>();

  for (const match of matches) {
    const rowHtml = match[1] ?? "";
    const id = match[2]?.trim();
    const name = cleanHtmlText(rowHtml.match(/eventAndLocation__tournamentLink[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
    const dateLabel = cleanHtmlText(rowHtml.match(/dateAndTickets__col[\s\S]*?<div[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "") || undefined;
    const rawLocation = cleanHtmlText(rowHtml.match(/eventAndLocation__tournamentLocation[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "") || undefined;
    const { course, location } = splitCourseAndLocation(rawLocation);
    if (!id || !name || deduped.has(id)) continue;
    deduped.set(id, { id, name, dateLabel, course, location });
  }

  return Array.from(deduped.values());
}

function mergeEvents(...collections: EventOption[][]) {
  const merged = new Map<string, EventOption>();

  for (const collection of collections) {
    for (const event of collection) {
      const existing = merged.get(event.id);
      merged.set(event.id, existing ? {
        ...existing,
        name: existing.name || event.name,
        dateLabel: existing.dateLabel ?? event.dateLabel,
        course: existing.course ?? event.course,
        location: existing.location ?? event.location,
      } : event);
    }
  }

  return Array.from(merged.values());
}

function extractEventById(scoreboardJson: any, eventId: string | null) {
  const events = Array.isArray(scoreboardJson?.events) ? scoreboardJson.events : [];
  if (!events.length) return null;
  if (!eventId) return events[0] ?? null;
  return events.find((event: any) => String(event?.id) === String(eventId)) ?? null;
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

  // ESPN's golf feed has been returning Zurich tee-time strings with the correct
  // Eastern clock time but an incorrect timezone suffix, so we normalize by
  // treating the raw clock as ET and converting one hour back to CT.
  const centralHour = (hour + 23) % 24;
  const normalizedHour = centralHour % 12 === 0 ? 12 : centralHour % 12;
  const meridiem = centralHour >= 12 ? "PM" : "AM";

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

function completedRoundCount(competitor: EspnCompetitor) {
  const rounds = Array.isArray(competitor.linescores) ? competitor.linescores : [];
  return rounds.filter((round) => Array.isArray(round?.linescores) && round.linescores.length >= 18).length;
}

function hasActiveRound(competitor: EspnCompetitor) {
  const rounds = Array.isArray(competitor.linescores) ? competitor.linescores : [];
  return rounds.some((round) => Array.isArray(round?.linescores) && round.linescores.length > 0 && round.linescores.length < 18);
}

function eventIsCompleted(event: any) {
  return Boolean(event?.status?.type?.completed ?? event?.competitions?.[0]?.status?.type?.completed);
}

function nonScoringStatus(competitor: EspnCompetitor, maxCompletedRounds: number, eventCompleted: boolean) {
  const scoreText = displayGolfScore(competitor.score);
  if (scoreText === "CUT" || scoreText === "WD" || scoreText === "DQ") return scoreText;

  const completedRounds = completedRoundCount(competitor);
  if (eventCompleted && maxCompletedRounds > 0 && completedRounds < maxCompletedRounds) {
    return completedRounds >= 2 ? "CUT" : "WD";
  }

  if (maxCompletedRounds > 2 && completedRounds >= 2 && completedRounds < maxCompletedRounds && !hasActiveRound(competitor)) {
    return "CUT";
  }

  return null;
}

function encodeTotalWithThru(total: string | null, thru: string | null, meta: string | null = null) {
  if (!total && !thru && !meta) return null;
  return `${total ?? ""}||${thru ?? ""}||${meta ?? ""}`;
}

function shouldAutoFinalize(event: any, competitors: EspnCompetitor[], positions: Record<string, number | null>) {
  const eventCompleted = eventIsCompleted(event);
  if (!eventCompleted) return false;

  const allCompetitorsClosed = competitors.every((competitor) => {
    const thru = competitorThru(competitor);
    return thru === "F" || thru === null;
  });
  if (!allCompetitorsClosed) return false;

  const firstPlaceCount = Object.values(positions).filter((position) => position === 1).length;
  return firstPlaceCount === 1;
}

function buildLeaderboard(competitors: EspnCompetitor[], eventCompleted = false) {
  const maxCompletedRounds = Math.max(0, ...competitors.map((competitor) => completedRoundCount(competitor)));
  const rankedPlayers = competitors
    .map((competitor, sourceIndex) => {
      const status = nonScoringStatus(competitor, maxCompletedRounds, eventCompleted);
      return {
        name: competitorName(competitor),
        score: status ? null : fetchableScore(competitor),
        total: status ?? displayGolfScore(competitor.score) ?? displayGolfScore(competitor.linescores?.[0]?.displayValue ?? null),
        thru: status ?? competitorThru(competitor),
        completedRounds: completedRoundCount(competitor),
        sourceIndex,
      };
    })
    .filter((entry) => entry.name.trim())
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      if (a.score !== b.score) return a.score - b.score;
      return a.sourceIndex - b.sourceIndex;
    });

  const leaderboard: Record<string, number | null> = {};
  const totals: Record<string, string | null> = {};
  const tiedLeaders = rankedPlayers.filter((entry) => entry.score !== null && entry.score === rankedPlayers[0]?.score);
  const hasFinalRoundPlayoff =
    tiedLeaders.length > 1 &&
    tiedLeaders.every((entry) => entry.completedRounds >= 4) &&
    tiedLeaders.some((entry) => entry.thru && entry.thru !== "F");
  const playoffPlayers = hasFinalRoundPlayoff ? tiedLeaders.filter((entry) => entry.thru && entry.thru !== "F") : [];
  const playoffPlayerCount = playoffPlayers.length > 1 ? playoffPlayers.length : 0;
  let lastScore: number | null = null;
  let lastPosition = 0;

  rankedPlayers.forEach((entry, index) => {
    const playoffIndex = playoffPlayers.findIndex((player) => normalizeName(player.name) === normalizeName(entry.name));
    const playoffMeta = playoffPlayerCount && playoffIndex >= 0 ? `PLAYOFF:${playoffIndex + 1}:${playoffPlayerCount}` : null;
    totals[normalizeName(entry.name)] = encodeTotalWithThru(entry.total, entry.thru, playoffMeta);
    if (entry.score === null) {
      leaderboard[normalizeName(entry.name)] = null;
      return;
    }

    if (playoffIndex > 0) {
      leaderboard[normalizeName(entry.name)] = playoffIndex + 1;
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
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ");

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

  const fractionalRegex = /([A-Z][A-Za-z.'â€™\-]+(?:\s+[A-Z][A-Za-z.'â€™\-]+){1,3})\s+(\d{1,3})\/1/g;
  for (const match of normalized.matchAll(fractionalRegex)) {
    const playerName = match[1].replace(/\s+/g, " ").trim();
    const value = Number(match[2]) * 100;
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

function extractPlayersFromUsgaJson(payload: any) {
  const cards = payload?.data?.flatMap((entry: any) => entry?.resultset?.cards ?? []) ?? [];
  const seen = new Set<string>();
  const players: string[] = [];

  for (const card of cards) {
    const fullName = String(card?.fullName ?? [card?.firstName, card?.lastName].filter(Boolean).join(" ")).replace(/\s+/g, " ").trim();
    const key = normalizeName(fullName);
    if (!fullName || seen.has(key)) continue;
    seen.add(key);
    players.push(fullName);
  }

  return players.sort((a, b) => a.localeCompare(b));
}

function extractPlayersFromListAfterHeading(html: string, headingPattern: RegExp) {
  const headingMatch = headingPattern.exec(html);
  if (headingMatch?.index == null) return [];

  const afterHeading = html.slice(headingMatch.index);
  const listMatch = afterHeading.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
  if (!listMatch) return [];

  const seen = new Set<string>();
  const players: string[] = [];
  for (const match of listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const player = cleanHtmlText(match[1]).replace(/\s+/g, " ").trim();
    const key = normalizeName(player);
    if (!player || seen.has(key)) continue;
    seen.add(key);
    players.push(player);
  }

  return players.sort((a, b) => a.localeCompare(b));
}

async function fetchUsgaFieldForEvent(eventName: string | undefined, eventId: string | null) {
  const isUsOpen = Boolean(eventName && /\bu\.?s\.?\s+open\b/i.test(eventName)) || eventId === US_OPEN_2026_EVENT_ID;
  if (!isUsOpen) return null;

  const year = new Date().getFullYear();
  const urls = [
    `https://www.usopen.com/content/api/players.resource=@@content@@usopen@@${year}@@players@@_jcr_content@@root@@all_player.year=${year}.json`,
    "https://www.usopen.com/content/api/players.view=players.championship=uso.json",
  ];

  for (const url of urls) {
    try {
      const payload = await fetchJson(url);
      const players = extractPlayersFromUsgaJson(payload);
      if (players.length) return { players, source: url };
    } catch {
      // USGA exposes a couple of API shapes depending on championship state.
    }
  }

  if (eventId === US_OPEN_2026_EVENT_ID) {
    return {
      players: US_OPEN_2026_FIELD,
      source: "USGA 2026 U.S. Open published field snapshot",
    };
  }

  return null;
}

async function fetchTravelersFieldForEvent(eventName: string | undefined, eventId: string | null) {
  const isTravelers = eventId === TRAVELERS_2026_EVENT_ID || Boolean(eventName && /\btravelers\s+championship\b/i.test(eventName));
  if (!isTravelers) return null;

  const url = "https://www.ctinsider.com/sports/article/travelers-championship-golf-2026-field-players-22312841.php";
  try {
    const html = await fetchText(url);
    const players = extractPlayersFromListAfterHeading(html, /<h2[^>]*>\s*2026\s+Travelers\s+Championship\s+field\s*<\/h2>/i);
    if (players.length) return { players, source: url };
  } catch {
    // CT Insider published the pre-tournament field before ESPN exposed competitors.
  }

  if (eventId === TRAVELERS_2026_EVENT_ID) {
    return {
      players: TRAVELERS_2026_FIELD,
      source: "CT Insider 2026 Travelers Championship published field snapshot",
    };
  }

  return null;
}

async function fetchScheduledEvent(eventId: string | null, tour: { scheduleSlug: string }) {
  if (!eventId) return null;

  const scheduleHtml = await fetchText(`https://www.espn.com/golf/schedule/_/tour/${tour.scheduleSlug}`);
  return extractEventsFromScheduleHtml(scheduleHtml).find((event) => event.id === eventId) ?? null;
}

async function findOddsArticle(eventName: string) {
  const year = new Date().getFullYear();
  const eventSlug = eventName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const directCandidates = [
    `https://www.cbssports.com/golf/news/${year}-${eventSlug}-odds-picks-predictions-field-favorites-contenders/`,
    `https://www.cbssports.com/golf/news/${year}-${eventSlug}-odds-field-picks-predictions-favorites-contenders/`,
  ];

  for (const url of directCandidates) {
    try {
      const html = await fetchText(url);
      if (parseOddsFromArticle(html).size) return url;
    } catch {
      // Fall back to search discovery.
    }
  }

  const query = encodeURIComponent(`${year} "${eventName}" golf betting odds field favorites`);
  const searchHtml = await fetchText(`https://html.duckduckgo.com/html/?q=${query}`);
  const sourceDomains = [
    "cbssports.com/golf/news/",
    "nypost.com/",
    "golfmonthly.com/",
    "rotowire.com/golf/",
    "covers.com/sport/golf/",
    "actionnetwork.com/golf/",
    "golfdigest.com/",
  ];
  const urls = [...searchHtml.matchAll(/uddg=([^&"]+)/g)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((url) => sourceDomains.some((domain) => url.includes(domain)));

  return urls[0] ?? null;
}

async function fetchScoreboardForEvent(eventId: string | null, rawTour: string | null) {
  for (const tour of tourSearchOrder(rawTour)) {
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/golf/${tour.slug}/scoreboard`;
    const scoreboardJson = await fetchJson(scoreboardUrl);
    const event = extractEventById(scoreboardJson, eventId);
    const competitors = extractCompetitors(scoreboardJson, eventId);
    if (!eventId || event || competitors.length) {
      return { tour, scoreboardJson, scoreboardUrl, event, competitors };
    }
  }

  const tour = resolveTour(rawTour);
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/golf/${tour.slug}/scoreboard`;
  const scoreboardJson = await fetchJson(scoreboardUrl);
  return {
    tour,
    scoreboardJson,
    scoreboardUrl,
    event: extractEventById(scoreboardJson, eventId),
    competitors: extractCompetitors(scoreboardJson, eventId),
  };
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const eventId = req.nextUrl.searchParams.get("eventId");
  const eventNameParam = req.nextUrl.searchParams.get("eventName");

  try {
    if (action === "events") {
      const tour = resolveTour(req.nextUrl.searchParams.get("tour"));
      const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/golf/${tour.slug}/scoreboard`;
      const scoreboardJson = await fetchJson(scoreboardUrl);
      const scheduleHtml = await fetchText(`https://www.espn.com/golf/schedule/_/tour/${tour.scheduleSlug}`);
      const events = mergeEvents(extractEventsFromScoreboard(scoreboardJson), extractEventsFromScheduleHtml(scheduleHtml));
      return NextResponse.json({
        ok: true,
        tour: tour.label,
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

      const articleUrl = await findOddsArticle(eventNameParam.trim());
      if (!articleUrl) {
        return NextResponse.json({
          ok: false,
          error: "Could not find a betting odds article for that event.",
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

    const { scoreboardUrl, event, competitors, tour } = await fetchScoreboardForEvent(eventId, req.nextUrl.searchParams.get("tour"));
    let eventName = event?.name ?? undefined;
    if (action === "field" && eventId && !eventName) {
      try {
        eventName = (await fetchScheduledEvent(eventId, tour))?.name ?? undefined;
      } catch {
        // Schedule lookup is best effort; the ESPN live feed may still be enough.
      }
    }

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

      const usgaField = await fetchUsgaFieldForEvent(eventName, eventId);
      if (usgaField?.players.length) {
        return NextResponse.json({
          ok: true,
          eventName,
          players: usgaField.players,
          source: usgaField.source,
        });
      }

      const travelersField = await fetchTravelersFieldForEvent(eventName, eventId);
      if (travelersField?.players.length) {
        return NextResponse.json({
          ok: true,
          eventName,
          players: travelersField.players,
          source: travelersField.source,
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
        const liveLeaderboard = buildLeaderboard(competitors, eventIsCompleted(event));
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

