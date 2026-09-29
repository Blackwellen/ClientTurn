import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting for sensitive endpoints.
 *
 * Backed by Postgres rather than process memory because serverless instances
 * are not shared — an in-memory counter would reset on every cold start and
 * would not be enforced across concurrent instances.
 *
 * Fails OPEN for most buckets: if the limiter itself errors we allow the
 * request, because abuse there is still bounded by the provider limits behind
 * the endpoint.
 *
 * Fails CLOSED for the credential buckets (`FAIL_CLOSED_BUCKETS`: sign-in,
 * sign-up, password reset, admin sign-in and step-up). A Supabase or RPC blip
 * must not quietly remove brute-force protection from a password form (gap
 * audit 15 §3). Refusing a sign-in for the length of an outage costs little:
 * the same outage would fail the sign-in itself.
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
  // Two-factor set-up and verification codes, per user. A six-digit code has
  // a million values; ten tries in five minutes makes guessing pointless.
  "auth:mfa": { limit: 10, windowSeconds: 300 },
  "marketing:track": { limit: 120, windowSeconds: 60 },
  "marketing:enquiry": { limit: 5, windowSeconds: 3600 },
  "webhook:inbound": { limit: 600, windowSeconds: 60 },
  // Test sends hit a real carrier and cost real money, so they are bounded
  // per workspace rather than per IP.
  "followup:test": { limit: 5, windowSeconds: 600 },
  // Platform-admin support actions. Bounded per operator so a stuck button
  // cannot spam a customer's inbox or a provider's API.
  "admin:onboarding_resend": { limit: 3, windowSeconds: 900 },
  "admin:health_check": { limit: 10, windowSeconds: 300 },
  "admin:event_retry": { limit: 30, windowSeconds: 300 },
  "admin:provider_refresh": { limit: 6, windowSeconds: 300 },
  "admin:search": { limit: 120, windowSeconds: 60 },
  // Affiliate programme. Applications are per IP. Clicks are counted at most
  // 20 per 10 minutes per network (keyed by a salted IP hash, never the raw
  // address); over that the visitor still reaches the page, uncounted and
  // uncookied (affiliate audit 17, fraud-rules.ts CLICK_RATE_LIMIT).
  "affiliate:apply": { limit: 5, windowSeconds: 3600 },
  "affiliate:click": { limit: 20, windowSeconds: 600 },
  // Each attempt creates or mutates a Stripe Connect account and mints a
  // single-use onboarding link, so this is bounded tightly.
  "affiliate:connect": { limit: 10, windowSeconds: 600 },
  // A test send makes our servers connect to an address the customer just
  // typed. Bounded per workspace so the button cannot be used to point us at
  // someone else's server repeatedly.
  "webhook:test": { limit: 10, windowSeconds: 600 },
  // The public API. Bounded per key rather than per IP: a customer running one
  // integration from a datacentre would otherwise share a bucket with everyone
  // else behind the same egress address.
  "api:key": { limit: 300, windowSeconds: 60 },
  // Presented credentials that did not resolve. Tight, and keyed by address:
  // this is the bucket that makes guessing a key impractical.
  "api:unauthenticated": { limit: 20, windowSeconds: 60 },
  // Promo codes carry a real discount. Generous enough for ordinary use,
  // tight enough that the endpoint cannot be used to enumerate offers.
  "affiliate:promo": { limit: 10, windowSeconds: 3600 },
  // A pasted-token connect (HubSpot today) makes an authenticated call to the
  // provider's API on every attempt. Keyed per workspace, not per IP, so it
  // bounds a bad-token retry loop without punishing shared office egress.
  "integration:connect_token": { limit: 10, windowSeconds: 600 },
  // Public data-subject requests (/privacy-request). Each one sends a
  // verification email, so it is bounded per address to stop the form being
  // used to mail strangers.
  "privacy:request": { limit: 5, windowSeconds: 3600 },
  // Confirming a request from its emailed link. Generous for a real person,
  // tight enough that token guessing is pointless on top of 256-bit tokens.
  "privacy:verify": { limit: 20, windowSeconds: 600 },
  // The public quote page's POSTs (/q/[token]/sign and /view), per address.
  // A real signer needs two or three; the token is 256 bits, so this only
  // bounds hammering, never guessing.
  "quote:public": { limit: 30, windowSeconds: 600 },
  // In-app global search (/api/search), per signed-in user. Each keystroke
  // after the debounce is a query across several tables.
  "app:search": { limit: 60, windowSeconds: 60 },
  // CSV exports (/api/exports/*), per signed-in user. Each one reads up to the
  // export row cap, so a script looping over them is bounded here.
  "app:export": { limit: 10, windowSeconds: 600 },
  // Audit log export (Settings -> Data Controls), per signed-in user. Each one
  // can stream up to a year of history, so it is bounded tighter than CSVs.
  "app:audit_export": { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Buckets that refuse the request when the limiter cannot answer. */
export const FAIL_CLOSED_BUCKETS: ReadonlySet<RateLimitKey> = new Set<RateLimitKey>([
  "auth:signin",
  "auth:signup",
  "auth:reset",
  "admin:signin",
  "admin:stepup",
  "auth:mfa",
]);

/** How long a fail-closed refusal asks the caller to wait. */
export const FAIL_CLOSED_RETRY_SECONDS = 30;

/** The answer when the limiter itself is unavailable. Pure: tested directly. */
export function limiterUnavailableResult(key: RateLimitKey): RateLimitResult {
  if (FAIL_CLOSED_BUCKETS.has(key)) {
    return { allowed: false, remaining: 0, retryAfterSeconds: FAIL_CLOSED_RETRY_SECONDS };
  }
  return { allowed: true, remaining: RATE_LIMITS[key].limit, retryAfterSeconds: 0 };
}

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
      return limiterUnavailableResult(key);
    }

    const row = data[0];
    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after,
    };
  } catch {
    return limiterUnavailableResult(key);
  }
}

/** A 429 for a refused result, with Retry-After. */
export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again shortly." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, result.retryAfterSeconds)),
      },
    },
  );
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
