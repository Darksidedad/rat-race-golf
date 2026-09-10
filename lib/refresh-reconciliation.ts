export const CLIENT_REFRESH_DEDUP_MS = 2_000;

export function shouldRunClientRefresh(input: {
  isVisible: boolean;
  now: number;
  lastRefreshAt: number | undefined;
  minimumIntervalMs?: number;
}) {
  if (!input.isVisible) return false;
  const minimumIntervalMs = input.minimumIntervalMs ?? CLIENT_REFRESH_DEDUP_MS;
  return input.lastRefreshAt === undefined || input.now - input.lastRefreshAt >= minimumIntervalMs;
}

export function changedSessionId(payload: { new?: unknown; old?: unknown }) {
  const nextId = recordId(payload.new);
  return nextId ?? recordId(payload.old);
}

export function changedLeagueId(payload: { new?: unknown; old?: unknown }) {
  return recordString(payload.new, "league_id") ?? recordString(payload.old, "league_id");
}

export function shouldReconcileAfterSubscribe(status: string, hasPreviouslySubscribed: boolean) {
  return status === "SUBSCRIBED" && hasPreviouslySubscribed;
}

function recordId(value: unknown) {
  return recordString(value, "id");
}

function recordString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" && entry.length > 0 ? entry : null;
}
