export type TournamentLeaderboardRow = {
  name: string;
  position: number | null;
  positionLabel: string;
  total: string | null;
  thru: string | null;
};

export type LeaderboardLifecyclePayload = {
  finalized?: boolean;
  notStarted?: boolean;
};

export function storedThruFromTotal(value: string | null | undefined) {
  if (!value?.includes("||")) return null;
  const [, thru] = value.split("||");
  return thru?.trim() || null;
}

export function isLiveThru(thru: string | null | undefined) {
  const normalized = String(thru ?? "").trim().toUpperCase();
  return /^THRU\s+\d+$/.test(normalized) || normalized.startsWith("PLAYOFF");
}

export function rowsHavePlayersOnCourse(rows: TournamentLeaderboardRow[] | undefined) {
  return (rows ?? []).some((row) => isLiveThru(row.thru));
}

export function totalsHavePlayersOnCourse(totals: Record<string, string | null> | null | undefined) {
  return Object.values(totals ?? {}).some((value) => isLiveThru(storedThruFromTotal(value)));
}

export function totalsHavePendingTeeTimes(totals: Record<string, string | null> | null | undefined) {
  return Object.values(totals ?? {}).some((value) => String(storedThruFromTotal(value) ?? "").startsWith("Tee "));
}

export function normalizedEventName(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bpresented by\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function eventNamesMatch(expected: string | null | undefined, actual: string | null | undefined) {
  const left = normalizedEventName(expected);
  const right = normalizedEventName(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

export function recordsMatch<T>(left: Record<string, T> | null | undefined, right: Record<string, T> | null | undefined) {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function leaderboardSessionStatus(payload: LeaderboardLifecyclePayload) {
  return payload.finalized ? "finalized" : payload.notStarted ? "draft_complete" : "scored";
}
