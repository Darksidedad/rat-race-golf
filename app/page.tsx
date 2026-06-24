"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type EventOption = { id: string; name: string; season: number; startDate?: string; dateLabel?: string; location?: string; course?: string };
type DraftSession = {
  id: string;
  league_id: string | null;
  event_tour: string | null;
  event_season: number | null;
  counts_for_season: boolean;
  name: string;
  event_id: string | null;
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
type Profile = { id: string; username: string; team_name: string | null; role: "commissioner" | "assistant_commissioner" | "member"; site_role: "site_admin" | "user"; active_league_id: string | null; created_at: string };
type DraftPick = { id: string; session_id: string; team_id: string; player_name: string; player_key: string; pick_number: number; round_number: number; created_at: string };
type League = { id: string; name: string; slug: string; created_by: string | null; created_at: string };
type LeagueMembership = { id: string; league_id: string; user_id: string; role: Profile["role"]; claimed_team_name: string | null; created_at: string };
type NewDraftTeam = { name: string; selected: boolean };
type EspnEventsResponse = { ok: boolean; events?: EventOption[]; error?: string };
type EspnFieldResponse = { ok: boolean; eventName?: string; players?: string[]; source?: string; error?: string };
type EspnLeaderboardResponse = { ok: boolean; eventName?: string; leaderboard?: Record<string, number | null>; totals?: Record<string, string | null>; finalized?: boolean; error?: string };
type EspnOddsResponse = { ok: boolean; eventName?: string; odds?: Record<string, number>; source?: string; error?: string };
type PlayerPoolEntry = { name: string; odds?: number };
type RoomTab = "setup" | "admin" | "draft" | "results" | "profile" | "season";
type SeasonStatsView = "league" | "all";
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
};

const ROUNDS = 4;
const SEASON_EVENT_TARGET = 10;
const SEASON_EXCLUDED_MARKER = "# RRG_SIDE_EVENT";
const CURRENT_GOLF_SEASON = new Date().getFullYear();
const HISTORICAL_SEASONS = Array.from({ length: 8 }, (_, index) => CURRENT_GOLF_SEASON - index);
const DEFAULT_TEAM_NAMES = ["Ryan","Morris","Russ","Swany","Capps","Seth","Jay","Teron","Jesse","Drew","Jimmy","Jones"];
const DEFAULT_NEW_DRAFT_TEAMS: NewDraftTeam[] = DEFAULT_TEAM_NAMES.map((name) => ({ name, selected: true }));
const TOUR_OPTIONS = [
  { id: "pga", label: "PGA TOUR" },
  { id: "lpga", label: "LPGA Tour" },
  { id: "ntw", label: "Korn Ferry Tour" },
  { id: "eur", label: "DP World Tour" },
  { id: "champions", label: "PGA TOUR Champions" },
  { id: "liv", label: "LIV Golf" },
];
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function sessionCountsForSeason(session: DraftSession) {
  return session.counts_for_season !== false
    && !String(session.manual_leaderboard_input ?? "").split(/\r?\n/).some((line) => line.trim() === SEASON_EXCLUDED_MARKER);
}

function manualLeaderboardWithSeasonSetting(input: string | null | undefined, countsForSeason: boolean) {
  const lines = String(input ?? "").split(/\r?\n/).filter((line) => line.trim() !== SEASON_EXCLUDED_MARKER);
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

function parseManualLeaderboard(input: string) {
  const result: Record<string, number | null> = {};
  input.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const match = line.match(/^(T?\d+|CUT|WD|DQ)\s+(.+)$/i);
    if (!match) return;
    const raw = match[1].toUpperCase();
    result[normalizeName(match[2].trim())] = raw === "CUT" || raw === "WD" || raw === "DQ" ? null : Number(raw.replace("T", ""));
  });
  return result;
}

function pointsForPosition(position: number | null) {
  return position === null || position < 1 ? 0 : Math.max(0, 51 - position);
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

function parseStoredThru(total: string | null | undefined) {
  if (!total || !total.includes("||")) return null;
  const [, thru] = total.split("||");
  return normalizeStoredThru(thru);
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
  if (!total && !normalizedThru && !playoff) return "No leaderboard match";
  return playoff ?? normalizedThru ?? "CUT / no finish";
}

function formatProfileLabel(username: string, teamName: string | null | undefined) {
  const trimmedTeam = teamName?.trim();
  if (!trimmedTeam) return username;
  return normalizeName(trimmedTeam) === normalizeName(username) ? username : `${username} (${trimmedTeam})`;
}

function getAssignedActiveTeams(teams: DraftTeam[]) {
  return teams.filter((team) => team.draft_slot !== null).sort((a, b) => (a.draft_slot ?? 0) - (b.draft_slot ?? 0));
}

function nextAvailableDraftSlot(teams: DraftTeam[]) {
  const usedSlots = new Set(teams.map((team) => team.draft_slot).filter((slot): slot is number => slot !== null));
  let nextSlot = 1;
  while (usedSlots.has(nextSlot)) nextSlot += 1;
  return nextSlot;
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
      <div className="rrg-brand__badge">
        <span className="rrg-brand__track" />
        <span className="rrg-brand__green" />
        <span className="rrg-brand__pin" />
        <span className="rrg-brand__ball" />
      </div>
      <div className="rrg-brand__text">
        <div className="rrg-brand__eyebrow">Private Fantasy Golf League</div>
        <div className="rrg-brand__name">
          <span className="rrg-brand__primary">Rat Race</span>
          <span className="rrg-brand__accent">Golf</span>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const draftFlowRef = useRef<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<DraftSession[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [siteProfiles, setSiteProfiles] = useState<Profile[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [memberships, setMemberships] = useState<LeagueMembership[]>([]);
  const [currentLeagueId, setCurrentLeagueId] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [currentSession, setCurrentSession] = useState<DraftSession | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [sessionEventDates, setSessionEventDates] = useState<Record<string, string>>({});
  const [currentSessionEventDetails, setCurrentSessionEventDetails] = useState<EventOption | null>(null);
  const [newDraftTour, setNewDraftTour] = useState("pga");
  const [newDraftSeason, setNewDraftSeason] = useState(CURRENT_GOLF_SEASON);
  const [newSessionCountsForSeason, setNewSessionCountsForSeason] = useState(true);
  const [newSessionEventId, setNewSessionEventId] = useState("");
  const [newDraftModalOpen, setNewDraftModalOpen] = useState(false);
  const [newDraftTeams, setNewDraftTeams] = useState<NewDraftTeam[]>(DEFAULT_NEW_DRAFT_TEAMS);
  const [draggedNewDraftTeam, setDraggedNewDraftTeam] = useState("");
  const [dragOverNewDraftTeam, setDragOverNewDraftTeam] = useState("");
  const [newLeagueName, setNewLeagueName] = useState("");
  const [newLeagueMemberId, setNewLeagueMemberId] = useState("");
  const [pendingLeagueSlug, setPendingLeagueSlug] = useState("");
  const [playerPoolDraft, setPlayerPoolDraft] = useState("");
  const [manualLeaderboardDraft, setManualLeaderboardDraft] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authTeamName, setAuthTeamName] = useState("");
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("");
  const [profileDraftName, setProfileDraftName] = useState("");
  const [profileDraftTeam, setProfileDraftTeam] = useState("");
  const [seasonStats, setSeasonStats] = useState<SeasonTeamStat[]>([]);
  const [seasonStatsLoading, setSeasonStatsLoading] = useState(false);
  const [seasonStatsView, setSeasonStatsView] = useState<SeasonStatsView>("league");
  const [statusMessage, setStatusMessage] = useState("Loading league data...");
  const [busy, setBusy] = useState("");
  const [activeRoomTab, setActiveRoomTab] = useState<RoomTab>("draft");
  const [editingPick, setEditingPick] = useState<EditingPick | null>(null);
  const [highlightedPlayerIndex, setHighlightedPlayerIndex] = useState(0);
  const [oddsByPlayer, setOddsByPlayer] = useState<Record<string, number>>({});
  const [oddsSource, setOddsSource] = useState("");
  const [autoFieldImportAttempts, setAutoFieldImportAttempts] = useState<Record<string, boolean>>({});
  const [autoTeamClaimAttempts, setAutoTeamClaimAttempts] = useState<Record<string, boolean>>({});
  const [autoFieldRefreshAttempts, setAutoFieldRefreshAttempts] = useState<Record<string, boolean>>({});
  const deferredFilter = useDeferredValue(playerFilter);
  const currentLeague = useMemo(() => leagues.find((league) => league.id === currentLeagueId) ?? null, [leagues, currentLeagueId]);
  const countedSeasonSessions = useMemo(
    () => sessions.filter(sessionCountsForSeason),
    [sessions]
  );
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => {
    const aDate = sessionEventDates[a.id] ?? `${a.event_season ?? 0}-01-01`;
    const bDate = sessionEventDates[b.id] ?? `${b.event_season ?? 0}-01-01`;
    const dateDifference = new Date(bDate).getTime() - new Date(aDate).getTime();
    return dateDifference || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }), [sessionEventDates, sessions]);
  const completedSeasonSessions = useMemo(() => sessions.filter((session) =>
    (seasonStatsView === "all" || sessionCountsForSeason(session))
    && (session.status === "scored" || session.status === "finalized")
    && Object.keys(session.current_positions ?? {}).length > 0
  ), [seasonStatsView, sessions]);
  const currentLeagueInviteUrl = useMemo(() => {
    if (typeof window === "undefined" || !currentLeague?.slug) return "";
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("join", currentLeague.slug);
    return url.toString();
  }, [currentLeague?.slug]);
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
    const inviteSlug = params.get("join")?.trim().toLowerCase() || window.localStorage.getItem("rrg_pending_league_slug") || "";
    if (!inviteSlug) return;
    window.localStorage.setItem("rrg_pending_league_slug", inviteSlug);
    setPendingLeagueSlug(inviteSlug);
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
  }, [currentSession?.event_id, currentSession?.event_season, currentSession?.event_tour]);

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
      setSessions([]);
      setCurrentSession(null);
      setTeams([]);
      setPicks([]);
      setSelectedSessionId("");
      setStatusMessage(pendingLeagueSlug ? "Sign in or create an account to join this league." : "Sign in to access the league.");
      return;
    }

    void loadProfile(user.id);
  }, [authChecked, pendingLeagueSlug, user]);


  useEffect(() => {
    setSelectedSessionId("");
    setCurrentSession(null);
    setTeams([]);
    setPicks([]);
  }, [currentLeagueId]);

  useEffect(() => {
    if (!authChecked || !user || !currentLeagueId) {
      if (authChecked && user && !currentLeagueId) setSessions([]);
      return;
    }
    void loadSessions();
  }, [authChecked, user, currentLeagueId]);
  useEffect(() => {
    if (!selectedSessionId && sortedSessions[0]?.id) setSelectedSessionId(sortedSessions[0].id);
  }, [selectedSessionId, sortedSessions]);

  useEffect(() => {
    if (!sessions.length) {
      setSessionEventDates({});
      return;
    }
    void loadSessionEventDates(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (!user) return;
    loadSession(selectedSessionId);
    const channel = supabase
      .channel(`draft-${selectedSessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_sessions", filter: `id=eq.${selectedSessionId}` }, () => { loadSessions(); loadSession(selectedSessionId); })
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_teams", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `session_id=eq.${selectedSessionId}` }, () => loadSession(selectedSessionId, false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSessionId, user]);

  useEffect(() => {
    setPlayerPoolDraft(currentSession?.player_input ?? "");
    setManualLeaderboardDraft(manualLeaderboardWithSeasonSetting(currentSession?.manual_leaderboard_input, true));
  }, [currentSession?.id, currentSession?.player_input, currentSession?.manual_leaderboard_input]);

  useEffect(() => {
    if (!currentSession) return;
    setNewDraftTour(currentSession.event_tour ?? "pga");
    setNewDraftSeason(currentSession.event_season ?? CURRENT_GOLF_SEASON);
  }, [currentSession?.id, currentSession?.event_season, currentSession?.event_tour]);

  useEffect(() => {
    if (currentSession?.odds_snapshot && Object.keys(currentSession.odds_snapshot).length) {
      setOddsByPlayer(currentSession.odds_snapshot);
      setOddsSource(currentSession.odds_source ?? "");
      return;
    }
    if (!currentSession?.event_name) {
      setOddsByPlayer({});
      setOddsSource("");
      return;
    }
    loadOdds(currentSession.event_name, currentSession.event_season ?? CURRENT_GOLF_SEASON);
  }, [currentSession?.event_name, currentSession?.event_season, currentSession?.odds_snapshot, currentSession?.odds_source]);

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
    setProfileDraftTeam(currentMembership?.claimed_team_name ?? profile?.team_name ?? "");
  }, [currentMembership?.claimed_team_name, profile?.username, profile?.team_name]);

  useEffect(() => {
    if (activeRoomTab !== "season" || !sessions.length) return;
    void loadSeasonStats();
  }, [activeRoomTab, profiles, seasonStatsView, sessions]);

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
  const unassignedTeams = useMemo(() => teams.filter((team) => team.draft_slot === null).sort((a, b) => a.name.localeCompare(b.name)), [teams]);
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
    const claimedTeamName = currentMembership?.claimed_team_name ?? profile?.team_name ?? "";
    return assignedTeams
      .map((team) => ({
        team,
        isMine: team.owner_user_id === user?.id || (!!claimedTeamName && normalizeName(team.name) === normalizeName(claimedTeamName)),
        picks: picks
          .filter((pick) => pick.team_id === team.id)
          .sort((a, b) => a.round_number - b.round_number || a.pick_number - b.pick_number),
      }))
      .sort((a, b) => {
        if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
        return (a.team.draft_slot ?? 999) - (b.team.draft_slot ?? 999);
      });
  }, [assignedTeams, currentMembership?.claimed_team_name, picks, profile?.team_name, user?.id]);
  const leaderboard = useMemo(() => {
    const positions = currentSession?.current_positions ?? {};
    const totals = currentSession?.current_totals ?? {};
        return assignedTeams.map((team) => {
          const playerScores = picks.filter((pick) => pick.team_id === team.id).map((pick) => {
          const position = lookupLeaderboardValue(pick.player_name, positions) ?? null;
          const total = lookupLeaderboardValue(pick.player_name, totals) ?? null;
          const storedTotal = parseStoredTotal(total);
          const storedThru = parseStoredThru(total);
          const normalizedResult = normalizeLegacyNonScoringResult(position, storedTotal, storedThru);
          const displayTotal = normalizedResult.total;
          const thru = normalizedResult.thru;
          const meta = parseStoredMeta(total);
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
  }, [assignedTeams, currentSession?.current_positions, currentSession?.current_totals, picks]);
  const resultsUpdatedLabel = useMemo(() => {
    if (!currentSession?.updated_at) return "Not updated yet";
    return new Date(currentSession.updated_at).toLocaleString();
  }, [currentSession?.updated_at]);
  const currentUsersTeams = useMemo(() => teams.filter((team) => team.owner_user_id === user?.id), [teams, user?.id]);
  const canDraftCurrentPick = !!user && !!currentTeamOnClock && (isLeagueAdmin || currentTeamOnClock.owner_user_id === user.id);
  const canManageLeague = !!user && isLeagueAdmin;
  const canManagePermissions = !!user && (isSiteAdmin || isCommissioner);
  const resultsFinalized = currentSession?.status === "finalized";
  const ownedTeamNames = currentUsersTeams.map((team) => team.name);
  const activeTeamName = currentMembership?.claimed_team_name ?? profile?.team_name ?? null;
  const showTeamPill = !!activeTeamName && !!profile?.username && normalizeName(activeTeamName) !== normalizeName(profile.username);
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
  }, [canManageLeague, currentSession?.id, currentSession?.event_id, currentSession?.event_tour, currentSession?.player_input]);

  useEffect(() => {
    autoClaimMatchingDraftTeam();
  }, [activeTeamName, currentSession?.id, teams, user?.id]);

  useEffect(() => {
    autoRefreshFieldBeforeDraft();
  }, [activeRoomTab, canManageLeague, currentSession?.id, currentSession?.event_id, currentSession?.event_tour, currentSession?.field_refreshed_at, currentSession?.odds_refreshed_at, picks.length]);

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
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.error(error);
      setStatusMessage("Could not load your league profile.");
      return;
    }

    const nextProfile = (data as Profile | null) ?? null;
    setProfile(nextProfile);

    const defaultLeagueResult = await supabase.rpc("ensure_default_league_membership", {
      claimed_team_name: nextProfile?.team_name ?? null,
    });
    if (defaultLeagueResult.error) {
      console.error(defaultLeagueResult.error);
    }

    await joinPendingLeagueInvite(nextProfile);
    await loadLeagueContext(userId, nextProfile);
  }

  async function joinPendingLeagueInvite(nextProfile: Profile | null) {
    const inviteSlug = pendingLeagueSlug || (typeof window !== "undefined" ? window.localStorage.getItem("rrg_pending_league_slug") ?? "" : "");
    if (!inviteSlug) return;

    const joinResult = await supabase.rpc("join_league_by_slug", {
      target_slug: inviteSlug,
      claimed_team_name: nextProfile?.team_name ?? null,
    });

    if (joinResult.error || !joinResult.data) {
      console.error(joinResult.error);
      if (typeof window !== "undefined") window.localStorage.removeItem("rrg_pending_league_slug");
      setPendingLeagueSlug("");
      setStatusMessage(joinResult.error?.message || "Could not join that league invite.");
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("rrg_pending_league_slug");
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    setPendingLeagueSlug("");
    setCurrentLeagueId(joinResult.data as string);
    setStatusMessage("Joined the league.");
  }

  async function loadLeagueContext(userId: string, nextProfile: Profile | null) {
    const membershipResult = await supabase.from("league_memberships").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (membershipResult.error) {
      console.error(membershipResult.error);
      setStatusMessage("Could not load your league memberships.");
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
      return;
    }

    const nextLeagues = (leagueResult.data ?? []) as League[];
    setLeagues(nextLeagues);
    setCurrentLeagueId((current) => {
      if (current && nextLeagues.some((league) => league.id === current)) return current;
      if (nextProfile?.active_league_id && nextLeagues.some((league) => league.id === nextProfile.active_league_id)) return nextProfile.active_league_id;
      return nextMemberships[0]?.league_id ?? nextLeagues[0]?.id ?? "";
    });
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
    const claimedTeamByUserId = new Map(leagueMemberships.map((membership) => [membership.user_id, membership.claimed_team_name]));
    setProfiles(((data ?? []) as Profile[]).map((entry) => ({
      ...entry,
      role: roleByUserId.get(entry.id) ?? entry.role,
      team_name: claimedTeamByUserId.get(entry.id) ?? entry.team_name,
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
          team_name: authTeamName.trim() || null,
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
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    setBusy("");

    if (error) {
      console.error(error);
      setStatusMessage(error.message || "Could not send the password reset email.");
      return;
    }

    setStatusMessage("Password reset email sent. Open the link in that email and set your new password.");
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
    const leagueResult = await supabase.rpc("create_league_for_site_admin", {
      target_name: leagueName,
      commissioner_claimed_team_name: activeTeamName,
    });

    if (leagueResult.error || !leagueResult.data) {
      console.error(leagueResult.error);
      setBusy("");
      setStatusMessage(leagueResult.error?.message || "Could not create that league.");
      return;
    }

    setNewLeagueName("");
    setBusy("");
    setStatusMessage(`Created ${leagueName}.`);
    setCurrentLeagueId(leagueResult.data as string);
    await loadProfile(user.id);
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
      claimed_team_name: selectedProfile.team_name,
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
        claimed_team_name: entry.team_name,
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
    const nextTeam = profileDraftTeam.trim();

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

    if (currentLeagueId) {
      const membershipResult = await supabase
        .from("league_memberships")
        .update({ claimed_team_name: nextTeam || null })
        .eq("league_id", currentLeagueId)
        .eq("user_id", user.id);

      if (membershipResult.error) {
        console.error(membershipResult.error);
        setBusy("");
        setStatusMessage("Your profile saved, but your league team claim could not be updated.");
        return;
      }
    }

    setBusy("");

    setStatusMessage("Profile updated.");
    await loadProfile(user.id);
    if (canManageLeague) await loadProfiles();
  }

  async function loadSeasonStats() {
    const eligibleSessions = sessions.filter((session) =>
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
    const ownerIds = Array.from(new Set(seasonTeams.map((team) => team.owner_user_id).filter((ownerId): ownerId is string => !!ownerId)));
    const ownerProfilesResult = ownerIds.length
      ? await supabase.from("profiles").select("id, team_name").in("id", ownerIds)
      : { data: [], error: null };
    if (ownerProfilesResult.error) console.error(ownerProfilesResult.error);
    const currentTeamNameByOwner = new Map<string, string>();
    ((ownerProfilesResult.data ?? []) as Pick<Profile, "id" | "team_name">[]).forEach((ownerProfile) => {
      if (ownerProfile.team_name?.trim()) currentTeamNameByOwner.set(ownerProfile.id, ownerProfile.team_name.trim());
    });
    profiles.forEach((ownerProfile) => {
      if (ownerProfile.team_name?.trim()) currentTeamNameByOwner.set(ownerProfile.id, ownerProfile.team_name.trim());
    });
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
      const positions = session.current_positions ?? {};

        const sessionLeaderboard = sessionTeams.map((team) => {
          const playerScores = sessionPicks.filter((pick) => pick.team_id === team.id).map((pick) => {
            const position = lookupLeaderboardValue(pick.player_name, positions) ?? null;
            return pointsForPosition(position);
          });
        const total = [...playerScores].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
        const effectiveOwnerId = team.owner_user_id ?? ownerByHistoricalTeamName.get(normalizeName(team.name)) ?? null;
        const teamName = effectiveOwnerId ? currentTeamNameByOwner.get(effectiveOwnerId) ?? team.name : team.name;
        const teamKey = effectiveOwnerId ? `owner:${effectiveOwnerId}` : `name:${normalizeName(teamName)}`;
        return { teamKey, teamName, total };
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
        };

        const finish = index === 0 || entry.total !== sessionLeaderboard[index - 1].total
          ? index + 1
          : sessionLeaderboard.findIndex((rankedEntry) => rankedEntry.total === entry.total) + 1;
        current.eventsPlayed += 1;
        current.seasonPoints += entry.total;
        current.lastTotal = entry.total;
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
      current.bestFinish = current.bestFinish === null
        ? entry.bestFinish
        : entry.bestFinish === null
          ? current.bestFinish
          : Math.min(current.bestFinish, entry.bestFinish);
      current.lastTotal = entry.lastTotal ?? current.lastTotal;
    });

    setSeasonStats(
      Array.from(consolidated.values()).sort((a, b) => {
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

    if (team.owner_user_id && team.owner_user_id !== ownerId) {
      if (currentLeagueId) {
        const { error: previousMembershipError } = await supabase
          .from("league_memberships")
          .update({ claimed_team_name: null })
          .eq("league_id", currentLeagueId)
          .eq("user_id", team.owner_user_id);

        if (previousMembershipError) {
          console.error(previousMembershipError);
          setStatusMessage("The team owner changed, but the previous member's league claim could not be cleared.");
          return;
        }
      }
    }

    if (ownerId) {
      if (currentLeagueId) {
        const { error: membershipError } = await supabase
          .from("league_memberships")
          .update({ claimed_team_name: nextTeamName })
          .eq("league_id", currentLeagueId)
          .eq("user_id", ownerId);

        if (membershipError) {
          console.error(membershipError);
          setStatusMessage("Could not sync that member's league team claim.");
          return;
        }
      }
    }

    await updateTeam(
      team.id,
      { owner_user_id: ownerId, name: nextTeamName },
      ownerId ? `Assigned ${team.name} to ${selectedProfile?.username ?? "that member"}.` : `Removed the owner for ${team.name}.`
    );
    await loadProfiles();
    if (currentSession) await loadSession(currentSession.id, false);
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
    if (currentSession) await loadSession(currentSession.id, false);
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
    if (currentSession) await loadSession(currentSession.id, false);
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
      return;
    }
    const { data, error } = await supabase.from("draft_sessions").select("*").eq("league_id", currentLeagueId).order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      setStatusMessage("Could not load tournament sessions from Supabase.");
      return;
    }
    setSessions((data ?? []) as DraftSession[]);
  }

  async function loadSessionEventDates(sessionList: DraftSession[]) {
    const groups = new Map<string, { tour: string; season: number; sessions: DraftSession[] }>();
    sessionList.forEach((session) => {
      if (!session.event_id) return;
      const tour = session.event_tour ?? "pga";
      const season = session.event_season ?? CURRENT_GOLF_SEASON;
      const key = `${tour}:${season}`;
      const group = groups.get(key) ?? { tour, season, sessions: [] };
      group.sessions.push(session);
      groups.set(key, group);
    });

    const dateEntries = await Promise.all(Array.from(groups.values()).map(async (group) => {
      try {
        const response = await fetch(`/api/espn-golf?action=events&tour=${encodeURIComponent(group.tour)}&season=${group.season}`);
        const payload: EspnEventsResponse = await response.json();
        if (!payload.ok || !payload.events) return [];
        const eventsById = new Map(payload.events.map((event) => [event.id, event]));
        return group.sessions.flatMap((session) => {
          const startDate = session.event_id ? eventsById.get(session.event_id)?.startDate : undefined;
          return startDate ? [[session.id, startDate] as const] : [];
        });
      } catch (error) {
        console.error(error);
        return [];
      }
    }));

    setSessionEventDates(Object.fromEntries(dateEntries.flat()));
  }

  async function loadSession(sessionId: string, setLoading = true) {
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
    if (nextSession?.status === "draft_complete" || nextSession?.status === "scored" || nextSession?.status === "finalized") {
      setActiveRoomTab("results");
    } else if (activeRoomTab === "results" && nextSession?.status === "setup") {
      setActiveRoomTab("draft");
    }
    setBusy("");
  }

  async function loadEvents(tourId = newDraftTour, season = newDraftSeason) {
    try {
      const response = await fetch(`/api/espn-golf?action=events&tour=${encodeURIComponent(tourId)}&season=${season}`);
      const payload: EspnEventsResponse = await response.json();
      if (!payload.ok || !payload.events) throw new Error(payload.error);
      setEvents(payload.events);
      setNewSessionEventId((current) => payload.events?.some((event) => event.id === current) ? current : payload.events?.[0]?.id ?? "");
    } catch (error) {
      console.error(error);
      setEvents([]);
      setNewSessionEventId("");
      setStatusMessage(`Could not load ${season} ${TOUR_OPTIONS.find((tour) => tour.id === tourId)?.label ?? "tour"} events from ESPN.`);
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
        const seasonQuery = currentSession.event_season ?? CURRENT_GOLF_SEASON;
        const response = await fetch(`/api/espn-golf?action=events&tour=${encodeURIComponent(tourId)}&season=${seasonQuery}`);
        const payload: EspnEventsResponse = await response.json();
        if (!payload.ok || !payload.events) continue;
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
      const response = await fetch(`/api/espn-golf?action=odds&eventName=${encodeURIComponent(eventName)}&season=${season}`);
      const payload: EspnOddsResponse = await response.json();
      if (!payload.ok || !payload.odds) {
        setOddsByPlayer({});
        setOddsSource("");
        return;
      }
      setOddsByPlayer(payload.odds);
      setOddsSource(payload.source ?? "");
    } catch (error) {
      console.error(error);
      setOddsByPlayer({});
      setOddsSource("");
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
    await loadSession(currentSession.id, false);
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

  async function saveFieldSnapshot(sessionId: string, field: Awaited<ReturnType<typeof fetchEspnFieldInput>>, eventName: string | null | undefined, message: string) {
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
    setOddsSource(field.oddsSource);
    setStatusMessage(message);
    await loadSessions();
    await loadSession(sessionId, false);
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
    await loadSession(currentSession.id, false);
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
    await loadSession(selectedSessionId, false);
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
    setNewDraftTeams(DEFAULT_NEW_DRAFT_TEAMS);
    setNewSessionCountsForSeason(true);
    setDraggedNewDraftTeam("");
    setDragOverNewDraftTeam("");
    if (events[0]?.id) setNewSessionEventId(events[0].id);
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
    if (event.target instanceof HTMLElement && event.target.closest("input, label")) {
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

  async function fetchEspnFieldInput(eventId: string, tourId: string | null | undefined, season = CURRENT_GOLF_SEASON) {
    const tourQuery = tourId ? `&tour=${encodeURIComponent(tourId)}` : "";
    const response = await fetch(`/api/espn-golf?action=field&eventId=${encodeURIComponent(eventId)}${tourQuery}&season=${season}`);
    const payload: EspnFieldResponse = await response.json();
    if (!payload.ok || !payload.players?.length) throw new Error(payload.error || "ESPN did not return any golfers for that event yet.");
    const cleanedPlayers = parsePlayerPoolInput(payload.players.join("\n"));
    if (!cleanedPlayers.length) throw new Error("ESPN returned a field, but no valid golfer names were found.");
    let odds: Record<string, number> = {};
    let oddsSource = "";
    if (payload.eventName) {
      try {
        const oddsResponse = await fetch(`/api/espn-golf?action=odds&eventName=${encodeURIComponent(payload.eventName)}&season=${season}`);
        const oddsPayload: EspnOddsResponse = await oddsResponse.json();
        odds = oddsPayload.ok && oddsPayload.odds ? oddsPayload.odds : {};
        oddsSource = oddsPayload.source ?? "";
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
    let importedField: Awaited<ReturnType<typeof fetchEspnFieldInput>> | null = null;
    try {
      const field = await fetchEspnFieldInput(event.id, newDraftTour, newDraftSeason);
      importedField = field;
      playerInput = field.playerInput;
      importedPlayerCount = field.playerCount;
      importedOddsCount = field.oddsCount;
      setOddsByPlayer(field.odds);
      setOddsSource(field.oddsSource);
    } catch (error) {
      console.error(error);
      fieldImportMessage = error instanceof Error && error.message ? ` ESPN field was not imported: ${error.message}` : " ESPN field was not imported yet.";
    }
    const sessionPayload = { league_id: currentLeagueId, event_tour: newDraftTour, event_season: newDraftSeason, counts_for_season: newSessionCountsForSeason, name: trimmedName, event_id: event.id, event_name: event.name, player_input: playerInput, manual_leaderboard_input: "", current_positions: {}, current_totals: {}, status: "setup", commissioner_id: user.id };
    let sessionInsert = await supabase.from("draft_sessions").insert([sessionPayload]).select("*").single();
    if (sessionInsert.error && (
      isMissingColumnError(sessionInsert.error, "event_tour")
      || isMissingColumnError(sessionInsert.error, "event_season")
      || isMissingColumnError(sessionInsert.error, "counts_for_season")
    )) {
      const fallbackPayload: Record<string, unknown> = { ...sessionPayload };
      delete fallbackPayload.event_tour;
      delete fallbackPayload.event_season;
      delete fallbackPayload.counts_for_season;
      sessionInsert = await supabase.from("draft_sessions").insert([fallbackPayload]).select("*").single();
    }
    if (sessionInsert.error || !sessionInsert.data) {
      console.error(sessionInsert.error);
      setBusy("");
      return setStatusMessage(`Could not create the tournament session${sessionInsert.error?.message ? `: ${sessionInsert.error.message}` : "."}`);
    }
    const membershipResult = await supabase.from("league_memberships").select("user_id, claimed_team_name").eq("league_id", currentLeagueId).not("claimed_team_name", "is", null);
    const ownerByTeam = new Map(
      (((membershipResult.data ?? []) as Pick<LeagueMembership, "user_id" | "claimed_team_name">[])
        .filter((entry): entry is Pick<LeagueMembership, "user_id" | "claimed_team_name"> & { claimed_team_name: string } => !!entry.claimed_team_name)
        .map((entry) => [normalizeName(entry.claimed_team_name), entry.user_id]))
    );
    const teamsInsert = await supabase.from("draft_teams").insert(newDraftTeams.map((team) => ({
      session_id: sessionInsert.data.id,
      name: team.name,
      draft_slot: team.selected ? selectedDraftTeams.findIndex((entry) => entry.name === team.name) + 1 : null,
      active: team.selected,
      owner_user_id: ownerByTeam.get(normalizeName(team.name)) ?? null,
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

  async function assignNextPick(team: DraftTeam) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can change the draft order.");
    const nextSlot = nextAvailableDraftSlot(teams);
    await updateTeam(team.id, { draft_slot: nextSlot, active: true }, `${team.name} is now pick ${nextSlot}.`);
    await loadSession(selectedSessionId, false);
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
    await loadSession(selectedSessionId, false);
  }

  async function removeFromOrder(team: DraftTeam) {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can remove teams from the draft order.");
    if (team.draft_slot === null) return;
    const removedSlot = team.draft_slot;
    await updateTeam(team.id, { draft_slot: null, active: false }, `${team.name} was removed from the draft order.`);
    for (const entry of teams.filter((item) => item.id !== team.id && item.draft_slot !== null && item.draft_slot > removedSlot)) {
      await updateTeam(entry.id, { draft_slot: (entry.draft_slot ?? 1) - 1 });
    }
    await loadSession(selectedSessionId, false);
  }

  async function moveTeam(team: DraftTeam, direction: "up" | "down") {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can reorder teams.");
    if (team.draft_slot === null) return;
    const target = direction === "up" ? team.draft_slot - 1 : team.draft_slot + 1;
    const swapTeam = assignedTeams.find((entry) => entry.draft_slot === target);
    if (!swapTeam) return;
    await updateTeam(team.id, { draft_slot: target });
    await updateTeam(swapTeam.id, { draft_slot: team.draft_slot });
    setStatusMessage(`Moved ${team.name} to pick ${target}.`);
    await loadSession(selectedSessionId, false);
  }

  async function clearDraftOrder() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can clear the draft order.");
    for (const team of assignedTeams) await updateTeam(team.id, { draft_slot: null, active: false });
    setStatusMessage("Cleared the draft order.");
    await loadSession(selectedSessionId, false);
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

  async function importFieldFromEspn() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can import the field.");
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before importing the field.");
    if (picks.length) return setStatusMessage("The field and odds are locked after the first pick. Reopen this only by undoing picks first.");
    setBusy("Importing field...");
    try {
        const field = await fetchEspnFieldInput(currentSession.event_id, currentSession.event_tour, currentSession.event_season ?? CURRENT_GOLF_SEASON);
        await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Imported ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} from ESPN after cleaning duplicates, team rows, and invalid rows.`);
      } catch (error) {
        console.error(error);
        const tourLabel = TOUR_OPTIONS.find((tour) => tour.id === currentSession.event_tour)?.label ?? "the selected tour";
        setStatusMessage(error instanceof Error && error.message ? `${tourLabel}: ${error.message}` : `Could not import the player field from ${tourLabel}.`);
      }
      setBusy("");
    }

  async function autoImportMissingPlayerPool() {
    if (!canManageLeague || !currentSession?.id || !currentSession.event_id) return;
    if (picks.length) return;
    if (currentSession.player_input?.trim()) return;
    if (autoFieldImportAttempts[currentSession.id]) return;

    setAutoFieldImportAttempts((current) => ({ ...current, [currentSession.id]: true }));
    setBusy("Importing ESPN field...");
    try {
      const field = await fetchEspnFieldInput(currentSession.event_id, currentSession.event_tour, currentSession.event_season ?? CURRENT_GOLF_SEASON);
      await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Auto-imported ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} from ESPN.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error && error.message ? `Auto import failed: ${error.message}` : "Auto import failed. Use Setup to import the field manually.");
    }
    setBusy("");
  }

  async function autoClaimMatchingDraftTeam() {
    if (!user || !currentSession?.id || !activeTeamName?.trim()) return;
    const attemptKey = `${currentSession.id}:${user.id}`;
    if (autoTeamClaimAttempts[attemptKey]) return;

    const normalizedClaim = normalizeName(activeTeamName);
    const matchingTeam = teams.find((team) => team.active && normalizeName(team.name) === normalizedClaim);
    if (!matchingTeam || matchingTeam.owner_user_id === user.id || matchingTeam.owner_user_id) return;

    setAutoTeamClaimAttempts((current) => ({ ...current, [attemptKey]: true }));

    const { data, error } = await supabase.rpc("claim_draft_team_for_member", {
      target_session_id: currentSession.id,
    });

    if (error) {
      console.error(error);
      return;
    }

    if ((data ?? 0) > 0) {
      setStatusMessage(`Linked your account to ${matchingTeam.name}.`);
      await loadSession(currentSession.id, false);
    }
  }

  async function autoRefreshFieldBeforeDraft() {
    if (!canManageLeague || activeRoomTab !== "draft" || !currentSession?.id || !currentSession.event_id) return;
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
      const field = await fetchEspnFieldInput(currentSession.event_id, currentSession.event_tour, currentSession.event_season ?? CURRENT_GOLF_SEASON);
      await saveFieldSnapshot(currentSession.id, field, currentSession.event_name, `Refreshed ${field.playerCount} golfers${field.oddsCount ? " with betting odds" : ""} before the draft started.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error && error.message ? `Refresh failed: ${error.message}` : "Refresh failed. Use Setup to refresh the field manually.");
    }
    setBusy("");
  }

  async function pullLeaderboard() {
    if (!currentSession?.event_id) return setStatusMessage("Pick a PGA event before pulling leaderboard results.");
    if (currentSession.status === "finalized") return setStatusMessage("This tournament is finalized. Reopen results before refreshing the leaderboard.");
    setBusy("Pulling leaderboard...");
    try {
      const tourQuery = currentSession.event_tour ? `&tour=${encodeURIComponent(currentSession.event_tour)}` : "";
      const response = await fetch(`/api/espn-golf?action=leaderboard&eventId=${encodeURIComponent(currentSession.event_id)}${tourQuery}&season=${currentSession.event_season ?? CURRENT_GOLF_SEASON}`);
      const payload: EspnLeaderboardResponse = await response.json();
      if (!payload.ok || !payload.leaderboard) throw new Error(payload.error);
      const { error } = await supabase.rpc("refresh_session_leaderboard", {
        target_session_id: currentSession.id,
        leaderboard: payload.leaderboard,
        totals: payload.totals ?? {},
        next_status: payload.finalized ? "finalized" : "scored",
      });
      if (error) throw error;
      setStatusMessage(payload.finalized ? `Saved final leaderboard results from ESPN for ${payload.eventName ?? currentSession.name}.` : `Updated leaderboard results from ESPN for ${payload.eventName ?? currentSession.name}.`);
      await loadSessions();
      await loadSession(currentSession.id, false);
    } catch (error) {
      console.error(error);
      setStatusMessage("Could not update leaderboard results from ESPN.");
    }
    setBusy("");
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

  async function applyManualScores() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can apply manual scores.");
    if (!currentSession) return;
    if (currentSession.status === "finalized") return setStatusMessage("This tournament is finalized. Reopen results before applying score changes.");
    setBusy("Applying manual scores...");
    const parsed = parseManualLeaderboard(manualLeaderboardDraft);
    if (!Object.keys(parsed).length) {
      setBusy("");
      setStatusMessage("Paste at least one leaderboard line before applying manual scores.");
      return;
    }
    await updateSession({ manual_leaderboard_input: manualLeaderboardWithSeasonSetting(manualLeaderboardDraft, sessionCountsForSeason(currentSession)), current_positions: { ...(currentSession.current_positions ?? {}), ...parsed }, status: "scored" }, `Applied ${Object.keys(parsed).length} manual leaderboard entries.`);
    setBusy("");
  }

  async function finalizeResults() {
    if (!canManageLeague) return setStatusMessage("Only the commissioner can finalize tournament results.");
    if (!currentSession) return;
    if (!Object.keys(currentSession.current_positions ?? {}).length) return setStatusMessage("Refresh the leaderboard or apply scores before finalizing this tournament.");
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
      await loadSession(currentSession.id, false);
      return setStatusMessage("Could not save that pick. Refresh if someone else drafted at the same time.");
    }
    const isLastPick = picks.length + 1 >= totalPicks;
    setStatusMessage(`${currentTeamOnClock.name} drafted ${playerName}.`);
    await loadSessions();
    await loadSession(currentSession.id, false);
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
                {pendingLeagueSlug ? "You have a league invite. Sign in or create an account and we will add you to that league." : "Create an account to draft for your team, follow live results, and review past tournaments."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_in" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_in")}>Sign In</button>
              <button className={`rounded-full px-4 py-2 ${authMode === "sign_up" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setAuthMode("sign_up")}>Create Account</button>
            </div>

            <div className="grid gap-3">
              {authMode === "sign_up" ? (
                <>
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} placeholder="Username" />
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={authTeamName} onChange={(event) => setAuthTeamName(event.target.value)} placeholder="Team name in your league (optional)" />
                </>
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
                <button className={`rounded-full px-3 py-1 text-xs ${activeRoomTab === "profile" ? "bg-[#1a5c3a] text-white" : "bg-[#f7f2e9] text-[#6a5940]"}`} onClick={() => setActiveRoomTab("profile")}>Profile</button>
                {canManageLeague ? <button className={`rounded-full px-3 py-1 text-xs ${activeRoomTab === "admin" ? "bg-[#1a5c3a] text-white" : "bg-[#f2eadf] text-[#6a5940]"}`} onClick={() => setActiveRoomTab("admin")}>Admin</button> : (showTeamPill ? <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-[#6a5940]">{activeTeamName}</span> : null)}
              </div>
              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-sm text-[#1a5c3a]" onClick={signOut}>Sign Out</button>
            </div>
        </div>

        {newDraftModalOpen ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 py-6">
            <div className="grid max-h-[92vh] w-full max-w-[980px] gap-5 overflow-auto rounded-3xl bg-[#fbf7ef] p-5 text-[#1f2a1d] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
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
                        <div className="rounded-xl bg-white/70 px-3 py-2 text-xs text-[#617061]">Creating the room will import the ESPN field and available betting odds before the first pick.</div>
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
                  <div className="grid max-h-[520px] gap-2 overflow-auto rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-2">
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
                          className={`grid select-none gap-3 rounded-2xl border px-3 py-2.5 transition sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-center ${team.selected ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${
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
                          <div className="min-w-0 font-semibold">{team.name}</div>
                        </div>
                      );
                    })}
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

      <div className="mx-auto grid max-w-[1880px] gap-5 lg:grid-cols-[300px_1fr]">
        <section className="rrg-card rounded-3xl p-5 lg:sticky lg:top-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="m-0 font-[Georgia] text-2xl">{canManageLeague ? "New Draft" : "League Hub"}</h2>
            <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{sessions.length} saved</span>
          </div>
            {canManageLeague ? (
              <div className="grid min-w-0 gap-3">
                <button className="w-full rounded-full bg-[#1a5c3a] px-4 py-3 font-semibold text-white" onClick={() => setNewDraftModalOpen(true)}>New Draft</button>
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
                {!sortedSessions.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No saved tournament sessions yet.</div> : sortedSessions.map((session) => (
                <div key={session.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-3 ${selectedSessionId === session.id ? "border-[#1a5c3a]/50 bg-[#e0eee4]" : "border-black/10 bg-white/80"}`}>
                  <button className="min-w-0 text-left" onClick={() => setSelectedSessionId(session.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <strong className="truncate">{session.name}</strong>
                        <span className="text-sm text-[#617061]">{statusLabel(session.status)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#617061]">
                        <span>{formatTournamentDate(sessionEventDates[session.id], session.event_season)}</span>
                        <span>{sessionCountsForSeason(session) ? "Season event" : "Side event"}</span>
                      </div>
                    </button>
                  {canManageLeague ? <button className="shrink-0 rounded-full border border-[#9d4b2f]/20 bg-white px-2.5 py-1 text-xs text-[#9d4b2f]" onClick={() => deleteSession(session)}>Delete</button> : null}
                </div>
              ))}
            </div>
        </section>

        <section className="rrg-card rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="m-0 font-[Georgia] text-2xl">{currentSession ? currentSession.name : "Pick a session"}</h2>
              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{currentSession ? statusLabel(currentSession.status) : "No session selected"}</span>
            </div>

            {!currentSession ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">{canManageLeague ? "Create a tournament session on the left, then click it to open the shared draft room." : "Pick a saved tournament on the left to watch the draft, follow the leaderboard, and review past results."}</div> : (
              <div className="grid gap-5">
                <div className="flex flex-wrap gap-3">
                  {canManageLeague ? <button className={`rounded-full px-4 py-2 ${activeRoomTab === "setup" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("setup")}>Setup</button> : null}
                  <button className={`rounded-full px-4 py-2 ${activeRoomTab === "draft" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("draft")}>Draft</button>
                  <button className={`rounded-full px-4 py-2 ${activeRoomTab === "results" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("results")}>Results</button>
                  <button className={`rounded-full px-4 py-2 ${activeRoomTab === "season" ? "bg-[#1a5c3a] text-white" : "border border-[#1a5c3a]/20 bg-white text-[#1a5c3a]"}`} onClick={() => setActiveRoomTab("season")}>Season</button>
                </div>

                {canManageLeague && activeRoomTab === "setup" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                    <h3 className="mb-4 mt-0 font-[Georgia] text-xl">Tournament Setup</h3>
                    <div className="grid gap-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <h3 className="m-0 font-[Georgia] text-xl">Teams And Draft Order</h3>
                          <div className="flex items-center gap-2">
                            {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Order</button> : null}
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{assignedTeams.length} active</span>
                            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={clearDraftOrder}>Clear Order</button>
                          </div>
                        </div>
                        <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(360px,1.1fr)]">
                            <div className="grid content-start self-start gap-3 rounded-3xl border border-black/10 bg-white/75 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <h4 className="m-0 font-[Georgia] text-lg">Available Teams</h4>
                                  <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{unassignedTeams.length} left</span>
                                </div>
                            <div className={`grid content-start gap-2 rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-2 pr-2 ${unassignedTeams.length > 5 ? "max-h-[420px] overflow-auto" : ""}`}>
                              {!unassignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-[#617061]">Every team has been assigned to the draft order.</div> : unassignedTeams.map((team) => (
                                <div key={team.id} className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-black/10 bg-white/90 px-3 py-2.5">
                                  <span className="truncate font-medium">{team.name}</span>
                                  <button className="w-[74px] rounded-full bg-[#1a5c3a] px-3 py-1.5 text-sm text-white" onClick={() => assignNextPick(team)}>Assign</button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="grid min-h-[430px] gap-3 rounded-3xl border border-black/10 bg-white/75 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="m-0 font-[Georgia] text-lg">Draft Order</h4>
                              <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{assignedTeams.length} assigned</span>
                            </div>
                            <div className="grid content-start gap-2">
                              {!assignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] p-4 text-sm text-[#617061]">Assign teams from the left to build the draft order.</div> : assignedTeams.map((team) => (
                                <div key={team.id} className="grid min-h-[78px] gap-2 rounded-2xl border border-black/10 bg-white/90 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <strong className="truncate">#{team.draft_slot} {team.name}</strong>
                                    <span className="text-xs text-[#617061]">Pick {team.draft_slot}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" disabled={team.draft_slot === 1} onClick={() => moveTeam(team, "up")}>Up</button>
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" disabled={team.draft_slot === assignedTeams.length} onClick={() => moveTeam(team, "down")}>Down</button>
                                    <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-3 py-1.5 text-sm text-[#1a5c3a]" onClick={() => removeFromOrder(team)}>Remove</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="my-1 h-px bg-black/10" />
                        <label className="grid gap-1 text-sm text-[#617061]">
                          <span className="font-medium text-[#1f2a1d]">Tournament Season</span>
                          <select
                            className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3"
                            value={currentSession.event_season ?? CURRENT_GOLF_SEASON}
                            onChange={(event) => {
                              const season = Number(event.target.value);
                              setNewDraftSeason(season);
                              void updateSession(
                                { event_season: season, event_id: null, event_name: null },
                                `Season changed to ${season}. Select the tournament and refresh the field.`
                              );
                            }}
                          >
                            {HISTORICAL_SEASONS.map((season) => <option key={season} value={season}>{season}</option>)}
                          </select>
                        </label>
                        <select className="w-full min-w-0 max-w-full rounded-xl border border-black/15 bg-white px-3 py-3" value={currentSession.event_id ?? ""} onChange={(event) => updateSession({ event_id: event.target.value || null, event_name: events.find((item) => item.id === event.target.value)?.name ?? null, event_tour: newDraftTour, event_season: events.find((item) => item.id === event.target.value)?.season ?? newDraftSeason }, `Linked this session to ${events.find((item) => item.id === event.target.value)?.name ?? "the selected event"}.`)}>
                          <option value="">No event selected</option>
                          {events.map((event) => <option key={event.id} value={event.id}>{formatEventDropdownOption(event)}</option>)}
                        </select>
                        {selectedCurrentSessionEvent ? (
                          <div className="grid min-w-0 gap-2 overflow-hidden rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                            <div className="min-w-0 truncate text-base font-semibold text-[#1f2a1d]">{selectedCurrentSessionEvent.name}</div>
                            <div className="min-w-0">
                              <div className="truncate">{selectedCurrentSessionEvent.course ?? "Course TBD"}</div>
                              {selectedCurrentSessionEvent.location ? <div className="truncate">{selectedCurrentSessionEvent.location}</div> : null}
                            </div>
                            <div className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1a5c3a]">{selectedCurrentSessionEvent.dateLabel ?? "Date TBD"}</div>
                          </div>
                        ) : null}
                        <label className="flex items-start gap-3 rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm">
                          <input className="mt-1" type="checkbox" checked={sessionCountsForSeason(currentSession)} onChange={(event) => setSessionCountsForSeason(currentSession, event.target.checked)} />
                          <span>
                            <span className="block font-semibold text-[#1f2a1d]">Count this tournament toward season stats</span>
                            <span className="block text-[#617061]">Side events keep their leaderboard but do not add points, wins, or top-three finishes to the season table.</span>
                          </span>
                        </label>
                      <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="m-0 font-[Georgia] text-xl">Player Pool And Odds</h3>
                            <div className="mt-1 text-sm text-[#617061]">
                              The ESPN field imports automatically. Use this only to re-import or repair the field if something looks wrong.
                            </div>
                          </div>
                          <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{allPlayers.length} draftable</span>
                        </div>
                        <div className="grid gap-2 rounded-2xl bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061] md:grid-cols-2">
                          <div><span className="font-semibold text-[#1f2a1d]">Field refreshed:</span> {formatRefreshTime(currentSession.field_refreshed_at)}</div>
                          <div><span className="font-semibold text-[#1f2a1d]">Odds refreshed:</span> {formatRefreshTime(currentSession.odds_refreshed_at)}</div>
                          {currentSession.odds_source ? <div className="min-w-0 md:col-span-2"><span className="font-semibold text-[#1f2a1d]">Odds source:</span> <a className="break-words text-[#1a5c3a] underline" href={currentSession.odds_source} target="_blank" rel="noreferrer">{currentSession.odds_source}</a></div> : null}
                          <div className="md:col-span-2"><span className="font-semibold text-[#1f2a1d]">Field status:</span> {picks.length || currentSession.field_locked_at ? `Locked${currentSession.field_locked_at ? ` ${formatRefreshTime(currentSession.field_locked_at)}` : " after drafting started"}` : "Refreshable until the first pick"}</div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-3 text-[#1a5c3a] disabled:opacity-50" disabled={!!picks.length} onClick={importFieldFromEspn}>Refresh Field & Odds</button>
                          <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white disabled:opacity-50" disabled={!!picks.length} onClick={savePlayerPool}>Save Manual Edits</button>
                        </div>
                        <textarea className="min-h-72 rounded-xl border border-black/15 bg-white px-3 py-3 font-mono text-sm disabled:bg-[#f4efe6] disabled:text-[#617061]" disabled={!!picks.length} value={playerPoolDraft} onChange={(event) => setPlayerPoolDraft(event.target.value)} placeholder={"Examples:\nScottie Scheffler +450\nRory McIlroy / Shane Lowry +1200\nHossler/Ryder +8000"} />
                        <div className="text-sm text-[#617061]">
                          {picks.length ? "The field is locked because drafting has started. Undo picks before changing the player pool." : "For team events, keep both players on the same line with a slash so they draft together."}
                        </div>
                      </div>
                        <div className="my-1 h-px bg-black/10" />
                      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(420px,1.15fr)]">
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-xl">Scoring</h3>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#6a5940]">Best 3 of 4 count</span>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-3 text-[#1a5c3a]" onClick={pullLeaderboard}>Pull ESPN Leaderboard</button>
                            <button className="rounded-full bg-[#1a5c3a] px-4 py-3 text-white" onClick={applyManualScores}>Apply Manual Scores</button>
                          </div>
                          <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-3 py-2 text-sm text-[#617061]">
                            {busy || statusMessage}
                          </div>
                          <div className="text-sm text-[#617061]">Use this area to load or correct tournament positions before everyone watches the live standings.</div>
                        </div>
                        <div className="grid gap-3 rounded-2xl border border-black/10 bg-white/75 p-4">
                          <textarea className="min-h-52 rounded-xl border border-black/15 bg-white px-3 py-3 font-mono" value={manualLeaderboardDraft} onChange={(event) => setManualLeaderboardDraft(event.target.value)} placeholder={"Example:\n1 Scottie Scheffler\nT2 Rory McIlroy\nCUT Jordan Spieth"} />
                          <div className="text-sm text-[#617061]">Enter one player per line. Examples: `1 Scottie Scheffler`, `T2 Rory McIlroy`, `CUT Jordan Spieth`.</div>
                        </div>
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
                            <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-[#617061]" readOnly value={currentLeagueInviteUrl} placeholder="Invite link appears after selecting a league" />
                            <div className="flex flex-wrap gap-2">
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={copyLeagueInviteLink}>Copy Link</button>
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={openLeagueInviteEmail}>Email</button>
                              <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={openLeagueInviteSms}>SMS</button>
                            </div>
                          </div>
                          <div className="text-sm text-[#617061]">Send this link to anyone who should join the league. They can create a new account or sign in with an existing one, and the app will add this league to their account.</div>
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
                                {availableSiteProfiles.map((entry) => <option key={entry.id} value={entry.id}>{formatProfileLabel(entry.username, entry.team_name)}</option>)}
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
                                        <span className="text-[#617061]">{entry.team_name ? `Claimed team: ${entry.team_name}` : "No team claimed yet"}</span>
                                      </div>
                                      {canManagePermissions && entry.role !== "commissioner" ? <div className="grid gap-2 justify-items-end"><select className="rounded-xl border border-black/15 bg-white px-2 py-1 text-xs" value={entry.role} onChange={(event) => updateMemberRole(entry, event.target.value as "assistant_commissioner" | "member")}><option value="member">Member</option><option value="assistant_commissioner">Assistant Commissioner</option></select><button className="rounded-full border border-[#9d4b2f]/20 bg-white px-3 py-1 text-xs text-[#9d4b2f]" onClick={() => removeMember(entry)}>Remove</button></div> : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 rounded-2xl border border-black/10 bg-white/75 p-3">
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
                                {profiles.map((entry) => <option key={entry.id} value={entry.id}>{formatProfileLabel(entry.username, entry.team_name)}</option>)}
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
                        <label className="grid gap-1 text-sm text-[#617061]">
                          <span className="font-medium text-[#1f2a1d]">Claimed Team Name</span>
                          <input className="rounded-xl border border-black/15 bg-white px-3 py-3 text-[#1f2a1d]" value={profileDraftTeam} onChange={(event) => setProfileDraftTeam(event.target.value)} placeholder="Claimed team name (optional)" />
                          <span>Optional. This helps the commissioner connect your account to the correct team.</span>
                        </label>
                        <button className="justify-self-start rounded-full bg-[#1a5c3a] px-4 py-2 text-white" onClick={saveProfile}>Save Profile</button>
                        <div className="rounded-2xl border border-black/10 bg-[#f7f2e9] px-4 py-3 text-sm text-[#617061]">
                          {busy || statusMessage}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeRoomTab === "draft" ? (
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                    <h3 className="mb-4 mt-0 font-[Georgia] text-xl">Live Draft</h3>
                    <div className="grid gap-4">
                        <div className="grid gap-3 rounded-2xl bg-[#d9eadf] p-4 text-[#1a5c3a]">
                          <div className="font-semibold">
                            {editingPick
                              ? `Replacing ${editingPick.playerName} on ${editingPick.teamName}. Pick a replacement from the available golfer list.`
                              : !validDraftOrder
                                ? "The draft order needs to be repaired before you can make picks."
                                : draftComplete
                                  ? "The draft is complete. You can still score the results below."
                                    : `${currentTeamOnClock?.name ?? "Nobody"} is on the clock for pick ${picks.length + 1}.${canDraftCurrentPick ? " You're live for this pick." : currentUsersTeams.length ? ` Your team${currentUsersTeams.length > 1 ? "s are" : " is"} ${ownedTeamNames.join(", ")}.` : " Watch live until your team is up."}`}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs font-medium text-[#28523e]">
                            <span className="rounded-full bg-white/70 px-3 py-1">Event: {currentSession.event_name || "Not linked"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Round: {draftComplete ? "Complete" : String(currentRound || 0)}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Pick: {totalPicks ? `${Math.min(picks.length + 1, totalPicks)} / ${totalPicks}` : "0 / 0"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Clock: {draftComplete ? "Draft complete" : currentTeamOnClock?.name || "Set draft order"}</span>
                            <span className="rounded-full bg-white/70 px-3 py-1">Status: {statusLabel(currentSession.status)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {!validDraftOrder && assignedTeams.length ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={normalizeDraftOrder}>Repair Draft Order</button> : null}
                        {!draftComplete && validDraftOrder && canManageLeague ? <button className="rounded-full bg-[#f6d77a] px-4 py-2 font-semibold text-[#1f2a1d]" onClick={autoDraftRandomly}>Random Draft Remaining</button> : null}
                        {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-4 py-2 text-[#1a5c3a]" onClick={undoLastPick}>Undo Last Pick</button> : null}
                          {editingPick && canManageLeague ? <button className="rounded-full border border-[#9d4b2f]/20 bg-white px-4 py-2 text-[#9d4b2f]" onClick={() => setEditingPick(null)}>Cancel Swap</button> : null}
                      </div>
                        <div className="grid items-start gap-5 xl:grid-cols-[minmax(330px,0.75fr)_minmax(0,1.25fr)] 2xl:grid-cols-[minmax(360px,0.7fr)_minmax(0,1.3fr)]">
                          <div className="grid content-start self-start gap-3">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-xl">Available Golfers</h3>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{availablePlayers.length} match{availablePlayers.length === 1 ? "" : "es"}</span>
                          </div>
                            {oddsSource || Object.keys(playerPoolOdds).length ? <div className="text-xs text-[#617061]">Ordered by win odds, lowest odds first. Odds can come from CBS Sports or your imported list.</div> : null}
                          <input className="rounded-xl border border-black/15 bg-white px-3 py-3" value={playerFilter} onChange={(event) => { setPlayerFilter(event.target.value); setHighlightedPlayerIndex(0); }} onKeyDown={handlePlayerSearchKeyDown} placeholder="Search available golfers" />
                          <div className="grid max-h-[520px] content-start gap-2 overflow-y-auto overflow-x-hidden rounded-2xl border border-black/10 bg-[#f7f2e9]/70 p-2 pr-2">
                            {!availablePlayers.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">{allPlayers.length ? "No available golfers match your search." : "The player field is still importing or has not been refreshed yet. Commissioners can use Setup to refresh the field and odds."}</div> : availablePlayers.map((player) => {
                              const oddsLabel = playerOddsLabel(player);
                              return (
                                <div key={player} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-2 ${availablePlayers[highlightedPlayerIndex] === player ? "border-[#1a5c3a]/50 bg-[#e0eee4]" : "border-black/10 bg-white/90"}`} onMouseEnter={() => setHighlightedPlayerIndex(availablePlayers.indexOf(player))}>
                                    <div className="min-w-0">
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <div className="whitespace-normal break-words font-medium leading-tight">{player}</div>
                                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${oddsLabel ? "bg-[#f6d77a] text-[#1f2a1d]" : "bg-[#f2eadf] text-[#617061]"}`}>{oddsLabel ?? "No odds"}</span>
                                      </div>
                                    </div>
                                    <button className="rounded-full bg-[#1a5c3a] px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={editingPick ? !canManageLeague : (!validDraftOrder || draftComplete || !canDraftCurrentPick)} onClick={() => editingPick ? replacePick(player) : makePick(player)}>{editingPick ? "Replace" : "Draft"}</button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                          <div className="grid min-w-0 gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="m-0 font-[Georgia] text-xl">Draft Board</h3>
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">Snake order</span>
                          </div>
                          <div className="rounded-3xl border border-[#1a5c3a]/15 bg-[#e0eee4] p-4 text-[#1a5c3a]">
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#28523e]">{draftComplete ? "Draft Complete" : "On The Clock"}</div>
                            <div className="mt-1 font-[Georgia] text-3xl leading-tight">{draftComplete ? "All picks are in" : currentTeamOnClock?.name ?? "Set draft order"}</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                              <span className="rounded-full bg-white/70 px-3 py-1">Round {draftComplete ? ROUNDS : currentRound || 0}</span>
                              <span className="rounded-full bg-white/70 px-3 py-1">Pick {totalPicks ? `${Math.min(picks.length + 1, totalPicks)} / ${totalPicks}` : "0 / 0"}</span>
                              <span className="rounded-full bg-white/70 px-3 py-1">{currentRound % 2 === 0 ? "Snake moving right to left" : "Snake moving left to right"}</span>
                            </div>
                          </div>
                          <div className="grid gap-2 rounded-3xl border border-black/10 bg-white/80 p-3">
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
                                      <div key={entry.pickNumber} data-current-pick={entry.state === "current" ? "true" : undefined} data-pick-number={entry.pickNumber} style={{ flexBasis: draftFlowCardWidth ? `${draftFlowCardWidth}px` : "150px" }} className={`grid min-h-[112px] min-w-0 shrink-0 content-start gap-1 overflow-hidden rounded-2xl border p-2 text-xs sm:p-3 sm:text-sm ${
                                        entry.state === "current"
                                          ? "border-[#1a5c3a]/70 bg-[#1a5c3a] text-white shadow-[0_14px_30px_rgba(26,92,58,0.25)] ring-2 ring-[#b7d9bd]"
                                          : entry.state === "complete"
                                            ? "border-black/10 bg-[#f7f2e9] text-[#617061]"
                                            : "border-black/10 bg-white text-[#1f2a1d]"
                                      }`}>
                                        <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${entry.state === "current" ? "text-white/80" : "text-[#617061]"}`}>Pick {entry.pickNumber}</div>
                                        <div className="break-words font-semibold leading-tight">{entry.team?.name}</div>
                                        {entry.pick ? (
                                          <div className={`mt-1 grid gap-1 break-words rounded-xl px-2 py-1 text-xs leading-tight ${entry.state === "current" ? "bg-white/15" : "bg-white/75"}`}>
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
                            <div className="grid gap-3 overflow-x-hidden pr-0">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <h4 className="m-0 font-[Georgia] text-lg">Team Rosters</h4>
                                <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{picks.length} of {totalPicks} picks made</span>
                              </div>
                            {!assignedTeams.length ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Set the draft order before using the board.</div> : (
                              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                                {teamDraftRosters.map(({ team, picks: teamPicks, isMine }) => (
                                  <div key={team.id} className={`grid min-h-[190px] content-start gap-3 rounded-2xl border p-4 ${isMine ? "border-[#1a5c3a]/60 bg-[#e0eee4] shadow-[0_12px_26px_rgba(26,92,58,0.16)]" : "border-black/10 bg-white/85"}`}>
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-[0.14em] text-[#617061]">{team.draft_slot ? `Draft slot ${team.draft_slot}` : "No slot"}</div>
                                        <strong className="block break-words text-lg leading-tight">{team.name}</strong>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                        {isMine ? <span className="rounded-full bg-[#1a5c3a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">My Team</span> : null}
                                        {!draftComplete && currentTeamOnClock?.id === team.id ? <span className="rounded-full bg-[#f6d77a] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1f2a1d]">On Clock</span> : null}
                                      </div>
                                    </div>
                                    <div className="grid gap-2">
                                      {Array.from({ length: ROUNDS }, (_, index) => {
                                        const roundNumber = index + 1;
                                        const pick = teamPicks.find((entry) => entry.round_number === roundNumber) ?? null;
                                        return (
                                          <div key={`${team.id}-round-${roundNumber}`} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-3 py-2 text-sm ${pick ? "bg-white/90" : "bg-[#f7f2e9] text-[#617061]"}`}>
                                            <span className="rounded-full bg-[#f2eadf] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6a5940]">R{roundNumber}</span>
                                            <span className="min-w-0 break-words font-medium leading-tight">{pick?.player_name ?? "Waiting"}</span>
                                            {pick ? (
                                              <span className="flex shrink-0 items-center gap-2">
                                                {playerOddsLabel(pick.player_name) ? <span className="text-[11px] font-semibold text-[#617061]">{playerOddsLabel(pick.player_name)}</span> : null}
                                                {canManageLeague ? <button className="rounded-full border border-[#1a5c3a]/20 bg-white px-2 py-1 text-xs text-[#1a5c3a]" onClick={() => beginSwap(pick, team.name)}>Swap</button> : null}
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

                {activeRoomTab === "results" ? (
                <div className="grid gap-5">
                  <div className="rounded-[2rem] border border-black/10 bg-[radial-gradient(circle_at_top_left,#1f5d40_0%,#173c31_35%,#efe5d4_35.5%,#f7f2e9_100%)] p-4 text-white shadow-[0_18px_45px_rgba(74,57,28,0.15)]">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="grid gap-2">
                                <h3 className="m-0 font-[Georgia] text-3xl leading-tight">{currentSession.event_name || currentSession.name}</h3>
                                {currentSessionDisplayEvent?.course || currentSessionDisplayEvent?.location ? (
                                  <div className="text-sm font-medium text-white/88">
                                    {currentSessionDisplayEvent.course ? (
                                      <a className="underline decoration-white/35 underline-offset-4 hover:text-[#f6d77a]" href={courseWebsiteUrl(currentSessionDisplayEvent)} target="_blank" rel="noreferrer">
                                        {currentSessionDisplayEvent.course}
                                      </a>
                                    ) : null}
                                    {currentSessionDisplayEvent.course && currentSessionDisplayEvent.location ? <span> - </span> : null}
                                    {currentSessionDisplayEvent.location ? <span>{currentSessionDisplayEvent.location}</span> : null}
                                  </div>
                                ) : null}
                                <div className="flex flex-wrap gap-2 text-xs font-medium text-white/85">
                                  <span className="rounded-full bg-white/12 px-3 py-1">{leaderboard.length} teams</span>
                                  {currentSessionDisplayEvent?.dateLabel ? <span className="rounded-full bg-white/12 px-3 py-1">{currentSessionDisplayEvent.dateLabel}</span> : null}
                                </div>
                              </div>
                                  <div className="grid w-full max-w-[260px] gap-2 justify-items-start">
                                    {canManageLeague ? (
                                      resultsFinalized ? (
                                        <button className="rounded-full border border-[#f6d77a]/60 bg-white/90 px-4 py-2 text-sm font-semibold text-[#1f2a1d] shadow-[0_10px_20px_rgba(15,25,18,0.18)]" onClick={reopenFinalizedResults}>
                                          Reopen Results
                                        </button>
                                      ) : (
                                        <>
                                          <button className="rounded-full bg-[#f6d77a] px-4 py-2 text-sm font-semibold text-[#1f2a1d] shadow-[0_10px_20px_rgba(15,25,18,0.18)]" onClick={pullLeaderboard}>
                                            {busy === "Pulling leaderboard..." ? "Refreshing..." : "Refresh Leaderboard"}
                                          </button>
                                          <button className="rounded-full border border-white/30 bg-[#173c31] px-4 py-2 text-sm font-semibold text-white" onClick={finalizeResults}>
                                            Finalize Results
                                          </button>
                                        </>
                                      )
                                    ) : (
                                      <button className="rounded-full bg-[#f6d77a] px-4 py-2 text-sm font-semibold text-[#1f2a1d] shadow-[0_10px_20px_rgba(15,25,18,0.18)]" onClick={pullLeaderboard}>
                                        {busy === "Pulling leaderboard..." ? "Refreshing..." : "Refresh Leaderboard"}
                                      </button>
                                    )}
                                <div className="w-full rounded-xl bg-[#f7f2e9] px-3 py-2 text-xs text-[#4c5b4d]">
                                  Last updated: {resultsUpdatedLabel}{resultsFinalized ? " - Finalized" : ""}
                                </div>
                                <div className="w-full rounded-xl bg-[#f7f2e9] px-3 py-2 text-xs text-[#4c5b4d]">
                                  {busy === "Pulling leaderboard..." ? "Fetching latest ESPN positions..." : statusMessage}
                                </div>
                              </div>
                          </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                          {!leaderboard.length ? <div className="rounded-3xl border border-white/15 bg-white/10 p-4 text-white/80">No active teams are ready to score yet.</div> : leaderboard.map((entry, index) => (
                          <div key={entry.team.id} className={`grid gap-2 rounded-[1.6rem] p-3 text-[#1f2a1d] shadow-[0_14px_30px_rgba(15,25,18,0.14)] ${index === 0 ? "bg-[#f6d77a]" : index === 1 ? "bg-[#e7ecef]" : index === 2 ? "bg-[#e1b18a]" : "bg-white/92"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-[#617061]">#{index + 1}</div>
                                <strong className="text-lg">{entry.team.name}</strong>
                              </div>
                              <div className="rounded-full bg-[#1a5c3a] px-3 py-1 text-sm font-semibold text-white">{entry.total} pts</div>
                            </div>
                            <div className="grid gap-1.5 text-sm">
                              {!entry.playerScores.length ? <div className="text-[#617061]">No drafted golfers yet.</div> : entry.playerScores.map((player) => (
                                <div key={player.id} className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl px-3 py-2 ${entry.countingKeys.has(player.id) ? "bg-[#e0eee4]" : "bg-[#f4efe6]"}`}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <div className="truncate font-medium leading-tight">{player.player_name}</div>
                                      {player.total ? <span className={`shrink-0 text-sm font-semibold ${totalColorClass(player.total)}`}>{player.total}</span> : null}
                                    </div>
                                    <div className="text-[11px] text-[#617061]">
                                      {resultStatusLabel(player.position, player.total, player.thru, player.meta)}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-semibold">{player.points}</div>
                                    <div className="text-[10px] uppercase tracking-[0.15em] text-[#617061]">{entry.countingKeys.has(player.id) ? "Counts" : "Bench"}</div>
                                  </div>
                                  <div className="col-span-2 mt-1 grid grid-cols-9 gap-1">
                                    {Array.from({ length: 18 }, (_, holeIndex) => {
                                      const filled = holeIndex < holesCompletedForDisplay(player.thru, player.meta);
                                      return (
                                        <span
                                          key={`${player.id}-hole-${holeIndex + 1}`}
                                          className={`h-1.5 rounded-full ${filled ? "bg-[#1a5c3a]" : "bg-black/10"}`}
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
                  </div>
                  </div>
                ) : null}

                {activeRoomTab === "season" ? (
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="m-0 font-[Georgia] text-xl">Season Stats</h3>
                          <div className="mt-1 text-sm text-[#617061]">
                            {seasonStatsView === "league" ? "Official standings from selected league tournaments." : "Comparison standings including every completed tournament and side event."}
                          </div>
                        </div>
                        <div className="flex rounded-xl border border-[#1a5c3a]/20 bg-white p-1">
                          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${seasonStatsView === "league" ? "bg-[#1a5c3a] text-white" : "text-[#1a5c3a]"}`} onClick={() => setSeasonStatsView("league")}>League Season</button>
                          <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${seasonStatsView === "all" ? "bg-[#1a5c3a] text-white" : "text-[#1a5c3a]"}`} onClick={() => setSeasonStatsView("all")}>All Tournaments</button>
                        </div>
                      </div>
                      <div className="mb-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{completedSeasonSessions.length} completed events</span>
                        <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-xs text-[#617061]">{seasonStats.length} teams tracked</span>
                        {seasonStatsView === "league" ? <span className="rounded-full bg-[#d9eadf] px-3 py-1 text-xs text-[#1a5c3a]">{countedSeasonSessions.length} events selected</span> : null}
                      </div>
                      {seasonStatsLoading ? <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">Loading season stats...</div> : !seasonStats.length ? (
                        <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-[#617061]">No completed tournament data is ready for season stats yet.</div>
                      ) : (
                        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
                          <div className="min-w-0 overflow-hidden rounded-2xl border border-black/10 bg-white/85">
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
                          </div>
                          <div className="grid content-start gap-2">
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
                          </div>
                        </div>
                      )}
                    </div>
                    {canManageLeague ? (
                      <div className="rounded-3xl border border-black/10 bg-white/60 p-5">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="m-0 font-[Georgia] text-xl">Season Tournament Schedule</h3>
                            <div className="mt-1 text-sm text-[#617061]">Checked events count in the official League Season view. Side events remain included in All Tournaments.</div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            <span className="rounded-full bg-[#f2eadf] px-3 py-1 text-sm font-semibold text-[#617061]">
                              {countedSeasonSessions.length} of {sessions.length} selected
                            </span>
                            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${countedSeasonSessions.length === SEASON_EVENT_TARGET ? "bg-[#d9eadf] text-[#1a5c3a]" : "bg-[#f6d77a] text-[#6a4b16]"}`}>
                              Target: {SEASON_EVENT_TARGET}
                            </span>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          {sortedSessions.map((session) => (
                            <label key={session.id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-black/10 bg-white/80 px-4 py-3">
                              <input type="checkbox" checked={sessionCountsForSeason(session)} onChange={(event) => setSessionCountsForSeason(session, event.target.checked)} />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{session.event_name ?? session.name}</span>
                                <span className="block text-xs text-[#617061]">{formatTournamentDate(sessionEventDates[session.id], session.event_season)} | {statusLabel(session.status)}</span>
                              </span>
                              <span className="text-xs font-medium text-[#617061]">{sessionCountsForSeason(session) ? "Counts" : "Side event"}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
        </section>
      </div>
    </div>
  );
}

