export type CompletedLeaderboardRow = {
  name: string;
  position: number | null;
  positionLabel: string;
  total: string | null;
  thru: string | null;
};

function eventNamesMatch(expected: string | null | undefined, actual: string | null | undefined) {
  const normalize = (value: string | null | undefined) => String(value ?? "")
    .toLowerCase()
    .replace(/\bpresented by\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const left = normalize(expected);
  const right = normalize(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

export type HistoricalRound = {
  course_par?: number | string | null;
  score?: number | string | null;
};

export function historicalPlayerNameKey(value: string | null | undefined) {
  const name = String(value ?? "").trim();
  const match = name.match(/^([^,]+),\s*(.+)$/);
  const formatted = match ? `${match[2]} ${match[1]}` : name;
  return formatted.replace(/\s+/g, " ").trim().toLowerCase();
}

export function roundTotalToPar(rounds: Array<HistoricalRound | null | undefined>) {
  const played = rounds.filter((round): round is HistoricalRound => Boolean(round));
  if (!played.length) return null;
  let total = 0;
  for (const round of played) {
    if (round.score === null || round.score === undefined || round.score === "" || round.course_par === null || round.course_par === undefined || round.course_par === "") return null;
    const score = Number(round.score);
    const par = Number(round.course_par);
    if (!Number.isFinite(score) || !Number.isFinite(par)) return null;
    total += score - par;
  }
  return total;
}

export function hasMeaningfulCompletedLeaderboard(rows: CompletedLeaderboardRow[]) {
  if (!rows.length) return false;
  if (!rows.every((row) => ["F", "CUT", "WD", "DQ"].includes(String(row.thru ?? "").trim().toUpperCase()))) return false;
  const scoringRows = rows.filter((row) => row.position !== null || String(row.thru ?? "").trim().toUpperCase() === "CUT");
  if (!scoringRows.length || scoringRows.some((row) => row.total === null || row.total === "")) return false;
  const outcomes = new Set(rows.map((row) => [row.position ?? "", String(row.total ?? "").trim().toUpperCase(), String(row.thru ?? "").trim().toUpperCase()].join("|")));
  return outcomes.size > 1;
}

export function historicalResultsCanFinalize(input: {
  requestedEventId: string;
  resultsEventId: string | number | null | undefined;
  roundsEventId: string | number | null | undefined;
  resultsEventName: string | null | undefined;
  roundsEventName: string | null | undefined;
  expectedEventName?: string | null;
  rows: CompletedLeaderboardRow[];
}) {
  const requested = String(input.requestedEventId).trim();
  if (!requested || String(input.resultsEventId ?? "").trim() !== requested) return false;
  if (String(input.roundsEventId ?? "").trim() !== requested) return false;
  if (!eventNamesMatch(input.resultsEventName, input.roundsEventName)) return false;
  if (input.expectedEventName && !eventNamesMatch(input.expectedEventName, input.resultsEventName)) return false;
  return hasMeaningfulCompletedLeaderboard(input.rows);
}
