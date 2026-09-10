export type ProviderCredentialDecision =
  | { kind: "misconfigured" }
  | { kind: "internal" }
  | { kind: "user"; token: string }
  | { kind: "unauthenticated" };

export function bearerToken(authorization: string | null) {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

export function decideProviderCredential(input: {
  configured: boolean;
  internalCredentialMatches: boolean;
  authorization: string | null;
}): ProviderCredentialDecision {
  if (!input.configured) return { kind: "misconfigured" };
  if (input.internalCredentialMatches) return { kind: "internal" };
  const token = bearerToken(input.authorization);
  return token ? { kind: "user", token } : { kind: "unauthenticated" };
}

export function quotaAllowsProviderCall(result: { allowed: unknown; error: unknown }) {
  return !result.error && result.allowed === true;
}

export function providerResponseHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization, x-rrg-internal-key",
  } as const;
}

export function canonicalProviderOrigin(value: string | undefined, production: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (production && url.protocol !== "https:") return null;
    if (!production && url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
