"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

type EventOption = { id: string; catalogId?: string | null; name: string; season: number; startDate?: string; dateLabel?: string; location?: string; course?: string };
type DraftSession = {
  id: string;
  league_id: string | null;
  event_tour: string | null;
  event_season: number | null;
  counts_for_season: boolean;
  name: string;
  event_id: string | null;
  tournament_id?: string | null;
  event_name: string | null;
  player_input: string;
  field_source?: string | null;
  field_refreshed_at?: string | null;
  odds_snapshot?: Record<string, number> | null;
  odds_source?: string | null;
  odds_refreshed_at?: string | null;
  field_locked_at?: string | null;
  manual_leaderboard_input: string | null;
  current_positions: Record<string, number | null> | null;
  current_totals: Record<string, string | null> | null;
  status: string;
  commissioner_id: string | null;
  created_at: string;
  updated_at: string;
};
type DraftTeam = { id: string; session_id: string; name: string; draft_slot: number | null; active: boolean; owner_user_id: string | null; created_at: string };
type Profile = { id: string; username: string; role: "commissioner" | "assistant_commissioner" | "member"; site_role: "site_admin" | "user"; active_league_id: string | null; created_at: string };
type DraftPick = { id: string; session_id: string; team_id: string; player_name: string; player_key: string; pick_number: number; round_number: number; created_at: string };
type League = { id: string; name: string; slug: string; created_by: string | null; created_at: string };
type LeagueMembership = { id: string; league_id: string; user_id: string; role: Profile["role"]; created_at: string };
type NewDraftTeam = { name: string; selected: boolean; ownerUserId: string | null };
type EventsResponse = { ok: boolean; events?: EventOption[]; error?: string };
type FieldResponse = { ok: boolean; eventName?: string; players?: string[]; odds?: Record<string, number>; oddsSource?: string; source?: string; error?: string };
type LeaderboardResponse = { ok: boolean; eventName?: string; leaderboard?: Record<string, number | null>; totals?: Record<string, string | null>; finalized?: boolean; error?: string };
type TournamentLeaderboardRow = { name: string; position: number | null; positionLabel: string; total: string | null; thru: string | null };
type TournamentLeaderboardResponse = LeaderboardResponse & { rows?: TournamentLeaderboardRow[] };

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
type OddsResponse = { ok: boolean; eventName?: string; odds?: Record<string, number>; source?: string; error?: string };
type SocialProvider = "google" | "facebook" | "apple";
type PlayerPoolEntry = { name: string; odds?: number };
type RoomTab = "setup" | "admin" | "draft" | "results" | "profile" | "season";
type SeasonStatsView = "league" | "all";
type SeasonStatSection = "standings" | "leaders" | "profiles";
type EditingPick = {
  id: string;
  teamName: string;
  playerName: string;
};
type SeasonTeamStat = {
  teamName: string;
  eventsPlayed: number;
  wins: number;
  top3: number;
  seasonPoints: number;
  bestFinish: number | null;
  lastTotal: number | null;
  totalToPar: number;
  toParScores: number;
  golferSelections: Record<string, { name: string; count: number; points: number }>;
  mostDraftedGolfer: string | null;
  mostDraftedCount: number;
  mostSuccessfulGolfer: string | null;
  mostSuccessfulGolferPoints: number;
  uniqueGolfers: number;
  cuts: number;
  completedGolferResults: number;
  bestEventPoints: number;
};

const ROUNDS = 4;
const SEASON_EVENT_TARGET = 10;
const SEASON_EXCLUDED_MARKER = "# RRG_SIDE_EVENT";
const EVENT_SEASON_MARKER_PREFIX = "# RRG_EVENT_SEASON:";
const CURRENT_GOLF_SEASON = new Date().getFullYear();
const HISTORICAL_SEASONS = Array.from({ length: 8 }, (_, index) => CURRENT_GOLF_SEASON - index);
const TOUR_OPTIONS = [
  { id: "pga", label: "PGA TOUR" },
  { id: "lpga", label: "LPGA Tour" },
  { id: "ntw", label: "Korn Ferry Tour" },
  { id: "eur", label: "DP World Tour" },
  { id: "champions", label: "PGA TOUR Champions" },
  { id: "liv", label: "LIV Golf" },
];
const LIVE_DATA_FETCH_OPTIONS: RequestInit = {};
const INVALID_PLAYER_TERMS = [
  "driving",
  "distance",
  "accuracy",
  "average",
  "leaderboard",
  "statistics",
  "stats",
  "position",
  "round",
  "score",
  "projected",
  "odds",
  "performance",
  "totals",
];

function normalizeName(name: string) {
  return name
    .replace(/\u00c3\u00b8/g, "o")
    .replace(/\u00c3\u0098/g, "o")
    .replace(/\u00c3\u00a6/g, "ae")
    .replace(/\u00c3\u0086/g, "ae")
    .replace(/\u00c3\u00a5/g, "a")
    .replace(/\u00c3\u0085/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[åÅ]/g, "a")
    .toLowerCase()
    .replace(/\s*[-–—]\s*(?:amateur|a)\b/g, "")
    .replace(/\s*\((?:amateur|a)\)\s*/g, " ")
    .replace(/\./g, "")
    .replace(/['\u2019]/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function formatOdds(odds: number | null | undefined) {
  if (!Number.isFinite(odds)) return null;
  return odds && odds > 0 ? `+${odds}` : String(odds);
}

function formatRefreshTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

async function readJsonResponse<T>(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function formatTournamentDate(value: string | null | undefined, season: number | null | undefined) {
  if (!value) return String(season ?? "");
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function isMissingColumnError(error: { message?: string; code?: string } | null | undefined, columnName: string) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST204" || (message.includes(columnName.toLowerCase()) && (message.includes("schema cache") || message.includes("column")));
}

function formatEventDropdownOption(event: EventOption) {
  return event.dateLabel ? `${event.name} (${event.dateLabel})` : event.name;
}

function preferredEventId(events: EventOption[]) {
  if (!events.length) return "";
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const eventsWithDates = events
    .map((event) => {
      const time = event.startDate ? new Date(event.startDate).getTime() : Number.NaN;
      return { event, time };
    })
    .filter((entry) => Number.isFinite(entry.time));

  const activeWindow = eventsWithDates
    .filter((entry) => entry.time <= todayUtc && todayUtc - entry.time <= 4 * 24 * 60 * 60 * 1000)
    .sort((a, b) => b.time - a.time)[0];
  if (activeWindow) return activeWindow.event.id;

  const nextUpcoming = eventsWithDates
    .filter((entry) => entry.time > todayUtc)
    .sort((a, b) => a.time - b.time)[0];
  if (nextUpcoming) return nextUpcoming.event.id;

  return eventsWithDates.sort((a, b) => b.time - a.time)[0]?.event.id ?? events[0]?.id ?? "";
}

function sessionCountsForSeason(session: DraftSession) {
  return session.counts_for_season !== false
    && !String(session.manual_leaderboard_input ?? "").split(/\r?\n/).some((line) => line.trim() === SEASON_EXCLUDED_MARKER);
}

function storedEventSeason(input: string | null | undefined) {
  const line = String(input ?? "").split(/\r?\n/).find((entry) => entry.trim().startsWith(EVENT_SEASON_MARKER_PREFIX));
  const season = Number(line?.trim().slice(EVENT_SEASON_MARKER_PREFIX.length));
  return Number.isInteger(season) && season >= 2000 ? season : null;
}

function sessionEventSeason(session: DraftSession) {
  return storedEventSeason(session.manual_leaderboard_input) ?? session.event_season ?? CURRENT_GOLF_SEASON;
}

function stripSessionMetadata(input: string | null | undefined) {
  return String(input ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== SEASON_EXCLUDED_MARKER && !line.trim().startsWith(EVENT_SEASON_MARKER_PREFIX))
    .join("\n")
    .trim();
}

function manualLeaderboardWithSeasonSetting(input: string | null | undefined, countsForSeason: boolean) {
  const eventSeason = storedEventSeason(input);
  const lines = stripSessionMetadata(input).split(/\r?\n/).filter(Boolean);
  if (eventSeason) lines.unshift(`${EVENT_SEASON_MARKER_PREFIX}${eventSeason}`);
  if (!countsForSeason) lines.unshift(SEASON_EXCLUDED_MARKER);
  return lines.join("\n").trim();
}

function manualLeaderboardWithEventSeason(input: string | null | undefined, season: number, countsForSeason: boolean) {
  const lines = stripSessionMetadata(input).split(/\r?\n/).filter(Boolean);
  lines.unshift(`${EVENT_SEASON_MARKER_PREFIX}${season}`);
  if (!countsForSeason) lines.unshift(SEASON_EXCLUDED_MARKER);
  return lines.join("\n").trim();
}

function formatPlayerPoolInputWithOdds(playerInput: string, odds: Record<string, number>) {
  return formatPlayerPoolInput(playerInput)
    .split("\n")
    .map((player) => {
      const oddsValue = lookupOddsForPlayer(player, odds);
      const oddsLabel = formatOdds(oddsValue);
      return oddsLabel ? `${player} ${oddsLabel}` : player;
    })
    .join("\n");
}

function courseWebsiteUrl(event: EventOption) {
  const query = [event.course, event.location, "official website"].filter(Boolean).join(" ");
  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(query)}`;
}

function extractAmericanOdds(line: string) {
  const match = line.match(/(?:^|\s)([+-]\d{3,6})(?=\s|$)/);
  if (!match) return { line, odds: undefined };
  const odds = Number(match[1]);
  return {
    line: line.replace(match[0], " ").replace(/\s+/g, " ").trim(),
    odds: Number.isFinite(odds) ? odds : undefined,
  };
}

function expandPlayerInput(input: string): PlayerPoolEntry[] {
  return input
    .split(/\n|;/)
    .flatMap((rawLine) => {
      const cleanedLine = rawLine
        .replace(/\([^)]*\)/g, " ")
        .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\*?\b/gi, " ")
        .replace(/\b(?:AM|PM|TEAM|TEE TIME|Tournament Field|Auto Update:On)\b/gi, " ")
        .replace(/^[\s\-\u2022*|#.\d]+/, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanedLine) return [];

      const { line, odds } = extractAmericanOdds(cleanedLine);
      const teamLine = line.replace(/\s+(?:&|and)\s+/gi, " / ");
      const draftEntries = teamLine.includes("/") ? [teamLine] : teamLine.split(/,\s*(?=[A-Z])/i);
      return draftEntries
        .map((entry) => ({
          name: entry
            .replace(/^[\s\-\u2022*|#.\d]+/, " ")
            .replace(/\s*\/\s*/g, " / ")
            .replace(/[\s*|]+$/g, "")
            .replace(/\s+/g, " ")
            .trim(),
          odds,
        }))
        .filter((entry) => entry.name);
    });
}

function pointsForPosition(position: number | null) {
  return position === null || position < 1 ? 0 : Math.max(0, 51 - position);
}

function resultPositionEditorValue(position: number | null, total: string | null | undefined, thru: string | null | undefined) {
  if (position) return String(position);
  const status = [total, thru]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .find((value) => value === "CUT" || value === "WD" || value === "DQ");
  return status ?? "";
}

function parseResultPositionEditorValue(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return { kind: "empty" as const };
  if (normalized === "CUT" || normalized === "WD" || normalized === "DQ") return { kind: "status" as const, status: normalized };
  const positionMatch = normalized.match(/^T?(\d+)$/);
  if (!positionMatch) return null;
  const position = Number(positionMatch[1]);
  return Number.isInteger(position) && position > 0 ? { kind: "position" as const, position } : null;
}

function isNonScoringResult(total: string | null | undefined, thru: string | null | undefined) {
  const totalValue = String(total ?? "").trim().toUpperCase();
  const thruValue = String(thru ?? "").trim().toUpperCase();
  return totalValue === "CUT" || totalValue === "WD" || totalValue === "DQ" || thruValue === "CUT" || thruValue === "WD" || thruValue === "DQ";
}

function normalizeLegacyNonScoringResult(position: number | null, total: string | null, thru: string | null) {
  if (position !== null || normalizeStoredThru(thru) !== "F") return { total, thru };
  if (!total || !/^[+-]?\d+$|^E$/i.test(total.trim())) return { total, thru };
  return { total: "CUT", thru: "CUT" };
}

function totalColorClass(total: string | null | undefined) {
  const value = String(total ?? "").trim().toUpperCase();
  if (!value) return "text-[#617061]";
  if (value === "E") return "text-[#1a5c3a]";
  if (value.startsWith("-")) return "text-[#9d2f2f]";
  if (value.startsWith("+")) return "text-[#1f2a1d]";
  return "text-[#1f2a1d]";
}

function parseStoredTotal(total: string | null | undefined) {
  if (!total) return null;
  const [score] = total.split("||");
  return score || null;
}

function encodeStoredTotal(total: string | null | undefined, thru: string | null | undefined) {
  if (!total && !thru) return null;
  return `${total ?? ""}||${thru ?? ""}||`;
}

function parseStoredThru(total: string | null | undefined) {
  if (!total || !total.includes("||")) return null;
  const [, thru] = total.split("||");
  return normalizeStoredThru(thru);
}

function numericGolfScore(total: string | null | undefined) {
  const value = String(total ?? "").trim().toUpperCase();
  if (value === "E") return 0;
  return /^[+-]?\d+$/.test(value) ? Number(value) : null;
}

function formatToPar(value: number) {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : String(value);
}

function normalizeStoredThru(thru: string | null | undefined) {
  if (!thru) return null;
  const playoffThru = thru.trim().match(/^playoff\s+\d+\s+of\s*(\d+)$/i);
  if (playoffThru) {
    const playoffTotal = Number(playoffThru[1]);
    return Number.isFinite(playoffTotal) && playoffTotal > 1 ? thru : "F";
  }
  return thru;
}

function parseStoredMeta(total: string | null | undefined) {
  if (!total || !total.includes("||")) return null;
  const [, , meta] = total.split("||");
  return meta || null;
}

function normalizeStoredPlayoffPositions(
  positions: Record<string, number | null>,
  totals: Record<string, string | null>
) {
  const playoffEntries = Object.entries(totals)
    .map(([playerKey, total]) => ({ playerKey, meta: parseStoredMeta(total) }))
    .filter((entry) => entry.meta?.startsWith("PLAYOFF:"))
    .map((entry) => {
      const [, rank] = entry.meta!.split(":");
      return { playerKey: entry.playerKey, rank: Number(rank) };
    })
    .filter((entry) => Number.isFinite(entry.rank) && entry.rank > 0);
  if (playoffEntries.length < 2) return positions;

  const playoffKeys = new Set(playoffEntries.map((entry) => entry.playerKey));
  const rankedScores = Object.entries(totals)
    .filter(([playerKey]) => !playoffKeys.has(playerKey))
    .map(([playerKey, total]) => ({ playerKey, score: numericGolfScore(parseStoredTotal(total)) }))
    .filter((entry): entry is { playerKey: string; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score);
  const corrected = { ...positions };
  playoffEntries.forEach((entry) => {
    corrected[entry.playerKey] = entry.rank;
  });
  let lastScore: number | null = null;
  let lastPosition = playoffEntries.length;
  rankedScores.forEach((entry, index) => {
    if (lastScore === null || entry.score !== lastScore) {
      lastPosition = playoffEntries.length + index + 1;
      lastScore = entry.score;
    }
    corrected[entry.playerKey] = lastPosition;
  });
  return corrected;
}

function playoffLabel(meta: string | null | undefined) {
  if (!meta?.startsWith("PLAYOFF:")) return null;
  const [, rank, total] = meta.split(":");
  const playoffTotal = Number(total);
  if (!Number.isFinite(playoffTotal) || playoffTotal < 2) return null;
  return `Playoff ${rank || "?"} of ${total || "?"}`;
}

function holesCompletedFromThru(thru: string | null | undefined) {
  const value = String(thru ?? "").trim().toUpperCase();
  if (!value) return 0;
  if (value === "F") return 18;
  const match = value.match(/^THRU\s+(\d{1,2})$/);
  if (!match) return 0;
  return Math.max(0, Math.min(18, Number(match[1])));
}

function holesCompletedForDisplay(thru: string | null | undefined, meta: string | null | undefined) {
  if (playoffLabel(meta)) return 0;
  return holesCompletedFromThru(normalizeStoredThru(thru));
}

function resultStatusLabel(position: number | null, total: string | null | undefined, thru: string | null | undefined, meta: string | null | undefined) {
  const normalizedThru = normalizeStoredThru(thru);
  const playoff = playoffLabel(meta);
  if (position) return `${`P${position}`}${playoff ? ` - ${playoff}` : normalizedThru ? ` - ${normalizedThru}` : ""}`;
  if (!total && !normalizedThru && !playoff) return "Not started";
  return playoff ?? normalizedThru ?? "CUT / no finish";
}

function formatProfileLabel(username: string) {
  return username;
}

function authRedirectUrl(mode?: "recovery") {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  url.hash = "";
  if (mode === "recovery") {
    url.search = "";
    url.searchParams.set("type", "recovery");
  } else {
    url.searchParams.delete("type");
  }
  return url.toString();
}

function getAssignedActiveTeams(teams: DraftTeam[]) {
  return teams.filter((team) => team.draft_slot !== null).sort((a, b) => (a.draft_slot ?? 0) - (b.draft_slot ?? 0));
}

function hasValidDraftOrder(teams: DraftTeam[]) {
  const assigned = getAssignedActiveTeams(teams);
  return !!assigned.length && assigned.every((team, index) => team.draft_slot === index + 1);
}

function getCurrentTeamOnClock(teams: DraftTeam[], picks: DraftPick[]) {
  const assigned = getAssignedActiveTeams(teams);
  if (!assigned.length || picks.length >= assigned.length * ROUNDS) return null;
  const round = Math.floor(picks.length / assigned.length) + 1;
  const index = picks.length % assigned.length;
  return round % 2 === 1 ? assigned[index] : assigned[assigned.length - 1 - index];
}

function statusLabel(status: string) {
  return status.replace(/[_-]/g, " ");
}

function roleLabel(role: Profile["role"]) {
  if (role === "commissioner") return "Commissioner";
  if (role === "assistant_commissioner") return "Assistant Commissioner";
  return "Member";
}

function isValidPlayerName(player: string) {
  const key = normalizeName(player);
  const parts = player.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  if (!player) return false;
  if (player.length < 4 || player.length > 80) return false;
  if (!/[a-z]/i.test(player) || /\d/.test(player)) return false;
  if (parts.length > 2) return false;
  if (parts.length === 2 && !parts.every((part) => part.split(" ").length >= 1 && part.split(" ").length <= 4)) return false;
  if (parts.length === 1 && (player.split(" ").length < 2 || player.split(" ").length > 4)) return false;
  return !INVALID_PLAYER_TERMS.some((term) => key.includes(term));
}

function parsePlayerPoolEntries(input: string) {
  const seen = new Set<string>();
  const cleaned: PlayerPoolEntry[] = [];

  for (const entry of expandPlayerInput(input)) {
    const player = entry.name.replace(/\s+/g, " ").trim();
    const key = normalizeName(player);

    if (seen.has(key) || !isValidPlayerName(player)) continue;

    seen.add(key);
    cleaned.push({ name: player, odds: entry.odds });
  }

  return cleaned;
}

function parsePlayerPoolInput(input: string) {
  return parsePlayerPoolEntries(input).map((entry) => entry.name);
}

function parsePlayerPoolOdds(input: string) {
  return Object.fromEntries(
    parsePlayerPoolEntries(input)
      .filter((entry): entry is PlayerPoolEntry & { odds: number } => Number.isFinite(entry.odds))
      .map((entry) => [normalizeName(entry.name), entry.odds])
  );
}

function formatPlayerPoolInput(input: string) {
  return parsePlayerPoolEntries(input)
    .map((entry) => {
      const odds = formatOdds(entry.odds);
      return odds ? `${entry.name} ${odds}` : entry.name;
    })
    .join("\n");
}

function lookupOddsForPlayer(playerName: string, oddsMap: Record<string, number>) {
  const key = normalizeName(playerName);
  if (Number.isFinite(oddsMap[key])) return oddsMap[key];
  const normalizedMatchedKey = Object.keys(oddsMap).find((oddsKey) => normalizeName(oddsKey) === key);
  if (normalizedMatchedKey && Number.isFinite(oddsMap[normalizedMatchedKey])) return oddsMap[normalizedMatchedKey];

  const signature = teamLastNameSignature(playerName);
  if (signature) {
    const teamMatchedKey = Object.keys(oddsMap).find((oddsKey) => teamLastNameSignature(oddsKey) === signature);
    if (teamMatchedKey) return oddsMap[teamMatchedKey];
  }

  const parts = key.split(" ");
  if (parts.length < 2 || parts[0].length !== 1) return undefined;

  const firstInitial = parts[0];
  const lastName = parts[parts.length - 1];
  const matchedKey = Object.keys(oddsMap).find((oddsKey) => {
    const oddsParts = oddsKey.split(" ");
    return oddsParts[0]?.startsWith(firstInitial) && oddsParts[oddsParts.length - 1] === lastName;
  });

  return matchedKey ? oddsMap[matchedKey] : undefined;
}

function teamLastNameSignature(name: string) {
  const parts = normalizeName(name)
    .split("/")
    .map((part) => part.trim().split(" ").filter(Boolean).at(-1))
    .filter(Boolean)
    .sort();

  return parts.length > 1 ? parts.join("/") : null;
}

function lookupLeaderboardValue<T>(playerName: string, values: Record<string, T>) {
  const key = normalizeName(playerName);
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];

  const normalizedKey = Object.keys(values).find((valueKey) => normalizeName(valueKey) === key);
  if (normalizedKey) return values[normalizedKey];

  const [firstName, ...remainingParts] = key.split(" ").filter(Boolean);
  const lastName = remainingParts.at(-1);
  if (firstName && lastName) {
    const nameMatchedKey = Object.keys(values).find((valueKey) => {
      const [valueFirstName, ...valueRemainingParts] = normalizeName(valueKey).split(" ").filter(Boolean);
      const valueLastName = valueRemainingParts.at(-1);
      if (!valueFirstName || valueLastName !== lastName) return false;
      return valueFirstName === firstName || valueFirstName[0] === firstName[0] || firstName.startsWith(valueFirstName);
    });
    if (nameMatchedKey) return values[nameMatchedKey];
  }

  const signature = teamLastNameSignature(playerName);
  if (!signature) return undefined;

  const matchedKey = Object.keys(values).find((valueKey) => teamLastNameSignature(valueKey) === signature);
  return matchedKey ? values[matchedKey] : undefined;
}

function randomInt(maxExclusive: number) {
  if (maxExclusive <= 0) return 0;
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  const values = new Uint32Array(1);
  do {
    window.crypto.getRandomValues(values);
  } while (values[0] >= limit);

  return values[0] % maxExclusive;
}

function shuffled<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rrg-brand ${compact ? "rrg-brand--compact" : ""}`} aria-label="Rat Race Golf">
      <Image className="rrg-brand__image" src="/rat-race-golf-logo.png" alt="Rat Race Golf" width={402} height={125} priority />
    </div>
  );
}

export default function Page() {
  const draftFlowRef = useRef<HTMLDivElement | null>(null);
  const sessionDateLoadRequestRef = useRef(0);
  const eventLoadRequestRef = useRef(0);
  const [sessions, setSessions] = useState<DraftSession[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [siteProfiles, setSiteProfiles] = useState<Profile[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [memberships, setMemberships] = useState<LeagueMembership[]>([]);
  const [currentLeagueId, setCurrentLeagueId] = useState("");
  const [leagueContextLoaded, setLeagueContextLoaded] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [currentSession, setCurrentSession] = useState<DraftSession | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [sessionEventDates, setSessionEventDates] = useState<Record<string, string>>({});
  const [resolvedSessionSeasons, setResolvedSessionSeasons] = useState<Record<string, number>>({});
  const [sessionDatesLoaded, setSessionDatesLoaded] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [defaultSessionResolved, setDefaultSessionResolved] = useState(false);
  const [expandedSessionYears, setExpandedSessionYears] = useState<number[]>([]);
  const [currentSessionEventDetails, setCurrentSessionEventDetails] = useState<EventOption | null>(null);
  const [newDraftTour, setNewDraftTour] = useState("pga");
  const [newDraftSeason, setNewDraftSeason] = useState(CURRENT_GOLF_SEASON);
  const [newSessionCountsForSeason, setNewSessionCountsForSeason] = useState(true);
  const [newSessionEventId, setNewSessionEventId] = useState("");
  const [newDraftModalOpen, setNewDraftModalOpen] = useState(false);
  const [newDraftTeams, setNewDraftTeams] = useState<NewDraftTeam[]>([]);
  const [newDraftTeamName, setNewDraftTeamName] = useState("");
  const [draggedNewDraftTeam, setDraggedNewDraftTeam] = useState("");
  const [dragOverNewDraftTeam, setDragOverNewDraftTeam] = useState("");
  const [newLeagueName, setNewLeagueName] = useState("");
  const [newLeagueMemberId, setNewLeagueMemberId] = useState("");
  const [pendingInvitationToken, setPendingInvitationToken] = useState("");
  const [leagueInvitationToken, setLeagueInvitationToken] = useState("");
  const [playerPoolDraft, setPlayerPoolDraft] = useState("");
  const [resultPositionEditorOpen, setResultPositionEditorOpen] = useState(false);
  const [resultPositionEdits, setResultPositionEdits] = useState<Record<string, string>>({});
  const [tournamentLeaderboardOpen, setTournamentLeaderboardOpen] = useState(false);
  const [tournamentLeaderboardRows, setTournamentLeaderboardRows] = useState<TournamentLeaderboardRow[]>([]);
  const [tournamentLeaderboardLoading, setTournamentLeaderboardLoading] = useState(false);
  const [playerFilter, setPlayerFilter] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const [seasonStats, setSeasonStats] = useState<SeasonTeamStat[]>([]);
  const [seasonStatsLoading, setSeasonStatsLoading] = useState(false);
  const [seasonStatsView, setSeasonStatsView] = useState<SeasonStatsView>("league");
  const [seasonStatsYear, setSeasonStatsYear] = useState<number | "all">(CURRENT_GOLF_SEASON);
  const [seasonStatSections, setSeasonStatSections] = useState<Record<SeasonStatSection, boolean>>({
    standings: true,
    leaders: true,
    profiles: true,
  });
  const [statusMessage, setStatusMessage] = useState("Loading league data...");
  const [busy, setBusy] = useState("");
  const [activeRoomTab, setActiveRoomTab] = useState<RoomTab>("draft");
  const [editingPick, setEditingPick] = useState<EditingPick | null>(null);
  const [highlightedPlayerIndex, setHighlightedPlayerIndex] = useState(0);
  const [oddsByPlayer, setOddsByPlayer] = useState<Record<string, number>>({});
  const [autoFieldImportAttempts, setAutoFieldImportAttempts] = useState<Record<string, boolean>>({});
  const [autoFieldRefreshAttempts, setAutoFieldRefreshAttempts] = useState<Record<string, boolean>>({});
  const deferredFilter = useDeferredValue(playerFilter);
  const currentLeague = useMemo(() => leagues.find((league) => league.id === currentLeagueId) ?? null, [leagues, currentLeagueId]);
  const availableSeasonYears = useMemo(() => Array.from(new Set(
    sessions.map((session) => resolvedSessionSeasons[session.id] ?? sessionEventSeason(session))
  )).sort((a, b) => b - a), [resolvedSessionSeasons, sessions]);
  const yearFilteredSessions = useMemo(() => sessions.filter((session) =>
    seasonStatsYear === "all"
    || (resolvedSessionSeasons[session.id] ?? sessionEventSeason(session)) === seasonStatsYear
  ), [resolvedSessionSeasons, seasonStatsYear, sessions]);
  const yearCountedSeasonSessions = useMemo(
    () => yearFilteredSessions.filter(sessionCountsForSeason),
    [yearFilteredSessions]
  );
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    const aDate = sessionEventDates[a.id] ?? `${resolvedSessionSeasons[a.id] ?? sessionEventSeason(a)}-01-01`;
    const bDate = sessionEventDates[b.id] ?? `${resolvedSessionSeasons[b.id] ?? sessionEventSeason(b)}-01-01`;
    const dateDifference = new Date(bDate).getTime() - new Date(aDate).getTime();
    return dateDifference || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }), [resolvedSessionSeasons, sessionEventDates, sessions]);
  const scheduleSessions = useMemo(() => sortedSessions.filter((session) =>
    seasonStatsYear === "all"
    || (resolvedSessionSeasons[session.id] ?? sessionEventSeason(session)) === seasonStatsYear
  ), [resolvedSessionSeasons, seasonStatsYear, sortedSessions]);
  const featuredSession = useMemo(() => {
    if (!sortedSessions.length) return null;
    const now = Date.now();
    const withDates = sortedSessions
      .map((session) => ({ session, date: new Date(sessionEventDates[session.id] ?? "").getTime() }))
      .filter((entry) => Number.isFinite(entry.date));
    const inProgress = withDates
      .filter((entry) => entry.date <= now && now <= entry.date + 5 * 24 * 60 * 60 * 1000)
      .sort((a, b) => b.date - a.date);
    if (inProgress[0]) return inProgress[0].session;
    const upcoming = withDates
      .filter((entry) => entry.date > now && entry.session.status !== "finalized")
      .sort((a, b) => a.date - b.date);
    if (upcoming[0]) return upcoming[0].session;
    const active = withDates
      .filter((entry) => entry.session.status !== "finalized")
      .sort((a, b) => b.date - a.date);
    return active[0]?.session ?? sortedSessions[0];
  }, [sessionEventDates, sortedSessions]);
  const archivedSessionsByYear = useMemo(() => {
    const groups = new Map<number, DraftSession[]>();
    sortedSessions.forEach((session) => {
      if (session.id === featuredSession?.id) return;
      const eventDate = sessionEventDates[session.id];
      const dateYear = eventDate ? new Date(eventDate).getUTCFullYear() : null;
      const year = dateYear && Number.isFinite(dateYear) ? dateYear : resolvedSessionSeasons[session.id] ?? sessionEventSeason(session);
      const existing = groups.get(year) ?? [];
      existing.push(session);
      groups.set(year, existing);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => b - a);
  }, [featuredSession?.id, resolvedSessionSeasons, sessionEventDates, sortedSessions]);
  const completedSeasonSessions = useMemo(() => yearFilteredSessions.filter((session) =>
    (seasonStatsView === "all" || sessionCountsForSeason(session))
    && (session.status === "scored" || session.status === "finalized")
    && Object.keys(session.current_positions ?? {}).length > 0
  ), [seasonStatsView, yearFilteredSessions]);
  const currentLeagueInviteUrl = useMemo(() => {
    if (typeof window === "undefined" || !leagueInvitationToken) return "";
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("invite", leagueInvitationToken);
    return url.toString();
  }, [leagueInvitationToken]);
  const currentMembership = useMemo(() => memberships.find((membership) => membership.league_id === currentLeagueId && membership.user_id === user?.id) ?? null, [currentLeagueId, memberships, user?.id]);
  const selectedNewDraftEvent = useMemo(() => events.find((event) => event.id === newSessionEventId) ?? null, [events, newSessionEventId]);
  const selectedCurrentSessionEvent = useMemo(() => events.find((event) => event.id === currentSession?.event_id) ?? null, [events, currentSession?.event_id]);
  const currentSessionDisplayEvent = currentSessionEventDetails ?? selectedCurrentSessionEvent;
  const effectiveRole = currentMembership?.role ?? profile?.role ?? "member";
  const isSiteAdmin = profile?.site_role === "site_admin";
  const isCommissioner = effectiveRole === "commissioner";
  const isAssistantCommissioner = effectiveRole === "assistant_commissioner";
  const isLeagueAdmin = isSiteAdmin || isCommissioner || isAssistantCommissioner;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invitationToken = params.get("invite")?.trim() || window.localStorage.getItem("rrg_pending_invitation_token") || "";
    if (!invitationToken) return;
    window.localStorage.setItem("rrg_pending_invitation_token", invitationToken);
    setPendingInvitationToken(invitationToken);
    setStatusMessage("Sign in or create an account to join this league.");
  }, []);

  useEffect(() => {
    initializeAuth();
  }, []);

  useEffect(() => {
    loadEvents(newDraftTour, newDraftSeason);
  }, [newDraftSeason, newDraftTour]);

  useEffect(() => {
    loadCurrentSessionEventDetails();
  }, [currentSession?.event_id, currentSession?.event_season, currentSession?.event_tour, currentSession?.manual_leaderboard_input, resolvedSessionSeasons]);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (_event === "PASSWORD_RECOVERY") {
        setPasswordResetMode(true);
      }
      setUser(nextSession?.user ?? null);
      setAuthChecked(true);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!user) {
      setProfile(null);
      setProfiles([]);
      setLeagues([]);
      setMemberships([]);
      setCurrentLeagueId("");
      setLeagueContextLoaded(false);
      setSessions([]);
      setCurrentSession(null);
      setTeams([]);
      setPicks([]);
      setSelectedSessionId("");
      setStatusMessage(pendingInvitationToken ? "Sign in or create an account to join this league." : "Sign in to access the league.");
      return;
    }

    void loadProfile(user.id);
  }, [authChecked, pendingInvitationToken, user]);


  useEffect(() => {
    setSelectedSessionId("");
    setCurrentSession(null);
    setTeams([]);
    setPicks([]);
    setSessionsLoaded(false);
    setDefaultSessionResolved(false);
  }, [currentLeagueId]);

  useEffect(() => {
    if (!authChecked || !user || !currentLeagueId) {
      if (authChecked && user && !currentLeagueId) setSessions([]);
      return;
    }
    void loadSessions();
  }, [authChecked, user, currentLeagueId]);
  useEffect(() => {
    if (!sessionsLoaded || defaultSessionResolved) return;
    if (!sessions.length) {
      setDefaultSessionResolved(true);
      return;
    }
    if (!sessionDatesLoaded) return;
    if (!selectedSessionId && featuredSession?.id) setSelectedSessionId(featuredSession.id);
    setDefaultSessionResolved(true);
  }, [defaultSessionResolved, featuredSession?.id, selectedSessionId, sessionDatesLoaded, sessions.length, sessionsLoaded]);

  useEffect(() => {
    if (!sessions.length) {
      sessionDateLoadRequestRef.current += 1;
      setSessionEventDates({});
      setResolvedSessionSeasons({});
      setSessionDatesLoaded(false);
      return;
    }
    setSessionDatesLoaded(false);
    void loadSessionEventDates(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (!user) return;
    loadSession(selectedSessionId);
    const channel = supabase
      .channel(`draft-${selectedSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${selectedSessionId}` }, () => { loadSessions(); loadSession(selectedSessionId, false, false); })
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_teams", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false, false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSessionId, user]);

  useEffect(() => {
    if (!selectedSessionId || !user) return;

    const refreshSelectedSession = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadSessions();
      void loadSession(selectedSessionId, false, false);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSelectedSession();
    };
    const interval = window.setInterval(refreshSelectedSession, 60 * 1000);

    window.addEventListener("focus", refreshSelectedSession);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshSelectedSession);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [selectedSessionId, user]);

  useEffect(() => {
    setPlayerPoolDraft(currentSession?.player_input ?? "");
  }, [currentSession?.id, currentSession?.player_input, currentSession?.manual_leaderboard_input]);

  useEffect(() => {
    setTournamentLeaderboardRows([]);
    setTournamentLeaderboardOpen(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!currentSession) return;
    setNewDraftTour(currentSession.event_tour ?? "pga");
    setNewDraftSeason(resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession));
  }, [currentSession?.id, currentSession?.event_season, currentSession?.event_tour, currentSession?.manual_leaderboard_input, resolvedSessionSeasons]);

  useEffect(() => {
    if (currentSession?.odds_snapshot && Object.keys(currentSession.odds_snapshot).length) {
      setOddsByPlayer(currentSession.odds_snapshot);
      return;
    }
    if (!currentSession?.event_name) {
      setOddsByPlayer({});
      return;
    }
    loadOdds(currentSession.event_name, resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession));
  }, [currentSession?.event_name, currentSession?.event_season, currentSession?.manual_leaderboard_input, currentSession?.odds_snapshot, currentSession?.odds_source, resolvedSessionSeasons]);

  useEffect(() => {
    if (!profile || isLeagueAdmin) return;
    if (activeRoomTab === "setup" || activeRoomTab === "admin") {
      setActiveRoomTab("draft");
    }
  }, [activeRoomTab, isLeagueAdmin, profile]);

  useEffect(() => {
    if (!isLeagueAdmin || !currentLeagueId) {
      setProfiles([]);
      return;
    }
    loadProfiles();
  }, [currentLeagueId, isLeagueAdmin]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery")) {
      setPasswordResetMode(true);
    }
  }, []);

  useEffect(() => {
    setProfileDraftName(profile?.username ?? "");
  }, [profile?.username]);

  useEffect(() => {
    if (activeRoomTab !== "season" || !sessions.length) return;
    void loadSeasonStats();
  }, [activeRoomTab, profiles, resolvedSessionSeasons, seasonStatsView, seasonStatsYear, sessions]);

  useEffect(() => {
    if (activeRoomTab !== "results" || !currentSession?.event_id) return;
    void loadTournamentLeaderboard(false);
  }, [activeRoomTab, currentSession?.event_id, currentSession?.updated_at]);

  const assignedTeams = useMemo(() => getAssignedActiveTeams(teams), [teams]);
  const validDraftOrder = useMemo(() => hasValidDraftOrder(teams), [teams]);
  const currentTeamOnClock = useMemo(() => (validDraftOrder ? getCurrentTeamOnClock(teams, picks) : null), [teams, picks, validDraftOrder]);
  const draftedKeys = useMemo(() => new Set(picks.map((pick) => pick.player_key)), [picks]);
    const allPlayers = useMemo(() => parsePlayerPoolInput(playerPoolDraft), [playerPoolDraft]);
    const playerPoolOdds = useMemo(() => parsePlayerPoolOdds(playerPoolDraft), [playerPoolDraft]);
    const displayOddsByPlayer = useMemo(() => ({ ...oddsByPlayer, ...playerPoolOdds }), [oddsByPlayer, playerPoolOdds]);
    const playerOddsValue = (playerName: string) => lookupOddsForPlayer(playerName, displayOddsByPlayer);
    const playerOddsLabel = (playerName: string) => formatOdds(playerOddsValue(playerName));
  const availablePlayers = useMemo(() => allPlayers
      .filter((player) => !draftedKeys.has(normalizeName(player)))
      .filter((player) => player.toLowerCase().includes(deferredFilter.toLowerCase()))
      .sort((a, b) => {
      const aOdds = lookupOddsForPlayer(a, displayOddsByPlayer) ?? Number.POSITIVE_INFINITY;
      const bOdds = lookupOddsForPlayer(b, displayOddsByPlayer) ?? Number.POSITIVE_INFINITY;
      if (aOdds !== bOdds) return aOdds - bOdds;
      return a.localeCompare(b);
    }), [allPlayers, draftedKeys, deferredFilter, displayOddsByPlayer]);
  const totalPicks = assignedTeams.length * ROUNDS;
  const draftComplete = totalPicks > 0 && picks.length >= totalPicks;
  const currentRound = assignedTeams.length ? Math.floor(picks.length / assignedTeams.length) + 1 : 0;
  const currentPickNumber = totalPicks ? Math.min(picks.length + 1, totalPicks) : 0;
  const draftPickTape = useMemo(() => {
    if (!assignedTeams.length) return [];

    return Array.from({ length: totalPicks }, (_, index) => {
      const roundNumber = Math.floor(index / assignedTeams.length) + 1;
      const roundIndex = index % assignedTeams.length;
      const team = roundNumber % 2 === 1 ? assignedTeams[roundIndex] : assignedTeams[assignedTeams.length - 1 - roundIndex];
      const pick = team ? picks.find((entry) => entry.team_id === team.id && entry.round_number === roundNumber) ?? null : null;
      return {
        pickNumber: index + 1,
        roundNumber,
        team,
        pick,
        state: index < picks.length ? "complete" : index === picks.length && !draftComplete ? "current" : "upcoming",
      };
    });
  }, [assignedTeams, draftComplete, picks, totalPicks]);
  const teamDraftRosters = useMemo(() => {
    return assignedTeams
      .map((team) => ({
        team,
        isMine: team.owner_user_id === user?.id,
        picks: picks
          .filter((pick) => pick.team_id === team.id)
          .sort((a, b) => a.round_number - b.round_number || a.pick_number - b.pick_number),
      }))
      .sort((a, b) => {
        if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
        return (a.team.draft_slot ?? 999) - (b.team.draft_slot ?? 999);
      });
  }, [assignedTeams, picks, user?.id]);
  const leaderboard = useMemo(() => {
    const storedPositions = currentSession?.current_positions ?? {};
    const totals = currentSession?.current_totals ?? {};
    const positions = normalizeStoredPlayoffPositions(storedPositions, totals);
    const livePositions = Object.fromEntries(tournamentLeaderboardRows.map((row) => [row.name, row.position]));
    const liveTotals = Object.fromEntries(tournamentLeaderboardRows.map((row) => [row.name, encodeStoredTotal(row.total, row.thru)]));
    const hasSavedLeaderboard = Object.keys(positions).length > 0 || Object.keys(totals).length > 0;
    const hasLiveLeaderboard = tournamentLeaderboardRows.length > 0;
        return assignedTeams.map((team) => {
          const playerScores = picks.filter((pick) => pick.team_id === team.id).map((pick) => {
          const savedPosition = lookupLeaderboardValue(pick.player_name, positions) ?? null;
          const savedTotal = lookupLeaderboardValue(pick.player_name, totals) ?? null;
          const shouldUseLiveFallback = savedPosition === null && savedTotal === null;
          const position = shouldUseLiveFallback ? lookupLeaderboardValue(pick.player_name, livePositions) ?? null : savedPosition;
          const total = shouldUseLiveFallback ? lookupLeaderboardValue(pick.player_name, liveTotals) ?? null : savedTotal;
          const missingFromLeaderboard = (hasSavedLeaderboard || hasLiveLeaderboard) && position === null && total === null;
          const storedTotal = missingFromLeaderboard ? "WD" : parseStoredTotal(total);
          const storedThru = missingFromLeaderboard ? "WD" : parseStoredThru(total);
          const normalizedResult = normalizeLegacyNonScoringResult(position, storedTotal, storedThru);
          const displayTotal = normalizedResult.total;
          const thru = normalizedResult.thru;
          const meta = missingFromLeaderboard ? null : parseStoredMeta(total);
            return { ...pick, position, total: displayTotal, thru, meta, points: pointsForPosition(position), nonScoring: isNonScoringResult(displayTotal, thru) };
          });
      const total = [...playerScores].map((player) => player.points).sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
      const countingKeys = new Set(
        [...playerScores]
          .sort((a, b) => b.points - a.points || Number(a.nonScoring) - Number(b.nonScoring) || a.pick_number - b.pick_number)
          .slice(0, 3)
          .map((player) => player.id)
      );
      return { team, playerScores, total, countingKeys };
    }).sort((a, b) => b.total - a.total);
  }, [assignedTeams, currentSession?.current_positions, currentSession?.current_totals, picks, tournamentLeaderboardRows]);
  const resultsUpdatedLabel = useMemo(() => {
    if (!currentSession?.updated_at) return "Not updated yet";
    return new Date(currentSession.updated_at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [currentSession?.updated_at]);
  const canDraftCurrentPick = !!user && !!currentTeamOnClock && (isLeagueAdmin || currentTeamOnClock.owner_user_id === user.id);
  const canManageLeague = !!user && isLeagueAdmin;
  const canManagePermissions = !!user && (isSiteAdmin || isCommissioner);
  const canEditResultPositions = !!user && (isCommissioner || isAssistantCommissioner);
  const resultsFinalized = currentSession?.status === "finalized";
  const setupHasEvent = !!currentSession?.event_id;
  const setupHasTeams = assignedTeams.length > 0 && validDraftOrder;
  const setupHasField = allPlayers.length > 0;
  const setupHasOdds = Object.keys(displayOddsByPlayer).length > 0;
  const setupReady = setupHasEvent && setupHasTeams && setupHasField;
  const fieldPending = setupHasEvent && !setupHasField && picks.length === 0;
  const tournamentIdentityLocked = picks.length > 0;
  const tournamentWorkspaceReady = !currentLeagueId || (defaultSessionResolved && (!selectedSessionId || currentSession?.id === selectedSessionId));
  const [draftFlowWidth, setDraftFlowWidth] = useState(0);
  const draftFlowCardWidth = draftFlowWidth ? Math.max(0, (draftFlowWidth - 32) / 5) : 0;
  const draftFlowCenterPadding = draftFlowWidth && draftFlowCardWidth ? (draftFlowWidth - draftFlowCardWidth) / 2 : 0;
  const availableSiteProfiles = useMemo(() => {
    const memberIds = new Set(profiles.map((entry) => entry.id));
    return siteProfiles.filter((entry) => !memberIds.has(entry.id));
  }, [profiles, siteProfiles]);
  const centerDraftFlowOnCurrentPick = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!currentPickNumber) return;
    const container = draftFlowRef.current;
    if (!container) return;

    const activePickNumber = draftComplete ? totalPicks : currentPickNumber;
    const currentPick = container.querySelector<HTMLElement>(`[data-pick-number='${activePickNumber}']`);
    if (!currentPick) return;

    const containerRect = container.getBoundingClientRect();
    const currentPickRect = currentPick.getBoundingClientRect();
    const targetLeft = container.scrollLeft + currentPickRect.left - containerRect.left - (container.clientWidth - currentPickRect.width) / 2;
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    container.scrollTo({ left: Math.min(Math.max(0, targetLeft), maxLeft), behavior });
  }, [currentPickNumber, draftComplete, totalPicks]);

  useEffect(() => {
    autoImportMissingPlayerPool();
  }, [canManageLeague, currentSession?.id, currentSession?.event_id, currentSession?.event_tour, currentSession?.manual_leaderboard_input, currentSession?.player_input, resolvedSessionSeasons]);

  useEffect(() => {
    autoRefreshFieldBeforeDraft();
  }, [activeRoomTab, canManageLeague, currentSession?.id, currentSession?.event_id, currentSession?.event_tour, currentSession?.manual_leaderboard_input, currentSession?.field_refreshed_at, currentSession?.odds_refreshed_at, picks.length, resolvedSessionSeasons]);

  useEffect(() => {
    if (activeRoomTab !== "draft" || !draftPickTape.length) return;
    const container = draftFlowRef.current;
    if (!container) return;

    const updateDraftFlowWidth = () => setDraftFlowWidth(container.clientWidth);
    updateDraftFlowWidth();

    const observer = new ResizeObserver(updateDraftFlowWidth);
    observer.observe(container);
    window.addEventListener("resize", updateDraftFlowWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDraftFlowWidth);
    };
  }, [activeRoomTab, draftPickTape.length]);

  useEffect(() => {
    if (activeRoomTab !== "draft" || !currentPickNumber) return;

    const animationFrame = window.requestAnimationFrame(() => centerDraftFlowOnCurrentPick());
    const timeout = window.setTimeout(() => centerDraftFlowOnCurrentPick(), 150);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [activeRoomTab, currentPickNumber, currentSession?.id, draftPickTape.length, draftFlowWidth, centerDraftFlowOnCurrentPick]);

  useEffect(() => {
    if (!availablePlayers.length) {
      setHighlightedPlayerIndex(0);
      return;
    }
    setHighlightedPlayerIndex((current) => Math.min(current, availablePlayers.length - 1));
  }, [availablePlayers]);

  async function initializeAuth() {
    let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
    try {
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Supabase auth timed out.")), 10000);
      });
      sessionResult = await Promise.race([supabase.auth.getSession(), timeout]);
    } catch (error) {
      console.error(error);
      setAuthChecked(true);
      setStatusMessage("Could not load your sign-in session.");
      return;
    }

    if (sessionResult.error) {
      console.error(sessionResult.error);
      setAuthChecked(true);
      setStatusMessage("Could not load your sign-in session.");
      return;
    }

    setUser(sessionResult.data.session?.user ?? null);
    setAuthChecked(true);
  }

  async function loadProfile(userId: string) {
    setLeagueContextLoaded(false);
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.error(error);
      setStatusMessage("Could not load your league profile.");
      return;
    }

    const nextProfile = (data as Profile | null) ?? null;
    setProfile(nextProfile);

    await joinPendingLeagueInvite();
    await loadLeagueContext(userId, nextProfile);
  }

  async function joinPendingLeagueInvite() {
    const invitationToken = pendingInvitationToken || (typeof window !== "undefined" ? window.localStorage.getItem("rrg_pending_invitation_token") ?? "" : "");
    if (!invitationToken) return;

    const joinResult = await supabase.rpc("accept_league_invitation", {
      invitation_token: invitationToken,
    });

    if (joinResult.error || !joinResult.data) {
      console.error(joinResult.error);
      if (typeof window !== "undefined") window.localStorage.removeItem("rrg_pending_invitation_token");
      setPendingInvitationToken("");
      setStatusMessage(joinResult.error?.message || "Could not join that league invite.");
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("rrg_pending_invitation_token");
      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    setPendingInvitationToken("");
    setCurrentLeagueId(joinResult.data as string);
    setStatusMessage("Joined the league.");
  }

  async function loadLeagueContext(userId: string, nextProfile: Profile | null) {
    const membershipResult = await supabase.from("league_memberships").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (membershipResult.error) {
      console.error(membershipResult.error);
      setStatusMessage("Could not load your league memberships.");
      setLeagueContextLoaded(true);
      return;
    }

    const nextMemberships = (membershipResult.data ?? []) as LeagueMembership[];
    setMemberships(nextMemberships);

    const leagueIds = new Set(nextMemberships.map((membership) => membership.league_id));
    if (nextProfile?.active_league_id) leagueIds.add(nextProfile.active_league_id);

    const leagueQuery = nextProfile?.site_role === "site_admin"
      ? supabase.from("leagues").select("*").order("created_at", { ascending: true })
      : leagueIds.size
        ? supabase.from("leagues").select("*").in("id", Array.from(leagueIds)).order("created_at", { ascending: true })
        : supabase.from("leagues").select("*").limit(0);

    const leagueResult = await leagueQuery;
    if (leagueResult.error) {
      console.error(leagueResult.error);
      setStatusMessage("Could not load your leagues.");
      setLeagueContextLoaded(true);
      return;
    }

    const nextLeagues = (leagueResult.data ?? []) as League[];
    setLeagues(nextLeagues);
    setCurrentLeagueId((current) => {
      if (current && nextLeagues.some((league) => league.id === current)) return current;
      if (nextProfile?.active_league_id && nextLeagues.some((league) => league.id === nextProfile.active_league_id)) return nextProfile.active_league_id;
      return nextMemberships[0]?.league_id ?? nextLeagues[0]?.id ?? "";
    });
    setLeagueContextLoaded(true);
  }

  async function loadProfiles() {
    if (!currentLeagueId) {
      setProfiles([]);
      return;
    }

    if (isSiteAdmin) {
      void loadSiteProfiles();
    }

    const membershipResult = await supabase.from("league_memberships").select("*").eq("league_id", currentLeagueId).order("created_at", { ascending: true });
    if (membershipResult.error) {
      console.error(membershipResult.error);
      setStatusMessage("Could not load league memberships.");
      return;
    }

    const leagueMemberships = (membershipResult.data ?? []) as LeagueMembership[];
    const memberIds = leagueMemberships.map((membership) => membership.user_id);
    if (!memberIds.length) {
      setProfiles([]);
      return;
    }

    const { data, error } = await supabase.from("profiles").select("*").in("id", memberIds).order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      setStatusMessage("Could not load signed-up league members.");
      return;
    }

    const roleByUserId = new Map(leagueMemberships.map((membership) => [membership.user_id, membership.role]));
    setProfiles(((data ?? []) as Profile[]).map((entry) => ({
      ...entry,
      role: roleByUserId.get(entry.id) ?? entry.role,
    })));
  }

  async function loadSiteProfiles() {
    if (!isSiteAdmin) {
      setSiteProfiles([]);
      return;
    }

    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      setStatusMessage("Could not load all site accounts.");
      return;
    }

    setSiteProfiles((data ?? []) as Profile[]);
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword) {
      setStatusMessage("Enter your email and password to sign in.");
      return;
    }

    setBusy("Signing in...");
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not sign you in.");
      return;
    }

    setStatusMessage("Signed in.");
  }

  async function signUp() {
    if (!authUsername.trim()) {
      setStatusMessage("Choose a username before creating your account.");
      return;
    }
    if (!authEmail.trim() || !authPassword) {
      setStatusMessage("Enter your email and password before creating your account.");
      return;
    }

    setBusy("Creating account...");
    const { error } = await supabase.auth.signUp({
      email: authEmail.trim(),
      password: authPassword,
      options: {
        data: {
          username: authUsername.trim(),
        },
      },
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not create your account.");
      return;
    }

    setStatusMessage("Account created. If your project requires email confirmation, verify your email and then sign in.");
  }

  async function sendPasswordReset() {
    if (!authEmail.trim()) {
      setStatusMessage("Enter your email address first so we know where to send the reset link.");
      return;
    }

    setBusy("Sending reset email...");
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
      redirectTo: authRedirectUrl("recovery"),
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not send the password reset email.");
      return;
    }

    setStatusMessage("Password reset email sent. Open the link in that email and set your new password.");
  }

  async function signInWithProvider(provider: SocialProvider) {
    setBusy(`Opening ${provider} sign in...`);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authRedirectUrl(),
      },
    });

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage(error.message || `Could not start ${provider} sign in.`);
    }
  }

  function handleAuthPasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void (authMode === "sign_up" ? signUp() : signIn());
  }

  async function finishPasswordReset() {
    if (!recoveryPassword || !recoveryPasswordConfirm) {
      setStatusMessage("Enter your new password twice.");
      return;
    }
    if (recoveryPassword !== recoveryPasswordConfirm) {
      setStatusMessage("Those passwords do not match.");
      return;
    }

    setBusy("Updating password...");
    const { error } = await supabase.auth.updateUser({ password: recoveryPassword });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not update your password.");
      return;
    }

    setRecoveryPassword("");
    setRecoveryPasswordConfirm("");
    setPasswordResetMode(false);
    setStatusMessage("Password updated. You can use your new password now.");
  }

  async function changeActiveLeague(nextLeagueId: string) {
    if (!user || !nextLeagueId || nextLeagueId === currentLeagueId) return;
    setLeagueInvitationToken("");
    setCurrentLeagueId(nextLeagueId);
    setBusy("Switching league...");
    const { error } = await supabase.from("profiles").update({ active_league_id: nextLeagueId }).eq("id", user.id);
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage("Switched league locally, but could not save it as your default.");
      return;
    }

    setStatusMessage(`Switched to ${leagues.find((league) => league.id === nextLeagueId)?.name ?? "that league"}.`);
    await loadProfile(user.id);
  }

  async function createLeague() {
    if (!user) {
      setStatusMessage("Sign in before creating a league.");
      return;
    }

    const leagueName = newLeagueName.trim();
    if (!leagueName) {
      setStatusMessage("Enter a league name before creating it.");
      return;
    }

    setBusy("Creating league...");
    const leagueResult = await supabase.rpc("create_league", {
      target_name: leagueName,
    });

    if (leagueResult.error || !leagueResult.data) {
      console.error(leagueResult.error);
      setBusy("");
      setStatusMessage(leagueResult.error?.message || "Could not create that league.");
      return;
    }

    const createdLeagueId = leagueResult.data as string;
    const inviteResult = await supabase.rpc("create_league_invitation", {
      target_league_id: createdLeagueId,
      expires_in_days: 14,
      target_max_uses: 25,
    });

    setNewLeagueName("");
    setBusy("");
    setStatusMessage(inviteResult.error ? `Created ${leagueName}, but could not generate its first invitation.` : `Created ${leagueName}. Its invitation is ready to share.`);
    setCurrentLeagueId(createdLeagueId);
    setLeagueInvitationToken((inviteResult.data as string | null) ?? "");
    await loadProfile(user.id);
  }

  async function generateLeagueInvitation() {
    if (!currentLeagueId || !isLeagueAdmin) {
      setStatusMessage("Only a league admin can create invitation links.");
      return;
    }

    setBusy("Generating invitation...");
    const inviteResult = await supabase.rpc("create_league_invitation", {
      target_league_id: currentLeagueId,
      expires_in_days: 14,
      target_max_uses: 25,
    });
    setBusy("");

    if (inviteResult.error || !inviteResult.data) {
      console.error(inviteResult.error);
      setStatusMessage(inviteResult.error?.message || "Could not generate an invitation link.");
      return;
    }

    setLeagueInvitationToken(inviteResult.data as string);
    setStatusMessage("Created a new invitation link. It expires in 14 days.");
  }

  async function copyLeagueInviteLink() {
    if (!currentLeagueInviteUrl) return setStatusMessage("Create or select a league before copying an invite link.");

    try {
      await navigator.clipboard.writeText(currentLeagueInviteUrl);
      setStatusMessage("Copied the league invite link.");
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not copy the invite link.");
    }
  }

  function openLeagueInviteEmail() {
    if (!currentLeagueInviteUrl || !currentLeague) return setStatusMessage("Create or select a league before sending an invite.");
    const subject = encodeURIComponent(`Join ${currentLeague.name} on Rat Race Golf`);
    const body = encodeURIComponent(`Join ${currentLeague.name} on Rat Race Golf:\n\n${currentLeagueInviteUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function openLeagueInviteSms() {
    if (!currentLeagueInviteUrl || !currentLeague) return setStatusMessage("Create or select a league before sending an invite.");
    const body = encodeURIComponent(`Join ${currentLeague.name} on Rat Race Golf: ${currentLeagueInviteUrl}`);
    window.location.href = `sms:?&body=${body}`;
  }

  async function addExistingMemberToLeague() {
    if (!user || !isSiteAdmin || !currentLeagueId) {
      setStatusMessage("Only a site admin can add accounts to leagues.");
      return;
    }

    const selectedProfile = siteProfiles.find((entry) => entry.id === newLeagueMemberId) ?? null;
    if (!selectedProfile) {
      setStatusMessage("Choose an account to add to this league.");
      return;
    }

    setBusy("Adding league member...");
    const { error } = await supabase.from("league_memberships").insert([{
      league_id: currentLeagueId,
      user_id: selectedProfile.id,
    }]);
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not add that account to this league.");
      return;
    }

    setNewLeagueMemberId("");
    setStatusMessage(`Added ${selectedProfile.username} to ${currentLeague?.name ?? "this league"}.`);
    await loadProfiles();
  }

  async function addAllExistingMembersToLeague() {
    if (!user || !isSiteAdmin || !currentLeagueId) {
      setStatusMessage("Only a site admin can add accounts to leagues.");
      return;
    }

    if (!availableSiteProfiles.length) {
      setStatusMessage("Every account is already in this league.");
      return;
    }

    setBusy("Adding all league members...");
    const { error } = await supabase.from("league_memberships").insert(
      availableSiteProfiles.map((entry) => ({
        league_id: currentLeagueId,
        user_id: entry.id,
      }))
    );
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not add all accounts to this league.");
      return;
    }

    setStatusMessage(`Added ${availableSiteProfiles.length} account${availableSiteProfiles.length === 1 ? "" : "s"} to ${currentLeague?.name ?? "this league"}.`);
    await loadProfiles();
  }

  async function saveProfile() {
    if (!user) return;
    const nextName = profileDraftName.trim();

    if (!nextName) {
      setStatusMessage("Display name cannot be empty.");
      return;
    }

    setBusy("Saving profile...");
    const { error } = await supabase
      .from("profiles")
      .update({
        username: nextName,
      })
      .eq("id", user.id);

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage(error.message || "Could not save your profile.");
      return;
    }

    setBusy("");

    setStatusMessage("Profile updated.");
    await loadProfile(user.id);
    if (canManageLeague) await loadProfiles();
  }

  async function loadSeasonStats() {
    const eligibleSessions = sessions.filter((session) =>
      (seasonStatsYear === "all" || (resolvedSessionSeasons[session.id] ?? sessionEventSeason(session)) === seasonStatsYear)
      &&
      (seasonStatsView === "all" || sessionCountsForSeason(session))
      && (session.status === "scored" || session.status === "finalized")
      && Object.keys(session.current_positions ?? {}).length > 0
    );
    if (!eligibleSessions.length) {
      setSeasonStats([]);
      return;
    }

    setSeasonStatsLoading(true);
    const sessionIds = eligibleSessions.map((session) => session.id);
    const [teamsResult, picksResult] = await Promise.all([
      supabase.from("draft_teams").select("*").in("session_id", sessionIds),
      supabase.from("draft_picks").select("*").in("session_id", sessionIds),
    ]);
    setSeasonStatsLoading(false);

    if (teamsResult.error || picksResult.error) {
      console.error(teamsResult.error, picksResult.error);
      setStatusMessage("Could not load season statistics.");
      return;
    }

    const seasonTeams = (teamsResult.data ?? []) as DraftTeam[];
    const ownerByHistoricalTeamName = new Map<string, string>();
    const ambiguousHistoricalTeamNames = new Set<string>();
    seasonTeams.forEach((team) => {
      if (!team.owner_user_id) return;
      const historicalKey = normalizeName(team.name);
      const existingOwner = ownerByHistoricalTeamName.get(historicalKey);
      if (existingOwner && existingOwner !== team.owner_user_id) {
        ambiguousHistoricalTeamNames.add(historicalKey);
        ownerByHistoricalTeamName.delete(historicalKey);
        return;
      }
      if (!ambiguousHistoricalTeamNames.has(historicalKey)) ownerByHistoricalTeamName.set(historicalKey, team.owner_user_id);
    });

    const teamsBySession = new Map<string, DraftTeam[]>();
    seasonTeams.forEach((team) => {
      const existing = teamsBySession.get(team.session_id) ?? [];
      existing.push(team);
      teamsBySession.set(team.session_id, existing);
    });

    const picksBySession = new Map<string, DraftPick[]>();
    ((picksResult.data ?? []) as DraftPick[]).forEach((pick) => {
      const existing = picksBySession.get(pick.session_id) ?? [];
      existing.push(pick);
      picksBySession.set(pick.session_id, existing);
    });

    const aggregate = new Map<string, SeasonTeamStat>();

    eligibleSessions.forEach((session) => {
      const sessionTeams = getAssignedActiveTeams(teamsBySession.get(session.id) ?? []);
      const sessionPicks = (picksBySession.get(session.id) ?? []).sort((a, b) => a.pick_number - b.pick_number);
      const positions = normalizeStoredPlayoffPositions(session.current_positions ?? {}, session.current_totals ?? {});
      const totals = session.current_totals ?? {};
      const hasSavedLeaderboard = Object.keys(positions).length > 0 || Object.keys(totals).length > 0;

        const sessionLeaderboard = sessionTeams.map((team) => {
          const playerScores = sessionPicks.filter((pick) => pick.team_id === team.id).map((pick) => {
            const position = lookupLeaderboardValue(pick.player_name, positions) ?? null;
            const storedTotal = lookupLeaderboardValue(pick.player_name, totals) ?? null;
            const missingFromSavedLeaderboard = hasSavedLeaderboard && position === null && storedTotal === null;
            const parsedTotal = missingFromSavedLeaderboard ? "WD" : parseStoredTotal(storedTotal);
            const parsedThru = missingFromSavedLeaderboard ? "WD" : parseStoredThru(storedTotal);
            const normalizedResult = normalizeLegacyNonScoringResult(position, parsedTotal, parsedThru);
            return {
              pick,
              position,
              points: pointsForPosition(position),
              total: normalizedResult.total,
              thru: normalizedResult.thru,
              toPar: numericGolfScore(normalizedResult.total),
            };
          });
        const countingPlayers = [...playerScores].sort((a, b) => b.points - a.points || a.pick.pick_number - b.pick.pick_number).slice(0, 3);
        const total = countingPlayers.reduce((sum, player) => sum + player.points, 0);
        const numericCountingScores = countingPlayers.map((player) => player.toPar).filter((score): score is number => score !== null);
        const golferSelections = Object.fromEntries(playerScores.map((player) => [
          normalizeName(player.pick.player_name),
          { name: player.pick.player_name, count: 1, points: player.points },
        ]));
        const effectiveOwnerId = team.owner_user_id ?? ownerByHistoricalTeamName.get(normalizeName(team.name)) ?? null;
        const teamName = team.name;
        const teamKey = effectiveOwnerId ? `owner:${effectiveOwnerId}` : `name:${normalizeName(teamName)}`;
        return {
          teamKey,
          teamName,
          total,
          totalToPar: numericCountingScores.reduce((sum, score) => sum + score, 0),
          toParScores: numericCountingScores.length,
          golferSelections,
          cuts: playerScores.filter((player) => player.total === "CUT" || player.thru === "CUT").length,
          completedGolferResults: playerScores.filter((player) => player.position !== null || isNonScoringResult(player.total, player.thru)).length,
        };
      }).sort((a, b) => b.total - a.total);

      sessionLeaderboard.forEach((entry, index) => {
        const current = aggregate.get(entry.teamKey) ?? {
          teamName: entry.teamName,
          eventsPlayed: 0,
          wins: 0,
          top3: 0,
          seasonPoints: 0,
          bestFinish: null,
          lastTotal: null,
          totalToPar: 0,
          toParScores: 0,
          golferSelections: {},
          mostDraftedGolfer: null,
          mostDraftedCount: 0,
          mostSuccessfulGolfer: null,
          mostSuccessfulGolferPoints: 0,
          uniqueGolfers: 0,
          cuts: 0,
          completedGolferResults: 0,
          bestEventPoints: 0,
        };

        const finish = index === 0 || entry.total !== sessionLeaderboard[index - 1].total
          ? index + 1
          : sessionLeaderboard.findIndex((rankedEntry) => rankedEntry.total === entry.total) + 1;
        current.eventsPlayed += 1;
        current.seasonPoints += entry.total;
        current.lastTotal = entry.total;
        current.bestEventPoints = Math.max(current.bestEventPoints, entry.total);
        current.totalToPar += entry.totalToPar;
        current.toParScores += entry.toParScores;
        current.cuts += entry.cuts;
        current.completedGolferResults += entry.completedGolferResults;
        Object.entries(entry.golferSelections).forEach(([golferKey, golfer]) => {
          const selection = current.golferSelections[golferKey] ?? { name: golfer.name, count: 0, points: 0 };
          selection.count += golfer.count;
          selection.points += golfer.points;
          current.golferSelections[golferKey] = selection;
        });
        current.bestFinish = current.bestFinish === null ? finish : Math.min(current.bestFinish, finish);
        if (finish === 1) current.wins += 1;
        if (finish <= 3) current.top3 += 1;
        current.teamName = entry.teamName;
        aggregate.set(entry.teamKey, current);
      });
    });

    const consolidated = new Map<string, SeasonTeamStat>();
    aggregate.forEach((entry) => {
      const key = normalizeName(entry.teamName);
      const current = consolidated.get(key);
      if (!current) {
        consolidated.set(key, { ...entry });
        return;
      }
      current.eventsPlayed += entry.eventsPlayed;
      current.wins += entry.wins;
      current.top3 += entry.top3;
      current.seasonPoints += entry.seasonPoints;
      current.bestEventPoints = Math.max(current.bestEventPoints, entry.bestEventPoints);
      current.totalToPar += entry.totalToPar;
      current.toParScores += entry.toParScores;
      current.cuts += entry.cuts;
      current.completedGolferResults += entry.completedGolferResults;
      Object.entries(entry.golferSelections).forEach(([golferKey, golfer]) => {
        const selection = current.golferSelections[golferKey] ?? { name: golfer.name, count: 0, points: 0 };
        selection.count += golfer.count;
        selection.points += golfer.points;
        current.golferSelections[golferKey] = selection;
      });
      current.bestFinish = current.bestFinish === null
        ? entry.bestFinish
        : entry.bestFinish === null
          ? current.bestFinish
          : Math.min(current.bestFinish, entry.bestFinish);
      current.lastTotal = entry.lastTotal ?? current.lastTotal;
    });

    setSeasonStats(
      Array.from(consolidated.values()).map((entry) => {
        const selections = Object.values(entry.golferSelections).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        const successfulGolfers = [...Object.values(entry.golferSelections)].sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name));
        return {
          ...entry,
          mostDraftedGolfer: selections[0]?.name ?? null,
          mostDraftedCount: selections[0]?.count ?? 0,
          mostSuccessfulGolfer: successfulGolfers[0]?.name ?? null,
          mostSuccessfulGolferPoints: successfulGolfers[0]?.points ?? 0,
          uniqueGolfers: selections.length,
        };
      }).sort((a, b) => {
        if (b.seasonPoints !== a.seasonPoints) return b.seasonPoints - a.seasonPoints;
        return a.teamName.localeCompare(b.teamName);
      })
    );
  }

  async function assignTeamOwner(team: DraftTeam, ownerUserId: string) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can assign teams.");
      return;
    }

    const ownerId = ownerUserId || null;
    const selectedProfile = profiles.find((entry) => entry.id === ownerId) ?? null;
    const nextTeamName = team.name;

    await updateTeam(
      team.id,
      { owner_user_id: ownerId, name: nextTeamName },
      ownerId ? `Assigned ${team.name} to ${selectedProfile?.username ?? "that member"}.` : `Removed the owner for ${team.name}.`
    );
    await loadProfiles();
    if (currentSession) await loadSession(currentSession.id, false, false);
  }

  async function updateMemberRole(profileEntry: Profile, nextRole: "assistant_commissioner" | "member") {
    if (!canManagePermissions) {
      setStatusMessage("Only the commissioner can change member permissions.");
      return;
    }

    setBusy("Updating member access...");
    const { error } = await supabase.rpc("set_member_role", {
      target_league_id: currentLeagueId,
      target_user_id: profileEntry.id,
      next_role: nextRole,
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not update that member access level.");
      return;
    }

    setStatusMessage(`Updated ${profileEntry.username} to ${roleLabel(nextRole).toLowerCase()}.`);
    await loadProfiles();
    if (currentSession) await loadSession(currentSession.id, false, false);
  }

  async function removeMember(profileEntry: Profile) {
    if (!canManagePermissions) {
      setStatusMessage("Only the commissioner can remove members.");
      return;
    }
    if (profileEntry.role === "commissioner") {
      setStatusMessage("Commissioner accounts cannot be removed here.");
      return;
    }
    if (!window.confirm(`Remove ${profileEntry.username}'s account? This will also unassign them from any owned teams.`)) {
      return;
    }

    setBusy("Removing member...");
    const { error } = await supabase.rpc("remove_member_account", {
      target_league_id: currentLeagueId,
      target_user_id: profileEntry.id,
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not remove that member.");
      return;
    }

    setStatusMessage(`Removed ${profileEntry.username}'s account.`);
    await loadProfiles();
    await loadSessions();
    if (currentSession) await loadSession(currentSession.id, false, false);
  }

  async function signOut() {
    setBusy("Signing out...");
    const { error } = await supabase.auth.signOut();
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage("Could not sign you out.");
      return;
    }

    setStatusMessage("Signed out.");
  }

  async function loadSessions() {
    if (!currentLeagueId) {
      setSessions([]);
      setSessionsLoaded(true);
      return;
    }
    const { data, error } = await supabase.from("draft_sessions").select("*").eq("league_id", currentLeagueId).order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setStatusMessage("Could not load tournament sessions from Supabase.");
      setSessionsLoaded(true);
      return;
    }
    setSessions((data ?? []) as DraftSession[]);
    setSessionsLoaded(true);
  }

  async function loadSessionEventDates(sessionList: DraftSession[]) {
    const requestId = ++sessionDateLoadRequestRef.current;
    const tours = Array.from(new Set(sessionList.map((session) => session.event_tour ?? "pga")));
    const seasons = Array.from(new Set([
      ...HISTORICAL_SEASONS,
      ...sessionList.map(sessionEventSeason),
    ]));
    const eventCollections = await Promise.all(tours.flatMap((tour) => seasons.map(async (season) => {
      try {
        const response = await fetch(`/api/data-golf?action=app-events&tour=${encodeURIComponent(tour)}&season=${season}`, LIVE_DATA_FETCH_OPTIONS);
        const payload = await readJsonResponse<EventsResponse>(response);
        return payload?.ok && payload.events ? payload.events : [];
      } catch (error) {
        console.error(error);
        return [];
      }
    })));
    const eventsById = new Map(eventCollections.flat().map((event) => [event.id, event]));
    const dateEntries: Array<readonly [string, string]> = [];
    const seasonEntries: Array<readonly [string, number]> = [];
    sessionList.forEach((session) => {
      if (!session.event_id) return;
      const event = eventsById.get(session.event_id);
      if (event?.startDate) dateEntries.push([session.id, event.startDate]);
      if (event?.season) seasonEntries.push([session.id, event.season]);
    });
    if (requestId === sessionDateLoadRequestRef.current) {
      setSessionEventDates(Object.fromEntries(dateEntries));
      setResolvedSessionSeasons(Object.fromEntries(seasonEntries));
      setSessionDatesLoaded(true);
    }
  }

  async function loadSession(sessionId: string, setLoading = true, syncTab = true) {
    if (setLoading) setBusy("Loading session...");
    const [sessionResult, teamsResult, picksResult] = await Promise.all([
      supabase.from("draft_sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("draft_teams").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      supabase.from("draft_picks").select("*").eq("session_id", sessionId).order("pick_number", { ascending: true }),
    ]);
    if (sessionResult.error || teamsResult.error || picksResult.error) {
      console.error(sessionResult.error, teamsResult.error, picksResult.error);
      setStatusMessage("Could not load the selected draft session.");
      setBusy("");
      return;
    }
    const nextSession = (sessionResult.data as DraftSession | null) ?? null;
    setCurrentSession(nextSession);
    setTeams((teamsResult.data as DraftTeam[]) ?? []);
    setPicks((picksResult.data as DraftPick[]) ?? []);
    if (syncTab) {
      if (nextSession?.status === "draft_complete" || nextSession?.status === "scored" || nextSession?.status === "finalized") {
        setActiveRoomTab("results");
      } else if (activeRoomTab === "results" && nextSession?.status === "setup") {
        setActiveRoomTab("draft");
      }
    }
    setBusy("");
  }

  async function loadEvents(tourId = newDraftTour, season = newDraftSeason) {
    const requestId = ++eventLoadRequestRef.current;
    setEvents([]);
    setNewSessionEventId("");
    try {
      const response = await fetch(`/api/data-golf?action=app-events&tour=${encodeURIComponent(tourId)}&season=${season}`, LIVE_DATA_FETCH_OPTIONS);
      const payload = await readJsonResponse<EventsResponse>(response);
      if (!payload?.ok || !payload.events) throw new Error(payload?.error ?? "Data Golf did not return events.");
      if (requestId !== eventLoadRequestRef.current) return;
      setEvents(payload.events);
      setNewSessionEventId((current) => payload.events?.some((event) => event.id === current) ? current : preferredEventId(payload.events ?? []));
    } catch (error) {
      if (requestId !== eventLoadRequestRef.current) return;
      console.error(error);
      setEvents([]);
      setNewSessionEventId("");
      setStatusMessage(`Could not load ${season} ${TOUR_OPTIONS.find((tour) => tour.id === tourId)?.label ?? "tour"} events from Data Golf.`);
    }
  }

  async function loadCurrentSessionEventDetails() {
    if (!currentSession?.event_id) {
      setCurrentSessionEventDetails(null);
      return;
    }

    try {
      const toursToCheck = currentSession.event_tour ? [currentSession.event_tour] : TOUR_OPTIONS.map((tour) => tour.id);
      for (const tourId of toursToCheck) {
        const seasonQuery = resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession);
        const response = await fetch(`/api/data-golf?action=app-events&tour=${encodeURIComponent(tourId)}&season=${seasonQuery}`, LIVE_DATA_FETCH_OPTIONS);
        const payload = await readJsonResponse<EventsResponse>(response);
        if (!payload?.ok || !payload.events) continue;
        const eventDetails = payload.events.find((event) => event.id === currentSession.event_id) ?? null;
        if (eventDetails) {
          setCurrentSessionEventDetails(eventDetails);
          return;
        }
      }
      setCurrentSessionEventDetails(null);
    } catch (error) {
      console.error(error);
      setCurrentSessionEventDetails(null);
    }
  }

  async function loadOdds(eventName: string, season = CURRENT_GOLF_SEASON) {
    try {
      const response = await fetch(`/api/data-golf?action=app-odds&tour=${encodeURIComponent(currentSession?.event_tour ?? newDraftTour)}&market=win&odds_format=american`, LIVE_DATA_FETCH_OPTIONS);
      const payload = await readJsonResponse<OddsResponse>(response);
      if (!payload?.ok || !payload.odds) {
        setOddsByPlayer({});
        return;
      }
      setOddsByPlayer(payload.odds);
    } catch (error) {
      console.error(error);
      setOddsByPlayer({});
    }
  }

  async function updateSession(patch: Partial<DraftSession>, message: string) {
    if (!currentSession) return false;
    const supportedPatch = { ...patch };
    let { error } = await supabase.from("draft_sessions").update(supportedPatch).eq("id", currentSession.id);
    for (const optionalColumn of ["event_tour", "event_season", "counts_for_season"] as const) {
      if (!error || !(optionalColumn in supportedPatch) || !isMissingColumnError(error, optionalColumn)) continue;
      delete supportedPatch[optionalColumn];
      const fallbackResult = await supabase.from("draft_sessions").update(supportedPatch).eq("id", currentSession.id);
      error = fallbackResult.error;
    }
    if (error) {
      console.error(error);
      setStatusMessage(error.message ? `Could not save the tournament changes: ${error.message}` : "Could not save the tournament changes.");
      return false;
    }
    setStatusMessage(message);
    await loadSessions();
    await loadSession(currentSession.id, false, false);
    return true;
  }

  async function setSessionCountsForSeason(session: DraftSession, countsForSeason: boolean) {
    if (!canManageLeague) return;
    const previousValue = sessionCountsForSeason(session);
    const nextManualInput = manualLeaderboardWithSeasonSetting(session.manual_leaderboard_input, countsForSeason);
    const optimisticSession = { ...session, counts_for_season: countsForSeason, manual_leaderboard_input: nextManualInput };
    setSessions((current) => current.map((entry) => entry.id === session.id ? optimisticSession : entry));
    setCurrentSession((current) => current?.id === session.id ? { ...current, ...optimisticSession } : current);
    setBusy("Updating season schedule...");
    let { data, error } = await supabase
      .from("draft_sessions")
      .update({ counts_for_season: countsForSeason, manual_leaderboard_input: nextManualInput })
      .eq("id", session.id)
      .select("id, counts_for_season")
      .maybeSingle();

    if (error && isMissingColumnError(error, "counts_for_season")) {
      const fallback = await supabase
        .from("draft_sessions")
        .update({ manual_leaderboard_input: nextManualInput })
        .eq("id", session.id)
        .select("id")
        .maybeSingle();
      data = fallback.data ? { id: fallback.data.id, counts_for_season: countsForSeason } : null;
      error = fallback.error;
    }
    setBusy("");

    if (error || !data) {
      console.error(error);
      const revertedManualInput = manualLeaderboardWithSeasonSetting(session.manual_leaderboard_input, previousValue);
      setSessions((current) => current.map((entry) => entry.id === session.id ? { ...entry, counts_for_season: previousValue, manual_leaderboard_input: revertedManualInput } : entry));
      setCurrentSession((current) => current?.id === session.id ? { ...current, counts_for_season: previousValue, manual_leaderboard_input: revertedManualInput } : current);
      setStatusMessage("The season setting could not be saved. Confirm that your account is a league commissioner or assistant commissioner.");
      return;
    }

    setStatusMessage(`${session.event_name ?? session.name} ${countsForSeason ? "now counts" : "no longer counts"} toward season stats.`);
  }

  async function saveFieldSnapshot(sessionId: string, field: Awaited<ReturnType<typeof fetchDataGolfFieldInput>>, eventName: string | null | undefined, message: string) {
    const refreshedAt = new Date().toISOString();
    const snapshotPatch = {
      player_input: field.playerInput,
      event_name: field.eventName ?? eventName ?? null,
      field_source: field.fieldSource,
      field_refreshed_at: refreshedAt,
      odds_snapshot: field.odds,
      odds_source: field.oddsSource,
      odds_refreshed_at: field.oddsCount ? refreshedAt : null,
    };

    const { error } = await supabase.from("draft_sessions").update(snapshotPatch).eq("id", sessionId);
    if (error) {
      console.error(error);
      const fallback = await supabase.from("draft_sessions").update({ player_input: field.playerInput, event_name: field.eventName ?? eventName ?? null }).eq("id", sessionId);
      if (fallback.error) {
        console.error(fallback.error);
        setStatusMessage("Could not save the refreshed player field.");
        return false;
      }
    }

    setPlayerPoolDraft(field.playerInput);
    setOddsByPlayer(field.odds);
    setStatusMessage(message);
    await loadSessions();
    await loadSession(sessionId, false, false);
    return true;
  }

  async function updateTeam(teamId: string, patch: Partial<DraftTeam>, message?: string) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can edit teams and draft order.");
      return false;
    }
    const { error } = await supabase.from("draft_teams").update(patch).eq("id", teamId);
    if (error) {
      console.error(error);
      setStatusMessage("Could not save the team update.");
      return false;
    }
    if (message) setStatusMessage(message);
    return true;
  }

  async function moveDraftTeam(teamId: string, direction: -1 | 1) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can edit draft order.");
    if (picks.length) return setStatusMessage("Draft order is locked after the first pick. Undo picks before changing it.");
    const orderedTeams = getAssignedActiveTeams(teams);
    const currentIndex = orderedTeams.findIndex((team) => team.id === teamId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedTeams.length) return;

    const currentTeam = orderedTeams[currentIndex];
    const targetTeam = orderedTeams[targetIndex];
    const currentSlot = currentTeam.draft_slot ?? currentIndex + 1;
    const targetSlot = targetTeam.draft_slot ?? targetIndex + 1;

    setTeams((current) => current.map((team) => {
      if (team.id === currentTeam.id) return { ...team, draft_slot: targetSlot };
      if (team.id === targetTeam.id) return { ...team, draft_slot: currentSlot };
      return team;
    }));

    const [firstUpdate, secondUpdate] = await Promise.all([
      supabase.from("draft_teams").update({ draft_slot: targetSlot }).eq("id", currentTeam.id),
      supabase.from("draft_teams").update({ draft_slot: currentSlot }).eq("id", targetTeam.id),
    ]);

    if (firstUpdate.error || secondUpdate.error) {
      console.error(firstUpdate.error, secondUpdate.error);
      setStatusMessage("Could not save the draft order change.");
      await loadSession(selectedSessionId, false, false);
      return;
    }

    setStatusMessage(`Moved ${currentTeam.name} to draft slot ${targetSlot}.`);
    await loadSession(selectedSessionId, false, false);
  }

  async function addTeam() {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can add teams.");
      return;
    }
    if (!currentSession) return;

    const trimmedName = newTeamName.trim();
    if (!trimmedName) {
      setStatusMessage("Type a team name before adding a new team.");
      return;
    }

    if (teams.some((team) => normalizeName(team.name) === normalizeName(trimmedName))) {
      setStatusMessage("That team name already exists.");
      return;
    }

    setBusy("Adding team...");
    const { error } = await supabase.from("draft_teams").insert([
      {
        session_id: currentSession.id,
        name: trimmedName,
        draft_slot: null,
        active: false,
      },
    ]);

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not add the new team.");
      return;
    }

    setNewTeamName("");
    setBusy("");
    setStatusMessage(`Added team "${trimmedName}".`);
    await loadSession(currentSession.id, false, false);
  }

  async function deleteTeam(team: DraftTeam) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can delete teams.");
      return;
    }
    if (team.draft_slot !== null) {
      setStatusMessage("Remove that team from the draft order before deleting it.");
      return;
    }

    setBusy("Deleting team...");
    const { error } = await supabase.from("draft_teams").delete().eq("id", team.id);

    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not delete that team.");
      return;
    }

    setBusy("");
    setStatusMessage(`Deleted team "${team.name}".`);
    await loadSession(selectedSessionId, false, false);
  }

  async function deleteSession(session: DraftSession) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can delete sessions.");
      return;
    }
    if (!window.confirm(`Delete "${session.name}"? This removes the session, draft order, picks, and saved scoring.`)) return;
    setBusy("Deleting session...");
    const { error } = await supabase.from("draft_sessions").delete().eq("id", session.id);
    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not delete that session.");
      return;
    }
    setSelectedSessionId((current) => current === session.id ? "" : current);
    setBusy("");
    setStatusMessage(`Deleted session "${session.name}".`);
    await loadSessions();
  }

  function resetNewDraftForm() {
    setNewDraftTeams(profiles.map((entry) => ({ name: entry.username, selected: true, ownerUserId: entry.id })));
    setNewDraftTeamName("");
    setNewSessionCountsForSeason(true);
    setDraggedNewDraftTeam("");
    setDragOverNewDraftTeam("");
    if (events[0]?.id) setNewSessionEventId(events[0].id);
  }

  function openNewDraftModal() {
    resetNewDraftForm();
    setNewDraftModalOpen(true);
  }

  function addNewDraftTeam() {
    const teamName = newDraftTeamName.trim();
    if (!teamName) return;
    if (newDraftTeams.some((team) => normalizeName(team.name) === normalizeName(teamName))) {
      setStatusMessage("That team is already in this draft.");
      return;
    }
    setNewDraftTeams((current) => [...current, { name: teamName, selected: true, ownerUserId: null }]);
    setNewDraftTeamName("");
  }

  function toggleNewDraftTeam(teamName: string) {
    setNewDraftTeams((current) => {
      const team = current.find((entry) => entry.name === teamName);
      if (!team) return current;
      const remaining = current.filter((entry) => entry.name !== teamName);
      const selected = remaining.filter((entry) => entry.selected);
      const unselected = remaining.filter((entry) => !entry.selected);
      const toggledTeam = { ...team, selected: !team.selected };
      return toggledTeam.selected ? [...selected, toggledTeam, ...unselected] : [...selected, ...unselected, toggledTeam];
    });
  }

  function moveNewDraftTeam(draggedTeamName: string, targetTeamName: string) {
    if (!draggedTeamName || draggedTeamName === targetTeamName) return;
    setNewDraftTeams((current) => {
      const draggedIndex = current.findIndex((team) => team.name === draggedTeamName);
      const targetIndex = current.findIndex((team) => team.name === targetTeamName);
      if (draggedIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [draggedTeam] = next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedTeam);
      return next;
    });
  }

  function startNewDraftTeamDrag(event: DragEvent<HTMLDivElement>, teamName: string) {
    if (event.target instanceof HTMLElement && event.target.closest("input, label, select, button")) {
      event.preventDefault();
      return;
    }
    setDraggedNewDraftTeam(teamName);
    setDragOverNewDraftTeam(teamName);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", teamName);
  }

  function dragNewDraftTeamOver(event: DragEvent<HTMLDivElement>, targetTeamName: string, targetSelected: boolean) {
    if (!targetSelected) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!draggedNewDraftTeam || draggedNewDraftTeam === targetTeamName || dragOverNewDraftTeam === targetTeamName) return;
    setDragOverNewDraftTeam(targetTeamName);
    moveNewDraftTeam(draggedNewDraftTeam, targetTeamName);
  }

  function finishNewDraftTeamDrag() {
    setDraggedNewDraftTeam("");
    setDragOverNewDraftTeam("");
  }

  function randomizeNewDraftOrder() {
    setNewDraftTeams((current) => {
      const selected = shuffled(current.filter((team) => team.selected));
      const unselected = current.filter((team) => !team.selected);
      return [...selected, ...unselected];
    });
    setStatusMessage("Randomized the draft order with browser crypto randomness.");
  }

  async function copyTeamsAndOpenDuckRace() {
    const selectedTeamNames = newDraftTeams.filter((team) => team.selected).map((team) => team.name);
    if (!selectedTeamNames.length) {
      setStatusMessage("Select at least one team before opening Duck Race.");
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedTeamNames.join("\n"));
      setStatusMessage("Copied the selected teams. Paste them into Duck Race if you want a visual race.");
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not copy the team list, but Duck Race is opening.");
    }

    window.open("https://www.online-stopwatch.com/duck-race/", "_blank", "noopener,noreferrer");
  }

  async function fetchDataGolfFieldInput(eventId: string, tourId: string | null | undefined, season = CURRENT_GOLF_SEASON) {
    const tourQuery = tourId ? `&tour=${encodeURIComponent(tourId)}` : "";
    let response = await fetch(`/api/data-golf?action=app-field&eventId=${encodeURIComponent(eventId)}${tourQuery}&season=${season}`, LIVE_DATA_FETCH_OPTIONS);
    let payload = await readJsonResponse<FieldResponse>(response);
    if (!payload?.ok && !eventId.startsWith("dg:")) {
      response = await fetch(`/api/espn-golf?action=field&eventId=${encodeURIComponent(eventId)}${tourQuery}&season=${season}`, LIVE_DATA_FETCH_OPTIONS);
      payload = await readJsonResponse<FieldResponse>(response);
    }
    if (!payload?.ok || !payload.players?.length) throw new Error(payload?.error || "Data Golf did not return any golfers for that event yet.");
    const cleanedPlayers = parsePlayerPoolInput(payload.players.join("\n"));
    if (!cleanedPlayers.length) throw new Error("Data Golf returned a field, but no valid golfer names were found.");
    let odds: Record<string, number> = payload.odds ?? {};
    let oddsSource = payload.oddsSource ?? "";
    if (!Object.keys(odds).length && payload.eventName) {
      try {
        const oddsResponse = await fetch(`/api/data-golf?action=app-odds${tourQuery}&market=win&odds_format=american`, LIVE_DATA_FETCH_OPTIONS);
        const oddsPayload = await readJsonResponse<OddsResponse>(oddsResponse);
        odds = oddsPayload?.ok && oddsPayload.odds ? oddsPayload.odds : {};
        oddsSource = oddsPayload?.source ?? "";
      } catch (error) {
        console.error(error);
      }
    }
    const basePlayerInput = formatPlayerPoolInput(payload.players.join("\n"));
    const playerInput = Object.keys(odds).length ? formatPlayerPoolInputWithOdds(basePlayerInput, odds) : basePlayerInput;
    return {
      eventName: payload.eventName,
      playerInput,
      playerCount: cleanedPlayers.length,
      fieldSource: payload.source ?? "",
      odds,
      oddsSource,
      oddsCount: Object.keys(odds).length,
    };
  }

  async function createSession() {
    if (!canManageLeague || !user || !currentLeagueId) return setStatusMessage("Only a league admin can create new tournament sessions.");
    const event = events.find((item) => item.id === newSessionEventId) ?? null;
    if (!event) return setStatusMessage("Select a tournament before creating the draft room.");
    const trimmedName = event.name.trim();
    const selectedDraftTeams = newDraftTeams.filter((team) => team.selected);
    if (!selectedDraftTeams.length) return setStatusMessage("Select at least one team for this draft.");
    setBusy("Creating session...");
    let playerInput = "";
    let importedPlayerCount = 0;
    let importedOddsCount = 0;
    let fieldImportMessage = "";
    let importedField: Awaited<ReturnType<typeof fetchDataGolfFieldInput>> | null = null;
    try {
      const field = await fetchDataGolfFieldInput(event.id, newDraftTour, newDraftSeason);
      importedField = field;
      playerInput = field.playerInput;
      importedPlayerCount = field.playerCount;
      importedOddsCount = field.oddsCount;
      setOddsByPlayer(field.odds);
    } catch (error) {
      console.error(error);
      fieldImportMessage = error instanceof Error && error.message ? ` Data Golf field was not imported: ${error.message}` : " Data Golf field was not imported yet.";
    }
    const sessionPayload = { league_id: currentLeagueId, tournament_id: event.catalogId ?? null, event_tour: newDraftTour, event_season: newDraftSeason, counts_for_season: newSessionCountsForSeason, name: trimmedName, event_id: event.id, event_name: event.name, player_input: playerInput, manual_leaderboard_input: manualLeaderboardWithEventSeason("", newDraftSeason, newSessionCountsForSeason), current_positions: {}, current_totals: {}, status: "setup", commissioner_id: user.id };
    let sessionInsert = await supabase.from("draft_sessions").insert([sessionPayload]).select("*").single();
    if (sessionInsert.error && (
      isMissingColumnError(sessionInsert.error, "event_tour")
      || isMissingColumnError(sessionInsert.error, "event_season")
      || isMissingColumnError(sessionInsert.error, "counts_for_season")
      || isMissingColumnError(sessionInsert.error, "tournament_id")
    )) {
      const fallbackPayload: Record<string, unknown> = { ...sessionPayload };
      delete fallbackPayload.event_tour;
      delete fallbackPayload.event_season;
      delete fallbackPayload.counts_for_season;
      delete fallbackPayload.tournament_id;
      sessionInsert = await supabase.from("draft_sessions").insert([fallbackPayload]).select("*").single();
    }
    if (sessionInsert.error || !sessionInsert.data) {
      console.error(sessionInsert.error);
      setBusy("");
      return setStatusMessage(`Could not create the tournament session${sessionInsert.error?.message ? `: ${sessionInsert.error.message}` : "."}`);
    }
    const teamsInsert = await supabase.from("draft_teams").insert(newDraftTeams.map((team) => ({
      session_id: sessionInsert.data.id,
      name: team.name,
      draft_slot: team.selected ? selectedDraftTeams.findIndex((entry) => entry.name === team.name) + 1 : null,
      active: team.selected,
      owner_user_id: team.ownerUserId,
    })));
    if (teamsInsert.error) {
      console.error(teamsInsert.error);
      setBusy("");
      return setStatusMessage(`The session was created, but the teams were not saved${teamsInsert.error.message ? `: ${teamsInsert.error.message}` : "."}`);
    }
    resetNewDraftForm();
    setNewDraftModalOpen(false);
    setSelectedSessionId(sessionInsert.data.id);
    if (importedField) {
      await saveFieldSnapshot(sessionInsert.data.id, importedField, event.name, `Created live draft session "${sessionInsert.data.name}" with ${importedPlayerCount} golfers${importedOddsCount ? " and betting odds" : ""}.`);
    } else {
      setStatusMessage(`Created live draft session "${sessionInsert.data.name}".${fieldImportMessage}`);
    }
    setActiveRoomTab("draft");
    setBusy("");
    if (!importedField) await loadSessions();
  }

  async function normalizeDraftOrder() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can repair the draft order.");
    const orderedTeams = getAssignedActiveTeams(teams);
    for (const [index, team] of orderedTeams.entries()) {
      const targetSlot = index + 1;
      if (team.draft_slot !== targetSlot) {
        await updateTeam(team.id, { draft_slot: targetSlot });
      }
    }
    setStatusMessage("Repaired the draft order.");
    await loadSession(selectedSessionId, false, false);
  }

    async function savePlayerPool() {
      if (!canManageLeague) return setStatusMessage("Only the commissioner can save the player pool.");
      if (picks.length) return setStatusMessage("The field and odds are locked after the first pick. Undo picks before changing the player pool.");
      setBusy("Saving player pool...");
      const cleanedPlayers = parsePlayerPoolInput(playerPoolDraft);
      if (!cleanedPlayers.length) {
        setBusy("");
        return setStatusMessage("I could not find any valid golfer names. Paste one player per line, or team pairs like Rory McIlroy / Shane Lowry.");
      }
      const cleanedPlayerInput = formatPlayerPoolInput(playerPoolDraft);
      setPlayerPoolDraft(cleanedPlayerInput);
      await updateSession({ player_input: cleanedPlayerInput }, `Saved ${cleanedPlayers.length} golfers in the player pool.`);
      setBusy("");
  }

  async function importFieldFromDataGolf() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can import the field.");
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before importing the field.");
    if (picks.length) return setStatusMessage("The field and odds are locked after the first pick. Reopen this only by undoing picks first.");
    setBusy("Importing field...");
    try {
        const field = await fetchDataGolfFieldInput(currentSession.event_id, currentSession.event_tour, resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession));
        await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Imported ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} from Data Golf after cleaning duplicates, team rows, and invalid rows.`);
      } catch (error) {
        console.error(error);
        const tourLabel = TOUR_OPTIONS.find((tour) => tour.id === currentSession.event_tour)?.label ?? "the selected tour";
        setStatusMessage(error instanceof Error && error.message ? `${tourLabel}: ${error.message}` : `Could not import the player field from ${tourLabel}.`);
      }
      setBusy("");
    }

  async function autoImportMissingPlayerPool() {
    if (!canManageLeague || !currentSession?.id || !currentSession.event_id) return;
    if (!storedEventSeason(currentSession.manual_leaderboard_input) && !resolvedSessionSeasons[currentSession.id]) return;
    if (picks.length) return;
    if (currentSession.player_input?.trim()) return;
    if (autoFieldImportAttempts[currentSession.id]) return;

    setAutoFieldImportAttempts((current) => ({ ...current, [currentSession.id]: true }));
    setBusy("Importing Data Golf field...");
    try {
      const field = await fetchDataGolfFieldInput(currentSession.event_id, currentSession.event_tour, resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession));
      await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Auto-imported ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} from Data Golf.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error && error.message ? `Auto import failed: ${error.message}` : "Auto import failed. Use Setup to import the field manually.");
    }
    setBusy("");
  }

  async function autoRefreshFieldBeforeDraft() {
    if (!canManageLeague || activeRoomTab !== "draft" || !currentSession?.id || !currentSession.event_id) return;
    if (!storedEventSeason(currentSession.manual_leaderboard_input) && !resolvedSessionSeasons[currentSession.id]) return;
    if (picks.length || autoFieldRefreshAttempts[currentSession.id]) return;

    const fieldRefreshedAt = currentSession.field_refreshed_at ? new Date(currentSession.field_refreshed_at).getTime() : 0;
    const oddsRefreshedAt = currentSession.odds_refreshed_at ? new Date(currentSession.odds_refreshed_at).getTime() : 0;
    const oldestRefresh = Math.min(fieldRefreshedAt || Number.POSITIVE_INFINITY, oddsRefreshedAt || Number.POSITIVE_INFINITY);
    const sixHours = 6 * 60 * 60 * 1000;
    const needsRefresh = !fieldRefreshedAt || !oddsRefreshedAt || Date.now() - oldestRefresh > sixHours;
    if (!needsRefresh) return;

    setAutoFieldRefreshAttempts((current) => ({ ...current, [currentSession.id]: true }));
    setBusy("Refreshing field and odds...");
    try {
      const field = await fetchDataGolfFieldInput(currentSession.event_id, currentSession.event_tour, resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession));
      await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Refreshed ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} before the draft started.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error && error.message ? `Refresh failed: ${error.message}` : "Refresh failed. Use Setup to refresh the field manually.");
    }
    setBusy("");
  }

  async function refreshResultsView() {
    if (!currentSession) return;
    const sessionId = currentSession.id;
    setBusy("Refreshing view...");
    try {
      await loadSessions();
      await loadSession(sessionId, false, false);
      if (activeRoomTab === "results" && currentSession.event_id) {
        await loadTournamentLeaderboard(false);
      }
      setStatusMessage("Refreshed the latest saved leaderboard view.");
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not refresh the leaderboard view.");
    }
    setBusy("");
  }

  async function pullLeaderboard() {
    if (!canManageLeague) return refreshResultsView();
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before pulling leaderboard results.");
    if (currentSession.status === "finalized") return setStatusMessage("This tournament is finalized. Reopen results before refreshing the leaderboard.");
    setBusy("Pulling leaderboard...");
    try {
      const tourQuery = currentSession.event_tour ? `&tour=${encodeURIComponent(currentSession.event_tour)}` : "";
      let response = await fetch(`/api/data-golf?action=app-leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}&eventName=${encodeURIComponent(currentSession.event_name ?? currentSession.name)}${tourQuery}&season=${resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession)}`, LIVE_DATA_FETCH_OPTIONS);
      let payload = await readJsonResponse<LeaderboardResponse>(response);
      if (!payload?.ok && !currentSession.event_id.startsWith("dg:")) {
        response = await fetch(`/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}${tourQuery}&season=${resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession)}`, LIVE_DATA_FETCH_OPTIONS);
        payload = await readJsonResponse<LeaderboardResponse>(response);
      }
      if (!payload?.ok || !payload.leaderboard) throw new Error(payload?.error ?? "Data Golf did not return leaderboard data.");
      if (!eventNamesMatch(currentSession.event_name, payload.eventName)) {
        throw new Error(`Leaderboard event mismatch: expected ${currentSession.event_name ?? currentSession.name}, received ${payload.eventName ?? "an unidentified event"}.`);
      }
      const { error } = await supabase.rpc("refresh_session_leaderboard", {
        target_session_id: currentSession.id,
        leaderboard: payload.leaderboard,
        totals: payload.totals ?? {},
        next_status: payload.finalized ? "finalized" : "scored",
      });
      if (error) throw error;
      setStatusMessage(payload.finalized ? `Saved final leaderboard results from Data Golf for ${payload.eventName ?? currentSession.name}.` : `Updated leaderboard results from Data Golf for ${payload.eventName ?? currentSession.name}.`);
      await loadSessions();
      await loadSession(currentSession.id, false, false);
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not update leaderboard results from Data Golf.");
    }
    setBusy("");
  }

  async function loadTournamentLeaderboard(openPanel = true) {
    if (!currentSession?.event_id) return setStatusMessage("Link this draft to a tournament before viewing its leaderboard.");
    if (openPanel) setTournamentLeaderboardOpen(true);
    setTournamentLeaderboardLoading(true);
    try {
      const tourQuery = currentSession.event_tour ? `&tour=${encodeURIComponent(currentSession.event_tour)}` : "";
      let response = await fetch(`/api/data-golf?action=app-leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}&eventName=${encodeURIComponent(currentSession.event_name ?? currentSession.name)}${tourQuery}&season=${resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession)}`, LIVE_DATA_FETCH_OPTIONS);
      let payload = await readJsonResponse<TournamentLeaderboardResponse>(response);
      if (!payload?.ok && !currentSession.event_id.startsWith("dg:")) {
        response = await fetch(`/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}${tourQuery}&season=${resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession)}`, LIVE_DATA_FETCH_OPTIONS);
        payload = await readJsonResponse<TournamentLeaderboardResponse>(response);
      }
      if (!payload?.ok || !payload.rows) throw new Error(payload?.error ?? "Data Golf did not return tournament leaderboard rows.");
      if (!eventNamesMatch(currentSession.event_name, payload.eventName)) {
        throw new Error(`Leaderboard event mismatch: expected ${currentSession.event_name ?? currentSession.name}, received ${payload.eventName ?? "an unidentified event"}.`);
      }
      setTournamentLeaderboardRows(payload.rows);
    } catch (error) {
      console.error(error);
      setTournamentLeaderboardRows([]);
      setStatusMessage("Could not load the tournament leaderboard.");
    }
    setTournamentLeaderboardLoading(false);
  }

  function openTournamentLeaderboard() {
    void loadTournamentLeaderboard(true);
  }

  async function autoDraftRandomly() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can run the random draft.");
    if (!currentSession || !validDraftOrder || draftComplete) return;
    if (!availablePlayers.length) {
      setStatusMessage("There are no available golfers left to auto-draft.");
      return;
    }

    const remainingPicks = totalPicks - picks.length;
    if (availablePlayers.length < remainingPicks) {
      setStatusMessage("There are not enough available golfers to finish the draft.");
      return;
    }

    const randomPool = shuffled(availablePlayers);

    setBusy("Random drafting...");
    const generatedPicks: Omit<DraftPick, "id" | "created_at">[] = [];
    for (let offset = 0; offset < remainingPicks; offset += 1) {
      const overallIndex = picks.length + offset;
      const roundNumber = Math.floor(overallIndex / assignedTeams.length) + 1;
      const roundIndex = overallIndex % assignedTeams.length;
      const team = roundNumber % 2 === 1 ? assignedTeams[roundIndex] : assignedTeams[assignedTeams.length - 1 - roundIndex];
      const playerName = randomPool[offset];
      generatedPicks.push({
        session_id: currentSession.id,
        team_id: team.id,
        player_name: playerName,
        player_key: normalizeName(playerName),
        pick_number: overallIndex + 1,
        round_number: roundNumber,
      });
    }

    const { error } = await supabase.from("draft_picks").insert(generatedPicks);
    if (error) {
      console.error(error);
      setBusy("");
      setStatusMessage("Could not complete the random draft.");
      return;
    }

    const completed = picks.length + generatedPicks.length >= totalPicks;
    await updateSession({ status: completed ? "draft_complete" : "drafting" }, `Randomly drafted ${generatedPicks.length} golfers.`);
    if (completed) setActiveRoomTab("results");
    setPlayerFilter("");
    setHighlightedPlayerIndex(0);
    setBusy("");
  }

  function openResultPositionEditor() {
    if (!canEditResultPositions || !currentSession) return;
    const positions = normalizeStoredPlayoffPositions(currentSession.current_positions ?? {}, currentSession.current_totals ?? {});
    const totals = currentSession.current_totals ?? {};
    setResultPositionEdits(Object.fromEntries(picks.map((pick) => {
      const position = lookupLeaderboardValue(pick.player_name, positions) ?? null;
      const storedTotal = lookupLeaderboardValue(pick.player_name, totals) ?? null;
      return [pick.id, resultPositionEditorValue(position, parseStoredTotal(storedTotal), parseStoredThru(storedTotal))];
    })));
    setResultPositionEditorOpen(true);
  }

  async function saveResultPositionEdits() {
    if (!canEditResultPositions || !currentSession) return setStatusMessage("Only commissioners and assistant commissioners can edit final positions.");

    const parsedEdits = picks.map((pick) => ({
      pick,
      parsed: parseResultPositionEditorValue(resultPositionEdits[pick.id] ?? ""),
    }));
    const invalidEdit = parsedEdits.find((entry) => entry.parsed === null);
    if (invalidEdit) return setStatusMessage(`Enter a finish such as 1, T6, CUT, WD, or DQ for ${invalidEdit.pick.player_name}.`);

    const positions = { ...(currentSession.current_positions ?? {}) };
    const totals = { ...(currentSession.current_totals ?? {}) };
    parsedEdits.forEach(({ pick, parsed }) => {
      if (!parsed) return;
      const key = normalizeName(pick.player_name);
      const existingTotal = lookupLeaderboardValue(pick.player_name, totals);
      Object.keys(positions).filter((positionKey) => normalizeName(positionKey) === key).forEach((positionKey) => delete positions[positionKey]);
      Object.keys(totals).filter((totalKey) => normalizeName(totalKey) === key).forEach((totalKey) => delete totals[totalKey]);
      if (parsed.kind === "status") {
        positions[key] = null;
        totals[key] = `${parsed.status}||${parsed.status}`;
      } else if (parsed.kind === "position") {
        positions[key] = parsed.position;
        totals[key] = `${parseStoredTotal(existingTotal) ?? ""}||F`;
      }
    });

    setBusy("Saving final positions...");
    await updateSession(
      { current_positions: positions, current_totals: totals },
      `Updated final positions for ${parsedEdits.length} drafted golfers. Team scores were recalculated.`
    );
    setBusy("");
    setResultPositionEditorOpen(false);
  }

  async function finalizeResults() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can finalize tournament results.");
    if (!currentSession) return;
    if (!Object.keys(currentSession.current_positions ?? {}).length) return setStatusMessage("Refresh the leaderboard or enter final positions before finalizing this tournament.");
    await updateSession({ status: "finalized" }, `Finalized ${currentSession.event_name ?? currentSession.name}. Saved results are now locked.`);
  }

  async function reopenFinalizedResults() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can reopen finalized results.");
    if (!currentSession) return;
    await updateSession({ status: "scored" }, `Reopened ${currentSession.event_name ?? currentSession.name}. You can refresh or edit leaderboard results again.`);
  }

  async function replacePick(playerName: string) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can swap drafted golfers.");
    if (!editingPick) return;

    const replacementKey = normalizeName(playerName);
    if (draftedKeys.has(replacementKey)) {
      return setStatusMessage(`${playerName} has already been drafted.`);
    }

    setBusy("Replacing golfer...");
    const { error } = await supabase
      .from("draft_picks")
      .update({
        player_name: playerName,
        player_key: replacementKey,
      })
      .eq("id", editingPick.id);

    if (error) {
      console.error(error);
      setBusy("");
      return setStatusMessage("Could not replace that golfer.");
    }

    const oldPlayer = editingPick.playerName;
    const teamName = editingPick.teamName;
    setEditingPick(null);
    await updateSession(
      { status: "draft_complete" },
      `Replaced ${oldPlayer} with ${playerName} for ${teamName}.`
    );
    setBusy("");
  }

  async function makePick(playerName: string) {
    if (!currentSession || !validDraftOrder || !currentTeamOnClock || draftComplete) return;
    if (!canDraftCurrentPick) return setStatusMessage("You can only draft when your team is on the clock.");
    const playerKey = normalizeName(playerName);
    if (draftedKeys.has(playerKey)) return setStatusMessage(`${playerName} has already been drafted.`);
    setBusy("Saving pick...");
    if (!picks.length && !currentSession.field_locked_at) {
      const lockResult = await supabase.from("draft_sessions").update({ field_locked_at: new Date().toISOString() }).eq("id", currentSession.id);
      if (lockResult.error) console.error(lockResult.error);
    }
    const insertResult = await supabase.from("draft_picks").insert([{ session_id: currentSession.id, team_id: currentTeamOnClock.id, player_name: playerName, player_key: playerKey, pick_number: picks.length + 1, round_number: currentRound }]);
    if (insertResult.error) {
      console.error(insertResult.error);
      setBusy("");
      await loadSession(currentSession.id, false, false);
      return setStatusMessage("Could not save that pick. Refresh if someone else drafted at the same time.");
    }
    const isLastPick = picks.length + 1 >= totalPicks;
    setStatusMessage(`${currentTeamOnClock.name} drafted ${playerName}.`);
    await loadSessions();
    await loadSession(currentSession.id, false, false);
    if (isLastPick) {
      setActiveRoomTab("results");
    }
    setPlayerFilter("");
    setHighlightedPlayerIndex(0);
    setBusy("");
  }

  function handlePlayerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!availablePlayers.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedPlayerIndex((current) => Math.min(current + 1, availablePlayers.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedPlayerIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectedPlayer = availablePlayers[highlightedPlayerIndex];
      if (!selectedPlayer) return;
      if (editingPick) {
        void replacePick(selectedPlayer);
      } else {
        void makePick(selectedPlayer);
      }
    }
  }

  async function undoLastPick() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can undo picks.");
    if (!currentSession || !picks.length) return setStatusMessage("There is no pick to undo.");
    setBusy("Undoing pick...");
    const lastPick = picks[picks.length - 1];
    const lastTeam = teams.find((team) => team.id === lastPick.team_id);
    const { error } = await supabase.from("draft_picks").delete().eq("id", lastPick.id);
    if (error) {
      console.error(error);
      setBusy("");
      return setStatusMessage("Could not undo the last pick.");
    }
    await updateSession({ status: "drafting" }, `Removed ${lastPick.player_name} from ${lastTeam?.name ?? "the draft board"}.`);
    setBusy("");
  }

  function beginSwap(pick: DraftPick, teamName: string) {
    if (!canManageLeague) {
      setStatusMessage("Only the commissioner can swap drafted golfers.");
      return;
    }
    setEditingPick({
      id: pick.id,
      teamName,
      playerName: pick.player_name,
    });
    setActiveRoomTab("draft");
    setStatusMessage(`Choose a replacement for ${pick.player_name} on ${teamName}.`);
  }

  if (passwordResetMode) {
    return (
      <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="rrg-card grid w-full gap-5 rounded-[2rem] p-8">
            <div>
              <BrandMark compact />
              <p className="mb-0 mt-4 text-[#617061]">Set your new password below, then jump back into the league.</p>
            </div>
            <div className="grid gap-3">
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} placeholder="New password" />
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" type="password" value={recoveryPasswordConfirm} onChange={(event) => setRecoveryPasswordConfirm(event.target.value)} placeholder="Confirm new password" />
              <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={finishPasswordReset}>
                {busy === "Updating password..." ? busy : "Save New Password"}
              </button>
            </div>
            <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
              {busy || statusMessage}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="rrg-card w-full rounded-[2rem] p-8">
            <BrandMark compact />
            <p className="mb-0 mt-4 text-[#617061]">{statusMessage || "Loading your league access..."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="rrg-card grid w-full gap-5 rounded-[2rem] p-8">
            <div>
              <BrandMark compact />
              <p className="mb-0 mt-4 text-[#617061]">
                {pendingInvitationToken ? "You have a league invitation. Sign in or create an account and we will add you to that league." : "Create an account to draft for your team, follow live results, and review past tournaments."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_in" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_in")}>Sign In</button>
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_up" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_up")}>Create Account</button>
            </div>

            <div className="grid gap-2">
              <button className="rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#1f2a1d] shadow-sm" onClick={() => signInWithProvider("google")}>
                Continue with Google
              </button>
              <div className="grid gap-2 sm:grid-cols-2">
                <button className="rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#1f2a1d] shadow-sm" onClick={() => signInWithProvider("apple")}>
                  Continue with Apple
                </button>
                <button className="rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#1f2a1d] shadow-sm" onClick={() => signInWithProvider("facebook")}>
                  Continue with Facebook
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#617061]">
              <span className="h-px flex-1 bg-black/10" />
              <span>Email</span>
              <span className="h-px flex-1 bg-black/10" />
            </div>

            <div className="grid gap-3">
              {authMode === "sign_up" ? (
                <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} placeholder="Username" />
              ) : null}
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email address" />
              <input className="rounded-xl border border-black/15 bg-white px-3 py-3" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} onKeyDown={handleAuthPasswordKeyDown} placeholder="Password" />
              <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={authMode === "sign_up" ? signUp : signIn}>
                {busy === "Creating account..." || busy === "Signing in..." ? busy : authMode === "sign_up" ? "Create Account" : "Sign In"}
              </button>
              {authMode === "sign_in" ? <button className="justify-self-start text-sm text-[#1a5c3a]" onClick={sendPasswordReset}>Send password reset email</button> : null}
            </div>

            <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
              {busy || statusMessage}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !leagueContextLoaded) {
    return (
      <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[720px] place-items-center">
          <div className="rrg-card w-full rounded-[2rem] p-8">
            <BrandMark compact />
            <p className="mb-0 mt-4 text-[#617061]">{statusMessage || "Loading your league access..."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentLeagueId) {
    return (
      <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="mx-auto grid min-h-[70vh] max-w-[760px] place-items-center">
          <div className="rrg-card grid w-full gap-6 rounded-[2rem] p-8">
            <div>
              <BrandMark compact />
              <h1 className="mb-0 mt-6 font-[Georgia] text-3xl">Set up your league</h1>
              <p className="mb-0 mt-2 text-[#617061]">Create a new league as its commissioner, or open a secure invitation link from another commissioner.</p>
            </div>
            <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-5">
              <label className="grid gap-2 text-sm font-medium text-[#1f2a1d]">
                League name
                <input className="rounded-xl border border-black/15 bg-white px-3 py-3 font-normal" value={newLeagueName} onChange={(event) => setNewLeagueName(event.target.value)} placeholder="For example, Sunday Golf League" />
              </label>
              <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white disabled:opacity-50" disabled={busy === "Creating league..."} onClick={createLeague}>
                {busy === "Creating league..." ? busy : "Create League"}
              </button>
            </div>
            <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">{busy || statusMessage}</div>
            <button className="justify-self-start rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-sm text-[#1a5c3a]" onClick={signOut}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rrg-shell min-h-screen px-4 py-6 text-[#1f2a1d] xl:px-6">
        <div className="rrg-topbar mx-auto mb-5 flex max-w-[1880px] flex-wrap items-center justify-between gap-4 rounded-[2rem] px-5 py-4">
          <BrandMark />
            <div className="grid justify-items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2 text-xs">
                <span className="rounded-full bg-white/80 px-3 py-1 text-[#1a5c3a]">{profile?.username}</span>
                <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-[#1a5c3a]">{isSiteAdmin ? "Site Admin" : roleLabel(effectiveRole)}</span>
                {leagues.length > 1 ? (
                  <select className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1 text-xs text-[#1a5c3a]" value={currentLeagueId} onChange={(event) => changeActiveLeague(event.target.value)}>
                    {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
                  </select>
                ) : currentLeague ? (
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[#6a5940]">{currentLeague.name}</span>
                ) : null}
                <button className={`rounded-full px-3 py-1 text-xs ${activeRoomTab === "season" ? "bg-[#1a5c3a] text-white" : "bg-[#f7f2e9] text-[#6a5940]"}`} onClick={() => setActiveRoomTab("season")}>Season</button>
                <button className={`rounded-full px-3 py-1 text-xs ${activeRoomTab === "profile" ? "bg-[#1a5c3a] text-white" : "bg-[#f7f2e9] text-[#6a5940]"}`} onClick={() => setActiveRoomTab("profile")}>Profile</button>
                {canManageLeague ? <button className={`rounded-full px-3 py-1 text-xs ${activeRoomTab === "admin" ? "bg-[#1a5c3a] text-white" : "bg-[#f2eadf] text-[#6a5940]"}`} onClick={() => setActiveRoomTab("admin")}>Admin</button> : null}
              </div>
              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-sm text-[#1a5c3a]" onClick={signOut}>Sign Out</button>
            </div>
        </div>

        {newDraftModalOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 py-6">
            <div className="grid max-h-[92vh] w-full max-w-[1120px] gap-5 overflow-x-hidden overflow-y-auto rounded-3xl bg-[#fbf7ef] p-5 text-[#1f2a1d] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="m-0 font-[Georgia] text-3xl">New Draft</h2>
                  <div className="mt-1 text-sm text-[#617061]">Choose the tournament, teams, and draft order before creating the room.</div>
                </div>
                <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-sm text-[#9d4b2f]" onClick={() => setNewDraftModalOpen(false)}>Close</button>
              </div>

              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
                <div className="relative z-10 grid min-w-0 content-start gap-4">
                  <div className="grid min-w-0 gap-2 rounded-2xl border border-black/10 bg-white/80 p-4">
                    <label className="grid min-w-0 gap-1 text-sm text-[#617061]">
                      <span className="font-medium text-[#1f2a1d]">Professional Tour</span>
                      <select className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-[#1f2a1d]" value={newDraftTour} onChange={(event) => setNewDraftTour(event.target.value)}>
                        {TOUR_OPTIONS.map((tour) => <option key={tour.id} value={tour.id}>{tour.label}</option>)}
                      </select>
                    </label>
                    <label className="grid min-w-0 gap-1 text-sm text-[#617061]">
                      <span className="font-medium text-[#1f2a1d]">Season Year</span>
                      <select className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-[#1f2a1d]" value={newDraftSeason} onChange={(event) => setNewDraftSeason(Number(event.target.value))}>
                        {HISTORICAL_SEASONS.map((season) => <option key={season} value={season}>{season}</option>)}
                      </select>
                    </label>
                    <label className="grid min-w-0 gap-1 text-sm text-[#617061]">
                      <span className="font-medium text-[#1f2a1d]">Tournament</span>
                      <select className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-[#1f2a1d]" value={newSessionEventId} onChange={(event) => setNewSessionEventId(event.target.value)}>
                        <option value="">{events.length ? "Select an event" : "Loading events..."}</option>
                        {events.map((event) => <option key={event.id} value={event.id}>{formatEventDropdownOption(event)}</option>)}
                      </select>
                    </label>
                    {selectedNewDraftEvent ? (
                      <div className="grid min-w-0 gap-2 overflow-hidden rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                        <div className="min-w-0 truncate text-base font-semibold text-[#1f2a1d]">{selectedNewDraftEvent.name}</div>
                        <div className="min-w-0">
                          <div className="truncate">{selectedNewDraftEvent.course ?? "Course TBD"}</div>
                          {selectedNewDraftEvent.location ? <div className="truncate">{selectedNewDraftEvent.location}</div> : null}
                        </div>
                        <div className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1a5c3a]">{selectedNewDraftEvent.dateLabel ?? "Date TBD"}</div>
                        <div className="rounded-xl bg-white/70 px-3 py-2 text-xs text-[#617061]">Creating the room will import the Data Golf field and available betting odds before the first pick.</div>
                      </div>
                    ) : null}
                    <label className="flex items-start gap-3 rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm">
                      <input className="mt-1" type="checkbox" checked={newSessionCountsForSeason} onChange={(event) => setNewSessionCountsForSeason(event.target.checked)} />
                      <span>
                        <span className="block font-semibold text-[#1f2a1d]">Count toward season stats</span>
                        <span className="block text-[#617061]">Turn this off for side tournaments. The leaderboard will still be saved and viewable.</span>
                      </span>
                    </label>
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="m-0 font-[Georgia] text-xl">Draft Order Tools</h3>
                      <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{newDraftTeams.filter((team) => team.selected).length} teams</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-full bg-[#f6d77a] px-4 py-2 font-semibold text-[#1f2a1d]" onClick={randomizeNewDraftOrder}>Randomize Order</button>
                      <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={copyTeamsAndOpenDuckRace}>Copy Teams & Open Duck Race</button>
                    </div>
                  </div>
                </div>

                <div className="relative z-0 grid min-w-0 gap-3 rounded-2xl border border-black/10 bg-white/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="m-0 font-[Georgia] text-xl">Teams Playing</h3>
                    <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">Draft order</span>
                  </div>
                  <div className="grid gap-2 rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-2 md:grid-cols-2">
                    {!newDraftTeams.length ? <div className="rounded-xl bg-white/80 px-4 py-3 text-sm text-[#617061] md:col-span-2">No league members are available yet. Add a team manually below or return to League Admin to add members.</div> : null}
                    {newDraftTeams.map((team) => {
                      const selectedTeams = newDraftTeams.filter((entry) => entry.selected);
                      const selectedIndex = team.selected ? selectedTeams.findIndex((entry) => entry.name === team.name) : -1;
                      return (
                        <div
                          key={team.name}
                          draggable={team.selected}
                          onDragStart={(event) => startNewDraftTeamDrag(event, team.name)}
                          onDragOver={(event) => dragNewDraftTeamOver(event, team.name, team.selected)}
                          onDrop={(event) => {
                            event.preventDefault();
                            finishNewDraftTeamDrag();
                          }}
                          onDragEnd={finishNewDraftTeamDrag}
                          className={`grid min-w-0 select-none grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border px-3 py-2.5 transition ${team.selected ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${
                            draggedNewDraftTeam === team.name
                              ? "border-[#1a5c3a] bg-[#d9eadf] opacity-55"
                              : dragOverNewDraftTeam === team.name
                                ? "border-[#1a5c3a] bg-[#edf6ef] shadow-[0_8px_20px_rgba(26,92,58,0.14)]"
                                : team.selected
                                  ? "border-[#1a5c3a]/35 bg-white"
                                  : "border-black/10 bg-white/60 text-[#617061]"
                          }`}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-black/10 bg-[#f7f2e9] text-base font-bold text-[#617061]" title={`Move ${team.name}`} aria-hidden="true">::</span>
                          <label className="flex items-center gap-2 text-sm font-medium" onPointerDown={(event) => event.stopPropagation()}>
                            <input draggable={false} type="checkbox" checked={team.selected} onChange={() => toggleNewDraftTeam(team.name)} />
                            {team.selected ? `#${selectedIndex + 1}` : "Out"}
                          </label>
                          <div className="min-w-0 truncate text-sm font-semibold" title={team.name}>{team.name}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2" value={newDraftTeamName} onChange={(event) => setNewDraftTeamName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNewDraftTeam(); } }} placeholder="Add a team to this league's draft" />
                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={addNewDraftTeam}>Add Team</button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/80 p-4">
                <div className="text-sm text-[#617061]">{busy || statusMessage}</div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" disabled={busy === "Creating session..."} onClick={resetNewDraftForm}>Reset</button>
                  <button className="rounded-full bg-[#1a5c3a] px-5 py-2 font-semibold text-white disabled:opacity-50" disabled={busy === "Creating session..." || !newSessionEventId || !newDraftTeams.some((team) => team.selected)} onClick={createSession}>
                    {busy === "Creating session..." ? busy : "Create Draft Room"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tournamentLeaderboardOpen && currentSession ? (
          <div className="fixed inset-0 z-50 bg-[#10271f]/80 px-3 py-4 backdrop-blur-sm">
            <div className="mx-auto grid max-h-[94vh] w-full max-w-[920px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/20 bg-[#fbf7ef] text-[#1f2a1d] shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
              <div className="flex flex-wrap items-start justify-between gap-3 bg-[#174a35] px-4 py-3 text-white">
                <div>
                  <h2 className="m-0 font-[Georgia] text-2xl">Tournament Leaderboard</h2>
                  <div className="mt-1 text-sm text-white/80">{currentSession.event_name || currentSession.name} - Live tournament feed</div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-full bg-[#f6d77a] px-4 py-2 text-sm font-semibold text-[#1f2a1d] disabled:opacity-50" disabled={tournamentLeaderboardLoading} onClick={openTournamentLeaderboard}>
                    {tournamentLeaderboardLoading ? "Refreshing..." : "Refresh"}
                  </button>
                  <button className="rounded-full border border-white/35 bg-white/10 px-4 py-2 text-sm text-white" onClick={() => setTournamentLeaderboardOpen(false)}>Close</button>
                </div>
              </div>
              <div className="overflow-y-auto p-3">
                {tournamentLeaderboardLoading && !tournamentLeaderboardRows.length ? (
                  <div className="rounded-xl bg-[#e0eee4] p-5 text-center text-[#1a5c3a]">Loading the active tournament leaderboard...</div>
                ) : !tournamentLeaderboardRows.length ? (
                  <div className="rounded-xl bg-[#f7f2e9] p-5 text-center text-[#617061]">The tournament leaderboard is not available yet.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
                    <div className="grid grid-cols-[60px_minmax(0,1fr)_70px_80px] gap-2 border-b border-black/10 bg-[#f2eadf] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#617061]">
                      <span>Place</span><span>Golfer</span><span className="text-right">Score</span><span className="text-right">Thru</span>
                    </div>
                    {tournamentLeaderboardRows.map((row, index) => (
                      <div key={`${row.name}-${index}`} className={`grid grid-cols-[60px_minmax(0,1fr)_70px_80px] items-center gap-2 border-b border-black/5 px-3 py-2 text-sm last:border-b-0 ${index < 3 ? "bg-[#f9f4df]" : "bg-white"}`}>
                        <strong className="text-[#1a5c3a]">{row.positionLabel}</strong>
                        <span className="min-w-0 truncate font-medium">{row.name}</span>
                        <span className={`text-right font-semibold ${totalColorClass(row.total)}`}>{row.total ?? "-"}</span>
                        <span className="text-right text-[#617061]">{row.thru ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {resultPositionEditorOpen && canEditResultPositions && currentSession ? (
          <div className="fixed inset-0 z-50 bg-[#10271f]/80 px-3 py-4 backdrop-blur-sm">
            <div className="mx-auto grid max-h-[94vh] w-full max-w-[1500px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-white/20 bg-[#fbf7ef] text-[#1f2a1d] shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
              <div className="flex flex-wrap items-start justify-between gap-3 bg-[#174a35] px-4 py-3 text-white">
                <div>
                  <h2 className="m-0 font-[Georgia] text-2xl">Edit Final Positions</h2>
                  <div className="mt-1 text-sm text-white/80">{currentSession.event_name || currentSession.name} - Enter 1, T6, CUT, WD, or DQ.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentSession.event_id ? <button className="rounded-full bg-[#f6d77a] px-4 py-2 text-sm font-semibold text-[#1f2a1d]" onClick={() => { setResultPositionEditorOpen(false); void openTournamentLeaderboard(); }}>View Tournament Leaderboard</button> : null}
                  <button className="rounded-full border border-white/35 bg-white/10 px-4 py-2 text-sm text-white" onClick={() => setResultPositionEditorOpen(false)}>Close</button>
                </div>
              </div>

              <div className="overflow-y-auto p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1a5c3a]/20 bg-[#e0eee4] px-3 py-2 text-sm">
                  <span><strong>How it works:</strong> compare with the tournament leaderboard, update only the incorrect finishes, then save. Team scores and rankings recalculate automatically.</span>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1a5c3a]">{picks.length} golfers</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {assignedTeams.map((team) => {
                    const teamPicks = picks.filter((pick) => pick.team_id === team.id).sort((a, b) => a.round_number - b.round_number);
                    const editedPoints = teamPicks
                      .map((pick) => parseResultPositionEditorValue(resultPositionEdits[pick.id] ?? ""))
                      .map((result) => result?.kind === "position" ? pointsForPosition(result.position) : 0)
                      .sort((a, b) => b - a)
                      .slice(0, 3)
                      .reduce((sum, points) => sum + points, 0);
                    return (
                      <div key={team.id} className="grid content-start gap-2 rounded-xl border border-black/10 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.14em] text-[#617061]">Draft slot {team.draft_slot}</div>
                            <strong>{team.name}</strong>
                          </div>
                          <span className="rounded-full bg-[#d9eadf] px-2.5 py-0.5 text-xs font-semibold text-[#1a5c3a]">{editedPoints} pts</span>
                        </div>
                        <div className="grid gap-1.5">
                          {teamPicks.map((pick) => {
                            const parsedPosition = parseResultPositionEditorValue(resultPositionEdits[pick.id] ?? "");
                            const positionPoints = parsedPosition?.kind === "position" ? pointsForPosition(parsedPosition.position) : 0;
                            return (
                              <label key={pick.id} className="grid grid-cols-[minmax(0,1fr)_76px_auto] items-center gap-2 rounded-lg border border-black/5 bg-[#f7f2e9] px-2 py-1.5">
                                <span className="min-w-0 truncate text-sm font-medium">{pick.player_name}</span>
                                <input
                                  className={`w-full rounded-lg border-2 bg-white px-2 py-1.5 text-center text-sm font-bold uppercase ${parsedPosition === null ? "border-[#9d4b2f] text-[#9d4b2f]" : "border-[#1a5c3a]/30 text-[#1f2a1d]"}`}
                                  value={resultPositionEdits[pick.id] ?? ""}
                                  onChange={(event) => setResultPositionEdits((current) => ({ ...current, [pick.id]: event.target.value.toUpperCase() }))}
                                  placeholder="P/CUT"
                                />
                                <span className="w-10 text-right text-xs font-semibold text-[#617061]">{positionPoints}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 bg-white px-4 py-3">
                <div className="text-sm text-[#617061]">{busy || statusMessage}</div>
                <div className="flex gap-2">
                  <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-sm text-[#1a5c3a]" onClick={() => setResultPositionEditorOpen(false)}>Cancel</button>
                  <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy === "Saving final positions..."} onClick={saveResultPositionEdits}>
                    {busy === "Saving final positions..." ? "Saving..." : "Save Positions"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      {!tournamentWorkspaceReady ? (
        <div className="mx-auto grid min-h-[360px] max-w-[1880px] place-items-center rounded-3xl border border-black/10 bg-white/70 p-6 shadow-[0_18px_45px_rgba(74,57,28,0.12)]">
          <div className="grid justify-items-center gap-3 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#d9eadf] border-t-[#1a5c3a]" aria-hidden="true" />
            <div>
              <div className="font-[Georgia] text-xl">Loading current tournament</div>
              <div className="mt-1 text-sm text-[#617061]">Checking the league schedule and opening the right event.</div>
            </div>
          </div>
        </div>
      ) : (
      <div className="mx-auto grid max-w-[1880px] gap-5 lg:grid-cols-[300px_1fr]">
        <section className="rrg-card rounded-3xl p-5 lg:sticky lg:top-4">
          {!canManageLeague ? <h2 className="mb-4 mt-0 font-[Georgia] text-2xl">League Hub</h2> : null}
            {canManageLeague ? (
              <div className="grid min-w-0 gap-3">
                <button className="w-full rounded-full bg-[#1a5c3a] px-4 py-3 font-semibold text-white" onClick={openNewDraftModal}>New Draft</button>
                <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                  Set the event, teams, and draft order before the room opens.
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                Open any tournament below to watch the live draft, make your pick when your team is on the clock, and review final leaderboards.
              </div>
            )}
              <div className="mt-5 grid gap-3">
                {!featuredSession ? (
                  <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No saved tournament sessions yet.</div>
                ) : (
                  <>
                    <div className="text-[10px] font-semibold uppercase text-[#617061]">Current Tournament</div>
                    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border-2 px-3 py-3 ${selectedSessionId === featuredSession.id ? "border-[#1a5c3a] bg-[#d9eadf]" : "border-[#1a5c3a]/45 bg-[#edf6ef]"}`}>
                      <button className="min-w-0 text-left" onClick={() => setSelectedSessionId(featuredSession.id)}>
                        <div className="flex items-center justify-between gap-3">
                          <strong className="truncate">{featuredSession.name}</strong>
                          <span className="text-xs font-medium text-[#1a5c3a]">{statusLabel(featuredSession.status)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#617061]">
                          <span>{formatTournamentDate(sessionEventDates[featuredSession.id], resolvedSessionSeasons[featuredSession.id] ?? sessionEventSeason(featuredSession))}</span>
                          <span className="font-semibold text-[#1a5c3a]">{sessionCountsForSeason(featuredSession) ? "Season event" : "Side event"}</span>
                        </div>
                      </button>
                      {canManageLeague ? <button className="shrink-0 rounded-full border border-[#9d4b2f]/20 bg-white px-2.5 py-1 text-xs text-[#9d4b2f]" onClick={() => deleteSession(featuredSession)}>Delete</button> : null}
                    </div>

                    <div className="mt-1 text-[10px] font-semibold uppercase text-[#617061]">Tournament Archive</div>
                    {archivedSessionsByYear.map(([year, yearSessions]) => {
                      const expanded = expandedSessionYears.includes(year);
                      const seasonEventCount = yearSessions.filter(sessionCountsForSeason).length;
                      return (
                        <div key={year} className="overflow-hidden rounded-2xl border border-black/10 bg-white/65">
                          <button
                            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left"
                            aria-expanded={expanded}
                            onClick={() => setExpandedSessionYears((current) => current.includes(year) ? current.filter((entry) => entry !== year) : [...current, year])}
                          >
                            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f2eadf] font-semibold text-[#1a5c3a]" aria-hidden="true">{expanded ? "−" : "+"}</span>
                            <span>
                              <strong className="block">{year}</strong>
                              <span className="block text-[11px] text-[#617061]">{yearSessions.length} tournaments</span>
                            </span>
                            <span className="text-right text-[10px] font-semibold uppercase text-[#617061]">{seasonEventCount} season</span>
                          </button>
                          {expanded ? (
                            <div className="grid gap-2 border-t border-black/10 bg-[#f7f2e9]/55 p-2">
                              {yearSessions.map((session) => {
                                const seasonEvent = sessionCountsForSeason(session);
                                return (
                                  <div key={session.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-l-4 px-2.5 py-2.5 ${selectedSessionId === session.id ? "border-[#1a5c3a] bg-[#e0eee4]" : seasonEvent ? "border-black/10 border-l-[#1a5c3a] bg-white" : "border-black/10 border-l-[#b6aa98] bg-[#f4efe6]"}`}>
                                    <button className="min-w-0 text-left" onClick={() => setSelectedSessionId(session.id)}>
                                      <div className="flex items-center justify-between gap-2">
                                        <strong className="truncate text-sm">{session.name}</strong>
                                        <span className="shrink-0 text-[10px] text-[#617061]">{statusLabel(session.status)}</span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[#617061]">
                                        <span>{formatTournamentDate(sessionEventDates[session.id], resolvedSessionSeasons[session.id] ?? sessionEventSeason(session))}</span>
                                        <span className={seasonEvent ? "font-semibold text-[#1a5c3a]" : "font-semibold text-[#7b6d5b]"}>{seasonEvent ? "Season event" : "Side event"}</span>
                                      </div>
                                    </button>
                                    {canManageLeague ? <button className="shrink-0 rounded-full border border-[#9d4b2f]/20 bg-white px-2 py-1 text-[10px] text-[#9d4b2f]" onClick={() => deleteSession(session)}>Delete</button> : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </>
                )}
            </div>
        </section>

        <section className={`rrg-card rounded-3xl ${activeRoomTab === "draft" ? "p-4" : "p-5"}`}>
            <div className={`${activeRoomTab === "draft" ? "mb-2" : "mb-3"} grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`}>
              <div className="min-w-0">
                <h2 className="m-0 font-[Georgia] text-2xl">{activeRoomTab === "season" ? `${currentLeague?.name ?? "League"} Season` : activeRoomTab === "admin" ? `${currentLeague?.name ?? "League"} Admin` : activeRoomTab === "profile" ? "My Profile" : currentSession ? currentSession.event_name || currentSession.name : "Pick a session"}</h2>
                {currentSession && activeRoomTab === "results" ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#617061]">
                    {currentSessionDisplayEvent?.course ? <a className="font-medium text-[#1a5c3a] underline decoration-[#1a5c3a]/25 underline-offset-2" href={courseWebsiteUrl(currentSessionDisplayEvent)} target="_blank" rel="noreferrer">{currentSessionDisplayEvent.course}</a> : null}
                    {currentSessionDisplayEvent?.location ? <span>{currentSessionDisplayEvent.location}</span> : null}
                    {currentSessionDisplayEvent?.dateLabel ? <span>{currentSessionDisplayEvent.dateLabel}</span> : null}
                  </div>
                ) : null}
              </div>
              {currentSession && activeRoomTab !== "season" ? (
                <div className="grid justify-items-center gap-1.5 xl:justify-self-center">
                  <div className="flex flex-wrap justify-center gap-2">
                    {canManageLeague ? <button className={`rounded-full px-3 py-1.5 text-sm ${activeRoomTab === "setup" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("setup")}>Tournament</button> : null}
                    <button className={`rounded-full px-3 py-1.5 text-sm ${activeRoomTab === "draft" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("draft")}>Draft</button>
                    <button className={`rounded-full px-3 py-1.5 text-sm ${activeRoomTab === "results" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("results")}>Results</button>
                  </div>
                  {activeRoomTab === "results" ? <div className="text-xs font-medium text-[#1a5c3a]">Leaderboard updated {resultsUpdatedLabel}</div> : null}
                </div>
              ) : <div />}
              <div className="flex flex-wrap justify-end gap-2 xl:justify-self-end">
                {activeRoomTab === "results" && currentSession ? (
                  <>
                    <button className="rounded-full bg-[#f6d77a] px-3 py-1.5 text-sm font-semibold text-[#1f2a1d]" onClick={canManageLeague ? pullLeaderboard : refreshResultsView}>
                      {busy === "Pulling leaderboard..." || busy === "Refreshing view..." ? "Refreshing..." : canManageLeague ? "Update Scores" : "Refresh View"}
                    </button>
                    {canManageLeague ? (
                      resultsFinalized
                        ? <button className="rounded-full border border-[#1a5c3a]/25 bg-white px-3 py-1.5 text-sm font-semibold text-[#1a5c3a]" onClick={reopenFinalizedResults}>Reopen Results</button>
                        : <button className="rounded-full bg-[#174a35] px-3 py-1.5 text-sm font-semibold text-white" onClick={finalizeResults}>Finalize Results</button>
                    ) : null}
                    {canEditResultPositions ? <button className="rounded-full border border-[#1a5c3a]/25 bg-white px-3 py-1.5 text-sm font-semibold text-[#1a5c3a]" onClick={openResultPositionEditor}>Edit Final Positions</button> : null}
                  </>
                ) : (
                  <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{activeRoomTab === "season" ? "League stats" : activeRoomTab === "admin" ? "League management" : activeRoomTab === "profile" ? "Account settings" : currentSession ? statusLabel(currentSession.status) : "No session selected"}</span>
                )}
              </div>
            </div>

            {!currentSession && !["admin", "profile", "season"].includes(activeRoomTab) ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">{canManageLeague ? "Create a tournament session on the left, then click it to open the shared draft room." : "Pick a saved tournament on the left to watch the draft, follow the leaderboard, and review past results."}</div> : (
              <div className={activeRoomTab === "draft" ? "grid gap-3" : "grid gap-5"}>
                {currentSession && canManageLeague && activeRoomTab === "setup" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="m-0 font-[Georgia] text-xl">Tournament Settings</h3>
                          <div className="mt-1 text-sm text-[#617061]">Confirm this tournament is ready, then manage its field only when something needs attention.</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${setupReady ? "bg-[#d9eadf] text-[#1a5c3a]" : "bg-[#f2eadf] text-[#6a5940]"}`}>
                          {setupReady ? (picks.length ? "Draft underway" : "Ready to draft") : "Setup needed"}
                        </span>
                      </div>

                      <div className="grid gap-4">
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-[#f7f2e9] p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h4 className="m-0 font-[Georgia] text-lg">Setup Status</h4>
                              <div className="mt-1 text-sm text-[#617061]">{setupReady ? "The required tournament details are in place." : fieldPending ? "The tournament is linked, but its player field has not been published yet." : "Complete the items marked Needs attention before drafting."}</div>
                            </div>
                            <span className="text-sm font-semibold text-[#1a5c3a]">{[setupHasEvent, setupHasTeams, setupHasField].filter(Boolean).length}/3 required</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            {[
                              { label: "Tournament linked", complete: setupHasEvent, required: true },
                              { label: "Teams ordered", complete: setupHasTeams, required: true },
                              { label: "Player field loaded", complete: setupHasField, required: true },
                              { label: "Odds loaded", complete: setupHasOdds, required: false },
                            ].map(({ label, complete, required }) => (
                              <div key={label} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm">
                                <span className="truncate font-medium text-[#1f2a1d]">{label}</span>
                                <span className={`shrink-0 text-xs font-semibold ${complete ? "text-[#1a5c3a]" : required ? "text-[#9d4b2f]" : "text-[#7b6d5b]"}`}>
                                  {complete ? "Ready" : required ? "Needs attention" : "Optional"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div>
                            <h4 className="m-0 font-[Georgia] text-lg">Tournament</h4>
                            <div className="mt-1 text-sm text-[#617061]">The linked event supplies the field and leaderboard data.</div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="grid gap-1 text-sm text-[#617061]">
                              <span className="font-medium text-[#1f2a1d]">Tournament Season</span>
                              <select
                                className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3 disabled:bg-[#f4efe6] disabled:text-[#617061]"
                                disabled={tournamentIdentityLocked}
                                value={resolvedSessionSeasons[currentSession.id] ?? sessionEventSeason(currentSession)}
                                onChange={(event) => {
                                  const season = Number(event.target.value);
                                  setNewDraftSeason(season);
                                  void updateSession(
                                    { event_season: season, event_id: null, event_name: null, manual_leaderboard_input: manualLeaderboardWithEventSeason(currentSession.manual_leaderboard_input, season, sessionCountsForSeason(currentSession)) },
                                    `Season changed to ${season}. Select the tournament and refresh the field.`
                                  );
                                }}
                              >
                                {HISTORICAL_SEASONS.map((season) => <option key={season} value={season}>{season}</option>)}
                              </select>
                            </label>
                            <label className="grid gap-1 text-sm text-[#617061]">
                              <span className="font-medium text-[#1f2a1d]">Linked Tournament</span>
                              <select className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3 disabled:bg-[#f4efe6] disabled:text-[#617061]" disabled={tournamentIdentityLocked} value={currentSession.event_id ?? ""} onChange={(event) => {
                                const selectedEvent = events.find((item) => item.id === event.target.value) ?? null;
                                const season = selectedEvent?.season ?? newDraftSeason;
                                void updateSession(
                                  {
                                    event_id: event.target.value || null,
                                    event_name: selectedEvent?.name ?? null,
                                    event_tour: newDraftTour,
                                    event_season: season,
                                    manual_leaderboard_input: manualLeaderboardWithEventSeason(currentSession.manual_leaderboard_input, season, sessionCountsForSeason(currentSession)),
                                  },
                                  `Linked this session to ${selectedEvent?.name ?? "the selected event"}.`
                                );
                              }}>
                                <option value="">No event selected</option>
                                {events.map((event) => <option key={event.id} value={event.id}>{formatEventDropdownOption(event)}</option>)}
                              </select>
                            </label>
                          </div>
                          {tournamentIdentityLocked ? <div className="rounded-xl border border-[#9d4b2f]/15 bg-[#f8eee8] px-3 py-2 text-sm text-[#7a4937]">Tournament identity is locked after the first pick. Undo the draft picks before linking a different event.</div> : null}
                          {selectedCurrentSessionEvent ? (
                            <div className="grid min-w-0 gap-2 overflow-hidden rounded-xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-[#1f2a1d]">{selectedCurrentSessionEvent.name}</div>
                                <div className="truncate">{selectedCurrentSessionEvent.course ?? "Course TBD"}{selectedCurrentSessionEvent.location ? ` - ${selectedCurrentSessionEvent.location}` : ""}</div>
                              </div>
                              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1a5c3a]">{selectedCurrentSessionEvent.dateLabel ?? "Date TBD"}</span>
                            </div>
                          ) : null}
                          <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm">
                            <input className="mt-1" type="checkbox" checked={sessionCountsForSeason(currentSession)} onChange={(event) => setSessionCountsForSeason(currentSession, event.target.checked)} />
                            <span>
                              <span className="block font-semibold text-[#1f2a1d]">Count toward season statistics</span>
                              <span className="block text-[#617061]">Turn this off for side events that should keep their own leaderboard without affecting league totals.</span>
                            </span>
                          </label>
                        </div>

                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h4 className="m-0 font-[Georgia] text-lg">Draft Order</h4>
                              <div className="mt-1 text-sm text-[#617061]">{picks.length ? "Locked after the first pick." : "Move teams into the correct draft position before drafting starts."}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs font-semibold text-[#1a5c3a]">{assignedTeams.length} teams</span>
                              {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1.5 text-sm text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Order</button> : null}
                              {picks.length ? <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs font-semibold text-[#6a5940]">Locked</span> : <span className="rounded-full bg-[#e0eee4] px-3 py-1 text-xs font-semibold text-[#1a5c3a]">Editable</span>}
                            </div>
                          </div>
                          {!assignedTeams.length ? (
                            <div className="rounded-xl bg-white/75 px-3 py-3 text-sm text-[#617061]">No teams were included in this draft.</div>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {assignedTeams.map((team, index) => (
                                <div key={team.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-black/10 bg-white/90 px-3 py-2.5">
                                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a5c3a] text-xs font-semibold text-white">{team.draft_slot}</span>
                                  <strong className="min-w-0 truncate text-sm">{team.name}</strong>
                                  <div className="flex gap-1">
                                    <button className="grid h-8 w-8 place-items-center rounded-lg border border-[#1a5c3a]/20 bg-white text-sm font-semibold text-[#1a5c3a] disabled:opacity-35" disabled={!!picks.length || index === 0} onClick={() => moveDraftTeam(team.id, -1)} title="Move earlier">↑</button>
                                    <button className="grid h-8 w-8 place-items-center rounded-lg border border-[#1a5c3a]/20 bg-white text-sm font-semibold text-[#1a5c3a] disabled:opacity-35" disabled={!!picks.length || index === assignedTeams.length - 1} onClick={() => moveDraftTeam(team.id, 1)} title="Move later">↓</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h4 className="m-0 font-[Georgia] text-lg">Field & Odds</h4>
                              <div className="mt-1 text-sm text-[#617061]">Data Golf imports these automatically. Refresh only when the field or odds look incomplete.</div>
                            </div>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{allPlayers.length} golfers</span>
                          </div>
                          <div className="grid gap-2 rounded-xl bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061] sm:grid-cols-2 xl:grid-cols-4">
                            <div><span className="block text-xs">Field refreshed</span><strong className="text-[#1f2a1d]">{formatRefreshTime(currentSession.field_refreshed_at)}</strong></div>
                            <div><span className="block text-xs">Odds refreshed</span><strong className="text-[#1f2a1d]">{formatRefreshTime(currentSession.odds_refreshed_at)}</strong></div>
                            <div><span className="block text-xs">Odds available</span><strong className="text-[#1f2a1d]">{Object.keys(displayOddsByPlayer).length}</strong></div>
                            <div><span className="block text-xs">Field status</span><strong className="text-[#1f2a1d]">{picks.length || currentSession.field_locked_at ? "Locked" : "Editable"}</strong></div>
                          </div>
                          {fieldPending ? (
                            <div className="rounded-xl border border-[#c28a24]/30 bg-[#fff6d9] px-4 py-3 text-sm text-[#6a4b12]">
                              <strong className="block text-[#4f390e]">Field not published yet</strong>
                              <span>Data Golf and ESPN have not released the player list for {currentSession.event_name ?? currentSession.name}{currentSessionDisplayEvent?.dateLabel ? ` (${currentSessionDisplayEvent.dateLabel})` : ""}. Drafting is disabled until the field becomes available. This page will try again automatically, or a commissioner can use Refresh Field &amp; Odds.</span>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-3">
                            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2.5 text-[#1a5c3a] disabled:opacity-50" disabled={!!picks.length} onClick={importFieldFromDataGolf}>Refresh Field & Odds</button>
                            {currentSession.odds_source ? <a className="self-center text-sm text-[#1a5c3a] underline" href={currentSession.odds_source} target="_blank" rel="noreferrer">View odds source</a> : null}
                          </div>
                          <details className="rounded-xl border border-black/10 bg-[#f7f2e9]">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[#1f2a1d]">Advanced: edit field manually</summary>
                            <div className="grid gap-3 border-t border-black/10 p-4">
                              <textarea className="min-h-64 rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-sm disabled:bg-[#f4efe6] disabled:text-[#617061]" disabled={!!picks.length} value={playerPoolDraft} onChange={(event) => setPlayerPoolDraft(event.target.value)} placeholder={"Examples:\nScottie Scheffler +450\nRory McIlroy / Shane Lowry +1200\nHossler/Ryder +8000"} />
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-sm text-[#617061]">{picks.length ? "Manual editing is locked after drafting starts." : "For team events, keep both players on one line separated by a slash."}</span>
                                <button className="rounded-full bg-[#1a5c3a] px-4 py-2.5 text-white disabled:opacity-50" disabled={!!picks.length} onClick={savePlayerPool}>Save Manual Field</button>
                              </div>
                            </div>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {canManageLeague && activeRoomTab === "admin" ? (
                <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="m-0 font-[Georgia] text-xl">League Admin</h3>
                        <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{teams.length} total teams</span>
                      </div>
                      <div className="grid gap-4">
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="m-0 font-[Georgia] text-lg">League Invites</h4>
                            {currentLeague ? <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{currentLeague.name}</span> : null}
                          </div>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                            <input className="rounded-xl border border-black/15 bg-white px-3 py-2" value={newLeagueName} onChange={(event) => setNewLeagueName(event.target.value)} placeholder="Create a league, for example Rat Race Golf - 2027" />
                            <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={createLeague}>Create League</button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                            <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#617061]" readOnly value={currentLeagueInviteUrl} placeholder="Generate a secure invitation link" />
                            <div className="flex flex-wrap gap-2">
                              <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={generateLeagueInvitation}>New Link</button>
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a] disabled:opacity-50" disabled={!currentLeagueInviteUrl} onClick={copyLeagueInviteLink}>Copy Link</button>
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a] disabled:opacity-50" disabled={!currentLeagueInviteUrl} onClick={openLeagueInviteEmail}>Email</button>
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a] disabled:opacity-50" disabled={!currentLeagueInviteUrl} onClick={openLeagueInviteSms}>SMS</button>
                            </div>
                          </div>
                          <div className="text-sm text-[#617061]">Each secure link expires after 14 days or 25 new members. Generate a new link whenever the old one should no longer be shared.</div>
                        </div>
                        {isSiteAdmin ? (
                          <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="m-0 font-[Georgia] text-lg">Site Admin</h4>
                              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{leagues.length} leagues</span>
                            </div>
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                              <select className="rounded-xl border border-black/15 bg-white px-3 py-2" value={newLeagueMemberId} onChange={(event) => setNewLeagueMemberId(event.target.value)}>
                                <option value="">{availableSiteProfiles.length ? "Add existing account to this league" : "All accounts are in this league"}</option>
                                {availableSiteProfiles.map((entry) => <option key={entry.id} value={entry.id}>{formatProfileLabel(entry.username)}</option>)}
                              </select>
                              <div className="flex flex-wrap gap-2">
                                <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={addExistingMemberToLeague}>Add Member</button>
                                <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-white disabled:opacity-50" disabled={!availableSiteProfiles.length} onClick={addAllExistingMembersToLeague}>Add All</button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h4 className="m-0 font-[Georgia] text-lg">Signed-Up Members</h4>
                            <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{profiles.length} accounts</span>
                          </div>
                          {!profiles.length ? <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-4 text-sm text-[#617061]">No members have created accounts yet.</div> : (
                              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {profiles.map((entry) => (
                                  <div key={entry.id} className="grid gap-2 rounded-2xl border border-black/10 bg-white/90 p-3 text-sm">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="grid gap-1">
                                        <strong>{entry.username}</strong>
                                        <span className="text-[#617061]">{roleLabel(entry.role)}</span>
                                      </div>
                                      {canManagePermissions && entry.role !== "commissioner" ? <div className="grid gap-2 justify-items-end"><select className="rounded-xl border border-black/15 bg-white px-2 py-1 text-xs" value={entry.role} onChange={(event) => updateMemberRole(entry, event.target.value as "assistant_commissioner" | "member")}><option value="member">Member</option><option value="assistant_commissioner">Assistant Commissioner</option></select><button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1 text-xs text-[#9d4b2f]" onClick={() => removeMember(entry)}>Remove</button></div> : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                          )}
                        </div>
                        {currentSession ? <><div className="flex flex-wrap gap-3 rounded-2xl border border-black/10 bg-white/75 p-3">
                          <input
                            className="min-w-[220px] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2"
                          value={newTeamName}
                          onChange={(event) => setNewTeamName(event.target.value)}
                          placeholder="Add a new team name"
                        />
                        <button className="rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={addTeam}>
                          Add Team
                        </button>
                      </div>
                        <div className="grid gap-2">
                          {teams.map((team) => (
                            <div key={team.id} className="grid gap-2 rounded-2xl border border-black/10 bg-white/80 px-3 py-2.5 shadow-sm xl:grid-cols-[180px_210px_minmax(0,1fr)] xl:items-center">
                              <input className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={team.name} onChange={(event) => setTeams((current) => current.map((entry) => entry.id === team.id ? { ...entry, name: event.target.value } : entry))} onBlur={(event) => updateTeam(team.id, { name: event.target.value.trim() || team.name }, `Saved team name \"${event.target.value.trim() || team.name}\".`)} />
                              <select className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={team.owner_user_id ?? ""} onChange={(event) => assignTeamOwner(team, event.target.value)}>
                                <option value="">No owner</option>
                                {profiles.map((entry) => <option key={entry.id} value={entry.id}>{formatProfileLabel(entry.username)}</option>)}
                              </select>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-sm xl:justify-end xl:pl-2">
                                <span className="text-[#617061]">{team.draft_slot ? `Pick ${team.draft_slot} this week` : "Not in this week's draft"}{team.owner_user_id ? " - Owner assigned" : ""}</span>
                                {team.draft_slot === null ? (
                                  <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1 text-sm text-[#9d4b2f]" onClick={() => deleteTeam(team)}>Delete</button>
                                ) : (
                                  <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#6a5940]">Remove from draft order to delete</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        </> : <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-4 text-sm text-[#617061]">This league has no draft room yet. Use New Draft to add its first teams and tournament.</div>}
                    </div>
                  </div>
                  </div>
                  ) : null}

                {activeRoomTab === "profile" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3 className="m-0 font-[Georgia] text-xl">My Profile</h3>
                          <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{isSiteAdmin ? "Site Admin" : roleLabel(effectiveRole)}</span>
                        </div>
                        <div className="grid gap-3 md:max-w-[520px]">
                        <label className="grid gap-1 text-sm text-[#617061]">
                          <span className="font-medium text-[#1f2a1d]">Display Name</span>
                          <input className="rounded-xl border border-black/15 bg-white px-3 py-3 text-[#1f2a1d]" value={profileDraftName} onChange={(event) => setProfileDraftName(event.target.value)} placeholder="Display name" />
                          <span>This is the name everyone sees for your account around the league.</span>
                        </label>
                        <button className="justify-self-start rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={saveProfile}>Save Profile</button>
                        <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                          {busy || statusMessage}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {currentSession && activeRoomTab === "draft" ? (
                    <div className="rounded-2xl border border-black/10 bg-white/60 p-3">
                    <div className="grid gap-3">
                        <div className="grid gap-2 rounded-xl bg-[#d9eadf] px-3 py-2.5 text-[#1a5c3a] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                          <div className="grid min-w-0 gap-1.5">
                            <div className="font-semibold leading-tight">
                              {editingPick
                                ? `Replacing ${editingPick.playerName} on ${editingPick.teamName}. Pick a replacement below.`
                                : fieldPending
                                  ? "Field not published yet. Drafting will unlock when the tournament player list becomes available."
                                : !validDraftOrder
                                  ? "The draft order needs to be repaired before picks can be made."
                                  : draftComplete
                                    ? "Draft complete. All picks are in."
                                      : `${currentTeamOnClock?.name ?? "Nobody"} is on the clock for pick ${picks.length + 1}.${canDraftCurrentPick ? " You're live for this pick." : ""}`}
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[11px] font-medium text-[#28523e]">
                              <span className="rounded-full bg-white/70 px-2.5 py-0.5">{currentSession.event_name || "Event not linked"}</span>
                              <span className="rounded-full bg-white/70 px-2.5 py-0.5">Round {draftComplete ? ROUNDS : currentRound || 0}</span>
                              <span className="rounded-full bg-white/70 px-2.5 py-0.5">Pick {totalPicks ? `${Math.min(picks.length + 1, totalPicks)} / ${totalPicks}` : "0 / 0"}</span>
                              <span className="rounded-full bg-white/70 px-2.5 py-0.5">{statusLabel(currentSession.status)}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1.5 text-sm text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Order</button> : null}
                            {!draftComplete && validDraftOrder && canManageLeague ? <button className="rounded-full bg-[#f6d77a] px-3 py-1.5 text-sm font-semibold text-[#1f2a1d] disabled:cursor-not-allowed disabled:opacity-50" disabled={fieldPending} onClick={autoDraftRandomly}>Random Draft</button> : null}
                            {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" onClick={undoLastPick}>Undo Pick</button> : null}
                            {editingPick && canManageLeague ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1.5 text-sm text-[#9d4b2f]" onClick={() => setEditingPick(null)}>Cancel Swap</button> : null}
                          </div>
                        </div>
                        <div className="grid items-start gap-4 xl:grid-cols-[minmax(310px,0.72fr)_minmax(0,1.28fr)] 2xl:grid-cols-[minmax(340px,0.68fr)_minmax(0,1.32fr)]">
                          <div className="grid content-start self-start gap-2">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-lg">Available Golfers</h3>
                            <span className="rounded-full bg-[#f2eadf] px-2.5 py-0.5 text-xs text-[#617061]">{availablePlayers.length} match{availablePlayers.length === 1 ? "" : "es"}</span>
                          </div>
                          <input className="rounded-xl border border-black/15 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:bg-[#f2eadf]" disabled={fieldPending} value={playerFilter} onChange={(event) => { setPlayerFilter(event.target.value); setHighlightedPlayerIndex(0); }} onKeyDown={handlePlayerSearchKeyDown} placeholder={fieldPending ? "Waiting for published field" : "Search available golfers"} />
                          <div className="grid max-h-[450px] content-start gap-1 overflow-y-auto overflow-x-hidden rounded-xl border border-black/10 bg-[#f7f2e9]/70 p-1.5">
                            {!availablePlayers.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">{allPlayers.length ? "No available golfers match your search." : fieldPending ? `Field not published yet for ${currentSession.event_name ?? currentSession.name}. Drafting is disabled until the tournament player list is available.` : "The player field is still importing or has not been refreshed yet. Commissioners can use Setup to refresh the field and odds."}</div> : availablePlayers.map((player) => {
                              const oddsLabel = playerOddsLabel(player);
                              return (
                                <div key={player} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2.5 py-1.5 ${availablePlayers[highlightedPlayerIndex] === player ? "border-[#1a5c3a]/50 bg-[#e0eee4]" : "border-black/10 bg-white/90"}`} onMouseEnter={() => setHighlightedPlayerIndex(availablePlayers.indexOf(player))}>
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <div className="whitespace-normal break-words text-sm font-medium leading-tight">{player}</div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${oddsLabel ? "bg-[#f6d77a] text-[#1f2a1d]" : "bg-[#f2eadf] text-[#617061]"}`}>{oddsLabel ?? "No odds"}</span>
                                      </div>
                                    </div>
                                    <button className="rounded-full bg-[#1a5c3a] px-2.5 py-1 text-xs text-white disabled:opacity-50" disabled={editingPick ? !canManageLeague : (!validDraftOrder || draftComplete || !canDraftCurrentPick)} onClick={() => editingPick ? replacePick(player) : makePick(player)}>{editingPick ? "Replace" : "Draft"}</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                          <div className="grid min-w-0 gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="m-0 font-[Georgia] text-lg">Draft Board</h3>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="rounded-full bg-[#e0eee4] px-2.5 py-0.5 font-semibold text-[#1a5c3a]">{draftComplete ? "Draft complete" : `${currentTeamOnClock?.name ?? "Set order"} on clock`}</span>
                              <span className="rounded-full bg-[#f2eadf] px-2.5 py-0.5 text-[#617061]">Snake order</span>
                            </div>
                          </div>
                          <div className="grid gap-1.5 rounded-2xl border border-black/10 bg-white/80 p-2">
                            <div className="flex items-center justify-between gap-3 px-1">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#617061]">Draft Flow</div>
                              <div className="text-xs text-[#617061]">Slide to review every pick</div>
                            </div>
                            {!draftPickTape.length ? <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-3 text-sm text-[#617061]">Set the draft order to see the pick flow.</div> : (
                              <div ref={draftFlowRef} className="overflow-x-auto overflow-y-hidden pb-2">
                                <div className="flex gap-2" style={{ paddingInline: draftFlowCenterPadding ? `${draftFlowCenterPadding}px` : undefined }}>
                                  {draftPickTape.map((entry) => {
                                    const oddsLabel = entry.pick ? playerOddsLabel(entry.pick.player_name) : null;
                                    return (
                                      <div key={entry.pickNumber} data-current-pick={entry.state === "current" ? "true" : undefined} data-pick-number={entry.pickNumber} style={{ flexBasis: draftFlowCardWidth ? `${draftFlowCardWidth}px` : "150px" }} className={`grid min-h-[84px] min-w-0 shrink-0 content-start gap-1 overflow-hidden rounded-xl border p-2 text-xs ${
                                        entry.state === "current"
                                          ? "border-[#1a5c3a]/70 bg-[#1a5c3a] text-white shadow-[0_14px_30px_rgba(26,92,58,0.25)] ring-2 ring-[#b7d9bd]"
                                          : entry.state === "complete"
                                            ? "border-black/10 bg-[#f7f2e9] text-[#617061]"
                                            : "border-black/10 bg-white text-[#1f2a1d]"
                                      }`}>
                                        <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${entry.state === "current" ? "text-white/80" : "text-[#617061]"}`}>Pick {entry.pickNumber}</div>
                                        <div className="break-words font-semibold leading-tight">{entry.team?.name}</div>
                                        {entry.pick ? (
                                          <div className={`grid gap-0.5 break-words rounded-lg px-2 py-1 text-xs leading-tight ${entry.state === "current" ? "bg-white/15" : "bg-white/75"}`}>
                                            <span>{entry.pick.player_name}</span>
                                            {oddsLabel ? <span className={`text-[11px] font-semibold ${entry.state === "current" ? "text-white/80" : "text-[#617061]"}`}>{oddsLabel}</span> : null}
                                          </div>
                                        ) : (
                                          <div className={`mt-1 text-xs ${entry.state === "current" ? "text-white/90" : "text-[#617061]"}`}>
                                            {entry.state === "current" ? "Drafting now" : "Upcoming"}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                            <div className="grid gap-2 overflow-x-hidden pr-0">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="m-0 font-[Georgia] text-lg">Team Rosters</h4>
                                <span className="rounded-full bg-[#f2eadf] px-2.5 py-0.5 text-xs text-[#617061]">{picks.length} of {totalPicks} picks made</span>
                              </div>
                            {!assignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Set the draft order before using the board.</div> : (
                              <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                                {teamDraftRosters.map(({ team, picks: teamPicks, isMine }) => (
                                  <div key={team.id} className={`grid min-h-[158px] content-start gap-2 rounded-xl border p-3 ${isMine ? "border-[#1a5c3a]/60 bg-[#e0eee4] shadow-[0_8px_18px_rgba(26,92,58,0.14)]" : "border-black/10 bg-white/85"}`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#617061]">{team.draft_slot ? `Draft slot ${team.draft_slot}` : "No slot"}</div>
                                        <strong className="block break-words leading-tight">{team.name}</strong>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                        {isMine ? <span className="rounded-full bg-[#1a5c3a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">My Team</span> : null}
                                        {!draftComplete && currentTeamOnClock?.id === team.id ? <span className="rounded-full bg-[#f6d77a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1f2a1d]">On Clock</span> : null}
                                      </div>
                                    </div>
                                    <div className="grid gap-1">
                                      {Array.from({ length: ROUNDS }, (_, index) => {
                                        const roundNumber = index + 1;
                                        const pick = teamPicks.find((entry) => entry.round_number === roundNumber) ?? null;
                                        return (
                                          <div key={`${team.id}-round-${roundNumber}`} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${pick ? "bg-white/90" : "bg-[#f7f2e9] text-[#617061]"}`}>
                                            <span className="rounded-full bg-[#f2eadf] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a5940]">R{roundNumber}</span>
                                            <span className="min-w-0 break-words font-medium leading-tight">{pick?.player_name ?? "Waiting"}</span>
                                            {pick ? (
                                              <span className="flex shrink-0 items-center gap-2">
                                                {playerOddsLabel(pick.player_name) ? <span className="text-[11px] font-semibold text-[#617061]">{playerOddsLabel(pick.player_name)}</span> : null}
                                                {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-2 py-0.5 text-[11px] text-[#1a5c3a]" onClick={() => beginSwap(pick, team.name)}>Swap</button> : null}
                                              </span>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                    </div>
                  </div>
                </div>
                  ) : null}

                {currentSession && activeRoomTab === "results" ? (
                  <div className="grid gap-3">
                    <div className="grid items-start gap-2 xl:grid-cols-4">
                      <div className="grid gap-2 md:grid-cols-2 xl:col-span-3 xl:grid-cols-3">
                          {!leaderboard.length ? <div className="rounded-xl border border-black/10 bg-[#f7f2e9] p-4 text-[#617061] xl:col-span-3">No active teams are ready to score yet.</div> : leaderboard.map((entry, index) => (
                          <div key={entry.team.id} className={`grid gap-1.5 rounded-2xl p-2.5 text-[#1f2a1d] shadow-[0_10px_22px_rgba(15,25,18,0.12)] ${index === 0 ? "bg-[#f6d77a]" : index === 1 ? "bg-[#e7ecef]" : index === 2 ? "bg-[#e1b18a]" : "bg-white/92"}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.16em] text-[#617061]">#{index + 1}</div>
                                <strong>{entry.team.name}</strong>
                              </div>
                              <div className="rounded-full bg-[#1a5c3a] px-2.5 py-0.5 text-xs font-semibold text-white">{entry.total} pts</div>
                            </div>
                            <div className="grid gap-1 text-xs">
                              {!entry.playerScores.length ? <div className="text-[#617061]">No drafted golfers yet.</div> : entry.playerScores.map((player) => (
                                <div key={player.id} className={`grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-xl px-2 py-1.5 ${entry.countingKeys.has(player.id) ? "bg-[#e0eee4]" : "bg-[#f4efe6]"}`}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <div className="truncate font-medium leading-tight">{player.player_name}</div>
                                      {player.total ? <span className={`shrink-0 text-xs font-semibold ${totalColorClass(player.total)}`}>{player.total}</span> : null}
                                    </div>
                                    <div className="text-[10px] text-[#617061]">
                                      {resultStatusLabel(player.position, player.total, player.thru, player.meta)}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-semibold">{player.points}</div>
                                    <div className="text-[9px] uppercase tracking-[0.12em] text-[#617061]">{entry.countingKeys.has(player.id) ? "Counts" : "Bench"}</div>
                                  </div>
                                  <div className="col-span-2 grid grid-cols-9 gap-0.5">
                                    {Array.from({ length: 18 }, (_, holeIndex) => {
                                      const filled = holeIndex < holesCompletedForDisplay(player.thru, player.meta);
                                      return (
                                        <span
                                          key={`${player.id}-hole-${holeIndex + 1}`}
                                          className={`h-1 rounded-full ${filled ? "bg-[#1a5c3a]" : "bg-black/10"}`}
                                          title={`Hole ${holeIndex + 1}`}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      <aside className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_10px_22px_rgba(15,25,18,0.1)] xl:sticky xl:top-4">
                        <div className="flex items-center justify-between gap-2 bg-[#174a35] px-3 py-2.5 text-white">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/70">Tournament</div>
                            <strong className="text-sm">Live Leaderboard</strong>
                          </div>
                          <div className="flex gap-1">
                            <button className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={tournamentLeaderboardLoading} onClick={() => loadTournamentLeaderboard(false)}>{tournamentLeaderboardLoading ? "..." : "Refresh"}</button>
                            <button className="rounded-full bg-[#f6d77a] px-2.5 py-1 text-[11px] font-semibold text-[#1f2a1d]" onClick={openTournamentLeaderboard}>Expand</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-[38px_minmax(0,1fr)_38px_42px] gap-1 border-b border-black/10 bg-[#f2eadf] px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#617061]">
                          <span>Pos</span><span>Golfer</span><span className="text-right">Score</span><span className="text-right">Thru</span>
                        </div>
                        <div className="max-h-[720px] overflow-y-auto">
                          {tournamentLeaderboardLoading && !tournamentLeaderboardRows.length ? (
                            <div className="p-4 text-center text-sm text-[#617061]">Loading leaderboard...</div>
                          ) : !tournamentLeaderboardRows.length ? (
                            <div className="p-4 text-center text-sm text-[#617061]">Leaderboard not available yet.</div>
                          ) : tournamentLeaderboardRows.map((row, index) => (
                            <div key={`${row.name}-side-${index}`} className={`grid grid-cols-[38px_minmax(0,1fr)_38px_42px] items-center gap-1 border-b border-black/5 px-2 py-1.5 text-xs last:border-b-0 ${index < 3 ? "bg-[#f9f4df]" : "bg-white"}`}>
                              <strong className="text-[#1a5c3a]">{row.positionLabel}</strong>
                              <span className="truncate font-medium">{row.name}</span>
                              <span className={`text-right font-semibold ${totalColorClass(row.total)}`}>{row.total ?? "-"}</span>
                              <span className="text-right text-[#617061]">{row.thru ?? "-"}</span>
                            </div>
                          ))}
                        </div>
                      </aside>
                    </div>
                  </div>
                ) : null}

                {activeRoomTab === "season" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="m-0 font-[Georgia] text-xl">Season Stats</h3>
                          <div className="mt-1 text-sm text-[#617061]">
                            {seasonStatsYear === "all" ? "All years" : seasonStatsYear} | {seasonStatsView === "league" ? "Official league tournaments" : "Every tournament and side event"}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-start justify-end gap-2">
                          <label className="grid gap-1 text-[10px] font-semibold uppercase text-[#617061]">
                            Year
                            <select className="rounded-lg border border-[#1a5c3a]/20 bg-white px-3 py-2 text-sm font-medium normal-case text-[#1f2a1d]" value={seasonStatsYear} onChange={(event) => setSeasonStatsYear(event.target.value === "all" ? "all" : Number(event.target.value))}>
                              <option value="all">All Years</option>
                              {availableSeasonYears.map((year) => <option key={year} value={year}>{year}</option>)}
                            </select>
                          </label>
                          <label className="grid gap-1 text-[10px] font-semibold uppercase text-[#617061]">
                            Events
                            <select className="rounded-lg border border-[#1a5c3a]/20 bg-white px-3 py-2 text-sm font-medium normal-case text-[#1f2a1d]" value={seasonStatsView} onChange={(event) => setSeasonStatsView(event.target.value as SeasonStatsView)}>
                              <option value="league">League Season</option>
                              <option value="all">All Tournaments</option>
                            </select>
                          </label>
                          <details className="relative">
                            <summary className="mt-[14px] cursor-pointer list-none rounded-lg border border-[#1a5c3a]/20 bg-white px-3 py-2 text-sm font-semibold text-[#1a5c3a]">Customize</summary>
                            <div className="absolute right-0 z-20 mt-2 grid w-56 gap-2 rounded-xl border border-black/10 bg-white p-3 shadow-[0_14px_30px_rgba(15,25,18,0.16)]">
                              {([
                                ["standings", "Points standings"],
                                ["leaders", "Performance leaders"],
                                ["profiles", "Draft and scoring profiles"],
                              ] as Array<[SeasonStatSection, string]>).map(([section, label]) => (
                                <label key={section} className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={seasonStatSections[section]} onChange={(event) => setSeasonStatSections((current) => ({ ...current, [section]: event.target.checked }))} />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </details>
                        </div>
                      </div>
                      <div className="mb-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{completedSeasonSessions.length} completed events</span>
                        <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{seasonStats.length} teams tracked</span>
                        {seasonStatsView === "league" ? <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{yearCountedSeasonSessions.length} events selected</span> : null}
                      </div>
                      {seasonStatsLoading ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Loading season stats...</div> : !seasonStats.length ? (
                        <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No completed tournament data is ready for season stats yet.</div>
                      ) : !Object.values(seasonStatSections).some(Boolean) ? (
                        <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Choose at least one section from Customize to display season statistics.</div>
                      ) : (
                        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
                          {seasonStatSections.standings ? <div className={`${seasonStatSections.leaders ? "" : "xl:col-span-2"} min-w-0 overflow-hidden rounded-2xl border border-black/10 bg-white/85`}>
                            <div className="grid grid-cols-[42px_minmax(100px,1fr)_70px_70px_64px] gap-2 border-b border-black/10 bg-[#f7f2e9] px-3 py-2 text-[10px] font-semibold uppercase text-[#617061]">
                              <span>Rank</span><span>Team</span><span className="text-right">Points</span><span className="text-right">Avg</span><span className="text-right">Events</span>
                            </div>
                            {seasonStats.map((entry, index) => (
                              <div key={entry.teamName} className={`grid grid-cols-[42px_minmax(100px,1fr)_70px_70px_64px] items-center gap-2 border-b border-black/5 px-3 py-3 text-sm last:border-0 ${index < 3 ? "bg-[#fffaf0]" : ""}`}>
                                <strong className="text-[#617061]">#{index + 1}</strong>
                                <span className="truncate font-semibold">{entry.teamName}</span>
                                <strong className="text-right text-[#1a5c3a]">{entry.seasonPoints}</strong>
                                <span className="text-right">{entry.eventsPlayed ? (entry.seasonPoints / entry.eventsPlayed).toFixed(1) : "0.0"}</span>
                                <span className="text-right text-[#617061]">{entry.eventsPlayed}</span>
                              </div>
                            ))}
                          </div> : null}
                          {seasonStatSections.leaders ? <div className={`${seasonStatSections.standings ? "" : "xl:col-span-2"} grid content-start gap-2`}>
                            <h4 className="m-0 font-[Georgia] text-lg">Performance Leaders</h4>
                            {seasonStats.slice(0, 5).map((entry, index) => (
                              <div key={entry.teamName} className="grid grid-cols-[36px_minmax(0,1fr)_repeat(3,52px)] items-center gap-2 rounded-xl border border-black/10 bg-white/85 px-3 py-2 text-sm">
                                <strong className="text-[#617061]">#{index + 1}</strong>
                                <span className="truncate font-semibold">{entry.teamName}</span>
                                <span className="text-center"><span className="block text-[9px] uppercase text-[#617061]">Wins</span>{entry.wins}</span>
                                <span className="text-center"><span className="block text-[9px] uppercase text-[#617061]">Top 3</span>{entry.top3}</span>
                                <span className="text-center"><span className="block text-[9px] uppercase text-[#617061]">Best</span>{entry.bestFinish ? `#${entry.bestFinish}` : "-"}</span>
                              </div>
                            ))}
                          </div> : null}
                          {seasonStatSections.profiles ? <div className="grid gap-3 xl:col-span-2">
                            <div>
                              <h4 className="m-0 font-[Georgia] text-lg">Draft & Scoring Profiles</h4>
                              <div className="mt-1 text-xs text-[#617061]">Team to par uses the three counting golfers from each event with a recorded final score.</div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {seasonStats.map((entry) => (
                                <div key={entry.teamName} className="grid gap-3 rounded-2xl border border-black/10 bg-white/85 p-4">
                                  <div className="flex items-start justify-between gap-3">
                                    <strong className="truncate">{entry.teamName}</strong>
                                    <span className={`shrink-0 font-semibold ${entry.totalToPar < 0 ? "text-[#9d2f2f]" : "text-[#1a5c3a]"}`}>{entry.toParScores ? formatToPar(entry.totalToPar) : "-"}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Most Drafted</span>
                                      <span className="block truncate font-semibold">{entry.mostDraftedGolfer ?? "-"}</span>
                                      <span className="text-xs text-[#617061]">{entry.mostDraftedCount ? `${entry.mostDraftedCount} selections` : "No picks"}</span>
                                    </div>
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Draft Variety</span>
                                      <span className="block font-semibold">{entry.uniqueGolfers} golfers</span>
                                      <span className="text-xs text-[#617061]">{entry.eventsPlayed} events</span>
                                    </div>
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Cut Rate</span>
                                      <span className="block font-semibold">{entry.completedGolferResults ? `${((entry.cuts / entry.completedGolferResults) * 100).toFixed(0)}%` : "-"}</span>
                                      <span className="text-xs text-[#617061]">{entry.cuts} of {entry.completedGolferResults} results</span>
                                    </div>
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Podium Rate</span>
                                      <span className="block font-semibold">{entry.eventsPlayed ? `${((entry.top3 / entry.eventsPlayed) * 100).toFixed(0)}%` : "-"}</span>
                                      <span className="text-xs text-[#617061]">{entry.top3} top-three finishes</span>
                                    </div>
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Best Event</span>
                                      <span className="block font-semibold">{entry.bestEventPoints} pts</span>
                                      <span className="text-xs text-[#617061]">Highest weekly total</span>
                                    </div>
                                    <div className="rounded-xl bg-[#f7f2e9] px-3 py-2">
                                      <span className="block text-[9px] font-semibold uppercase text-[#617061]">Most Successful Golfer</span>
                                      <span className="block truncate font-semibold">{entry.mostSuccessfulGolfer ?? "-"}</span>
                                      <span className="text-xs text-[#617061]">{entry.mostSuccessfulGolfer ? `${entry.mostSuccessfulGolferPoints} fantasy points` : "No points"}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div> : null}
                        </div>
                      )}
                    </div>
                    {canManageLeague ? (
                      <details className="rounded-2xl border border-black/10 bg-white/60">
                        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4">
                          <span className="min-w-0">
                            <strong className="block font-[Georgia] text-lg">Manage Tournament Schedule</strong>
                            <span className="block text-sm text-[#617061]">
                              {seasonStatsYear === "all" ? "All years" : seasonStatsYear}: {yearCountedSeasonSessions.length} selected of {scheduleSessions.length} tournaments
                            </span>
                          </span>
                          <span className="rounded-lg border border-[#1a5c3a]/20 bg-white px-3 py-2 text-sm font-semibold text-[#1a5c3a]">Edit</span>
                        </summary>
                        <div className="border-t border-black/10 p-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#617061]">
                            <span>Checked events count in League Season. Unchecked events still appear in All Tournaments.</span>
                            {seasonStatsYear !== "all" ? <span className={`rounded-full px-3 py-1 font-semibold ${yearCountedSeasonSessions.length === SEASON_EVENT_TARGET ? "bg-[#d9eadf] text-[#1a5c3a]" : "bg-[#f6d77a] text-[#6a4b16]"}`}>Target: {SEASON_EVENT_TARGET}</span> : null}
                          </div>
                          {!scheduleSessions.length ? (
                            <div className="rounded-xl bg-[#f7f2e9] px-3 py-3 text-sm text-[#617061]">No tournaments are saved for this year.</div>
                          ) : (
                            <div className="grid gap-2 md:grid-cols-2">
                              {scheduleSessions.map((session) => {
                                const counts = sessionCountsForSeason(session);
                                return (
                                  <label key={session.id} className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-l-4 px-3 py-2.5 ${counts ? "border-black/10 border-l-[#1a5c3a] bg-white" : "border-black/10 border-l-[#b6aa98] bg-[#f4efe6]"}`}>
                                    <input type="checkbox" checked={counts} onChange={(event) => setSessionCountsForSeason(session, event.target.checked)} />
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-semibold">{session.event_name ?? session.name}</span>
                                      <span className="block text-[11px] text-[#617061]">{formatTournamentDate(sessionEventDates[session.id], resolvedSessionSeasons[session.id] ?? sessionEventSeason(session))}</span>
                                    </span>
                                    <span className={`text-[10px] font-semibold uppercase ${counts ? "text-[#1a5c3a]" : "text-[#7b6d5b]"}`}>{counts ? "Counts" : "Side"}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
        </section>
      </div>
      )}
    </div>
  );
}

