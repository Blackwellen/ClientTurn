import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting for sensitive endpoints.
 *
 * Backed by Postgres rather than process memory because serverless instances
 * are not shared — an in-memory counter would reset on every cold start and
 * would not be enforced across concurrent instances.
 *
 * Fails OPEN: if the limiter itself errors we allow the request rather than
 * locking every customer out of signing in because of an infrastructure blip.
 * The trade-off is deliberate; abuse is still bounded by the provider limits
 * behind these endpoints.
 */

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export const RATE_LIMITS = {
  "auth:signin": { limit: 10, windowSeconds: 300 },
  "auth:signup": { limit: 5, windowSeconds: 3600 },
  "auth:reset": { limit: 5, windowSeconds: 3600 },
  "admin:signin": { limit: 5, windowSeconds: 900 },
  "admin:stepup": { limit: 10, windowSeconds: 900 },
  "marketing:track": { limit: 120, windowSeconds: 60 },
  "marketing:enquiry": { limit: 5, windowSeconds: 3600 },
  "webhook:inbound": { limit: 600, windowSeconds: 60 },
  // Test sends hit a real carrier and cost real money, so they are bounded
  // per workspace rather than per IP.
  "followup:test": { limit: 5, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Best-effort client identity. `x-forwarded-for` is attacker-controllable in
 * general, but on Vercel the left-most entry is set by the platform edge, so it
 * is the most specific identifier available here.
 */
export function clientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[key];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_bucket: key,
      p_identifier: identifier.slice(0, 200),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error || !data || data.length === 0) {
      return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
    }

    const row = data[0];
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after,
    };
  } catch {
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}

/** Convenience for route handlers: returns a 429 Response, or null to proceed. */
export async function rateLimitResponse(
  key: RateLimitKey,
  headers: Headers,
): Promise<Response | null> {
  const result = await checkRateLimit(key, clientIdentifier(headers));
  if (result.allowed) return null;

  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again shortly." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, result.retryAfterSeconds)),
      },
    },
  );
}
