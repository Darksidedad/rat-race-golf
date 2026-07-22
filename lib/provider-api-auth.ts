import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

type ProviderApiAccess =
  | { ok: true; userId: string | null; internal: boolean }
  | { ok: false; response: NextResponse };

function safeSecretEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function internalProviderHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key ? { "x-rrg-internal-key": key } : {};
}

export function forwardedProviderHeaders(request: NextRequest): Record<string, string> {
  const authorization = request.headers.get("authorization");
  const internalKey = request.headers.get("x-rrg-internal-key");
  return {
    ...(authorization ? { authorization } : {}),
    ...(internalKey ? { "x-rrg-internal-key": internalKey } : {}),
  };
}

export async function authorizeProviderApi(request: NextRequest, route: string, requestsPerMinute: number): Promise<ProviderApiAccess> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Provider API security is not configured." }, { status: 503 }) };
  }

  const internalKey = request.headers.get("x-rrg-internal-key") ?? "";
  if (internalKey && safeSecretEqual(internalKey, serviceRoleKey)) {
    return { ok: true, userId: null, internal: true };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 }) };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Invalid or expired session." }, { status: 401 }) };
  }

  const { data: allowed, error: limitError } = await supabase.rpc("consume_api_rate_limit", {
    target_user_id: user.id,
    target_route: route,
    request_limit: requestsPerMinute,
    window_seconds: 60,
  });
  if (limitError) {
    console.error("Provider API rate limit check failed", limitError);
    return { ok: false, response: NextResponse.json({ ok: false, error: "Provider API rate limiting is unavailable." }, { status: 503 }) };
  }
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Too many provider requests. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    };
  }

  return { ok: true, userId: user.id, internal: false };
}

export async function consumeProviderQuota(provider: string, requestLimit: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return false;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error } = await supabase.rpc("consume_provider_rate_limit", {
    target_provider: provider,
    request_limit: requestLimit,
    window_seconds: 60,
  });
  if (error) {
    console.error("Provider quota check failed", error);
    return false;
  }
  return Boolean(allowed);
}
