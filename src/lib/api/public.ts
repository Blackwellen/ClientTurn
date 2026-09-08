import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { roleMeets, type PlatformScope } from "@/lib/platform/scopes";
import {
  authenticateApiKey,
  logApiRequest,
  touchApiKey,
  type ApiKeyContext,
  type ApiRequestOutcome,
} from "@/lib/api-keys/service";

/**
 * The public API's front door (`/api/v1/*`).
 *
 * Every route goes through `withApiKey`, so there is one place that decides
 * who a caller is and what they may do — a second, hand-rolled auth check in a
 * route handler is exactly how one endpoint ends up missing the scope test.
 *
 * The order is deliberate and each step exists for a reason:
 *
 *   1. **Rate limit unauthenticated attempts first**, keyed by address. This is
 *      the bucket that makes guessing a key impractical, and it has to come
 *      before the database lookup or guessing costs us a query per guess.
 *   2. **Resolve the key**, which re-reads the owner's live membership.
 *   3. **Rate limit by key**, so one customer's runaway loop cannot degrade
 *      anyone else.
 *   4. **Check the scope, then the role.** Both, not either: the scope is what
 *      the key was granted, the role is what its owner can still do, and the
 *      narrower of the two wins.
 *   5. **Log the outcome**, success or refusal, with the key that made it.
 *
 * Two things this deliberately does not do. It sends no CORS headers, because
 * an API key must never be usable from a browser page — a key in front-end
 * JavaScript is a key in the hands of every visitor, and refusing the preflight
 * is a clearer signal than a runtime warning nobody reads. And it never returns
 * a stack trace or a database message; the caller gets a stable code.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "rate_limited"
  | "needs_confirmation"
  | "conflict"
  | "server_error";

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  needs_confirmation: 409,
  conflict: 409,
  server_error: 500,
};

export class ApiError extends Error {
  // Plain fields rather than constructor parameter properties, matching
  // `ServiceError` and `EntitlementError`: the test runner strips types without
  // transforming them, and a parameter property is a transform. Keeping this
  // plain means a test can exercise the file that ships.
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export type ApiRequestContext = ApiKeyContext & {
  requestId: string;
  ip: string;
};

type RouteOptions = {
  /** The scope the key must hold. */
  scope: PlatformScope;
  /** The minimum role the key's owner must still have. */
  minimumRole?: "viewer" | "member" | "admin" | "owner";
};

function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    { error: { code, message, request_id: requestId, ...extra } },
    {
      status: STATUS_FOR_CODE[code],
      headers: {
        "x-request-id": requestId,
        // Server-to-server only. Stated in a header as well as in the docs so a
        // developer debugging a browser call sees why it will never work.
        "x-clientturn-api": "server-to-server",
        ...(code === "unauthorized"
          ? { "www-authenticate": 'Bearer realm="clientturn"' }
          : {}),
      },
    },
  );
}

/**
 * Wraps a route handler with authentication, scope enforcement, rate limiting
 * and logging.
 */
export function withApiKey<Route = unknown>(
  options: RouteOptions,
  handler: (
    request: Request,
    context: ApiRequestContext,
    // Next's own second argument, carrying `params` for a dynamic segment. It
    // is passed straight through rather than parsed here, so a route keeps the
    // types Next gives it.
    route: Route,
  ) => Promise<NextResponse | Response>,
) {
  return async function route(request: Request, routeContext: Route): Promise<Response> {
    const started = Date.now();
    const requestId = randomUUID();
    const url = new URL(request.url);
    const ip = clientIdentifier(request.headers);
    const userAgent = request.headers.get("user-agent");

    const finish = async (
      response: Response,
      outcome: ApiRequestOutcome,
      context: { businessId: string | null; keyId: string | null },
      errorCode?: string,
    ) => {
      await logApiRequest({
        businessId: context.businessId,
        apiKeyId: context.keyId,
        method: request.method,
        path: url.pathname,
        statusCode: response.status,
        outcome,
        errorCode: errorCode ?? null,
        latencyMs: Date.now() - started,
        ip,
        userAgent,
      });
      return response;
    };

    /* -------------------------------------------- 1. unauthenticated bound */

    const guessLimit = await checkRateLimit("api:unauthenticated", ip);
    if (!guessLimit.allowed) {
      return finish(
        errorResponse("rate_limited", "Too many requests.", requestId, {
          retry_after: guessLimit.retryAfterSeconds,
        }),
        "RATE_LIMITED",
        { businessId: null, keyId: null },
      );
    }

    /* --------------------------------------------------- 2. resolve the key */

    const resolution = await authenticateApiKey(
      request.headers.get("authorization"),
      ip,
    );

    if (!resolution.ok) {
      // One message for every refusal. Telling a caller that their key exists
      // but expired, or exists but is blocked by IP, is telling someone holding
      // a stolen key exactly what they are holding.
      return finish(
        errorResponse(
          "unauthorized",
          "That API key is not valid for this request.",
          requestId,
        ),
        resolution.reason === "IP_BLOCKED" ? "IP_BLOCKED" : "UNAUTHORIZED",
        { businessId: null, keyId: null },
        resolution.reason,
      );
    }

    const key = resolution.context;

    /* ------------------------------------------------------ 3. per-key bound */

    const keyLimit = await checkRateLimit("api:key", key.keyId);
    if (!keyLimit.allowed) {
      return finish(
        errorResponse("rate_limited", "Too many requests.", requestId, {
          retry_after: keyLimit.retryAfterSeconds,
        }),
        "RATE_LIMITED",
        { businessId: key.businessId, keyId: key.keyId },
      );
    }

    /* ----------------------------------------------------- 4. scope and role */

    if (!key.scopes.includes(options.scope)) {
      return finish(
        errorResponse(
          "forbidden",
          `This key was not granted the "${options.scope}" permission.`,
          requestId,
          { required_scope: options.scope },
        ),
        "FORBIDDEN_SCOPE",
        { businessId: key.businessId, keyId: key.keyId },
        options.scope,
      );
    }

    const minimum = options.minimumRole ?? "viewer";
    if (!roleMeets(key.userRole, minimum)) {
      return finish(
        errorResponse(
          "forbidden",
          "The person this key belongs to no longer has permission for this.",
          requestId,
        ),
        "FORBIDDEN_ROLE",
        { businessId: key.businessId, keyId: key.keyId },
        minimum,
      );
    }

    /* --------------------------------------------------------- 5. the work */

    await touchApiKey(key.keyId, ip);

    try {
      const response = await handler(request, { ...key, requestId, ip }, routeContext);
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      headers.set("x-ratelimit-remaining", String(keyLimit.remaining));

      const decorated = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      return finish(
        decorated,
        response.status >= 400 ? "ERROR" : "OK",
        { businessId: key.businessId, keyId: key.keyId },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        return finish(
          errorResponse(error.code, error.message, requestId, error.details ?? {}),
          error.code === "not_found"
            ? "NOT_FOUND"
            : error.code === "invalid_request"
              ? "INVALID"
              : "ERROR",
          { businessId: key.businessId, keyId: key.keyId },
          error.code,
        );
      }

      // Nothing from the underlying error reaches the caller. A Postgres
      // message can name a column, a constraint, or a table that the customer
      // has no business knowing exists.
      return finish(
        errorResponse(
          "server_error",
          "Something went wrong at our end. The request id identifies this attempt.",
          requestId,
        ),
        "ERROR",
        { businessId: key.businessId, keyId: key.keyId },
        "unhandled",
      );
    }
  };
}

/** A successful JSON body, with the request id echoed for support. */
export function apiSuccess(
  data: unknown,
  init: { status?: number; requestId?: string } = {},
) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: init.requestId ? { "x-request-id": init.requestId } : undefined,
  });
}

/**
 * Maps a service-layer failure onto an HTTP answer.
 *
 * The service layer already decided what is allowed and why; re-deciding it
 * here would be a second policy that could drift from the first. This only
 * translates.
 */
export function serviceFailureToApiError(failure: {
  code: string;
  message: string;
  effect?: string;
}): ApiError {
  switch (failure.code) {
    case "NOT_FOUND":
      return new ApiError("not_found", failure.message);
    case "FORBIDDEN_ROLE":
    case "FORBIDDEN_SCOPE":
    case "FORBIDDEN_WORKSPACE":
    case "POLICY_BLOCKED":
      return new ApiError("forbidden", failure.message);
    case "PLAN_LIMIT":
      // 402 would be more precise, but it is widely mishandled by HTTP clients
      // and the message says plainly what happened.
      return new ApiError("forbidden", failure.message);
    case "INVALID_INPUT":
      return new ApiError("invalid_request", failure.message);
    case "NEEDS_CONFIRMATION":
      // The API has nobody at a keyboard, so this is a refusal rather than a
      // prompt. The effect is returned so the caller can tell their user what
      // would have happened and offer to do it in the app.
      return new ApiError(
        "needs_confirmation",
        "This action needs a person to confirm it, so it cannot be done through the API.",
        failure.effect ? { effect: failure.effect } : undefined,
      );
    case "CONFLICT":
      return new ApiError("conflict", failure.message);
    case "PROVIDER_FAILED":
    case "UNAVAILABLE":
      return new ApiError("server_error", failure.message);
    default:
      return new ApiError("server_error", failure.message);
  }
}

/** Parses and bounds a `limit` query parameter. */
export function parseLimit(value: string | null, fallback = 25, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}
