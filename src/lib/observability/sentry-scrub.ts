/**
 * Error tracking (Sentry) options and the scrubber every event passes through.
 *
 * OFF UNLESS CONFIGURED. `src/instrumentation.ts` and
 * `src/instrumentation-client.ts` only load `@sentry/nextjs` when a DSN is
 * set (`SENTRY_DSN` on the server, `NEXT_PUBLIC_SENTRY_DSN` in the browser,
 * which next.config.ts fills from `SENTRY_DSN`). With no DSN nothing is
 * imported, initialised or sent: no cost and no noise in development or tests.
 *
 * THE REDACTION RULE is the logger's (./log.ts, docs/OBSERVABILITY.md): no
 * transcript text, phone numbers or email addresses leave the process. Sentry
 * adds its own ways for data to escape, so this scrubber covers each:
 *
 *   * `sendDefaultPii: false`: no IP address, cookies or request bodies are
 *     attached by the SDK in the first place;
 *   * `user` keeps only an id; `request` keeps method, a scrubbed URL with no
 *     query string, and two harmless headers; cookies, body and env go;
 *   * exception messages and the event message are scrubbed (emails and
 *     phone numbers masked, length capped); stack-frame local variables are
 *     dropped;
 *   * `extra`, `tags` and non-standard `contexts` go through `redact`, so a
 *     `transcript`, `phone` or `email` key is replaced whatever it holds;
 *   * console breadcrumbs are dropped outright (a logged message body is the
 *     easiest leak); HTTP breadcrumbs keep method, status and a scrubbed URL;
 *   * capability tokens in paths (`/q/<token>`, `/unsubscribe/<token>`) are
 *     masked: they are bearer secrets, not identifiers.
 *
 * Pure, apart from importing the logger's pure scrubbers. Tests:
 * tests/sentry-scrub.test.ts.
 */
import { redact, scrubString } from "@/lib/observability/log";

type Json = Record<string, unknown>;

const SAFE_HEADERS = new Set(["content-type", "user-agent"]);
const STANDARD_CONTEXTS = new Set(["os", "browser", "runtime", "device", "trace", "app", "culture", "cloud_resource", "response", "otel"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A path segment that looks like a random token (long, mixed, not a UUID or a word). */
const TOKENISH = /^[A-Za-z0-9_\-.~]{20,}$/;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function maskSegment(segment: string): string {
  if (UUID.test(segment)) return segment;
  if (TOKENISH.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return "[token]";
  return segment;
}

/** Drops the query and fragment, masks token-like path segments, scrubs the rest. */
export function scrubUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const bare = value.split(/[?#]/)[0];
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)?(.*)$/i.exec(bare);
  const origin = match?.[1] ?? "";
  const path = (match?.[2] ?? "").split("/").map(maskSegment).join("/");
  return scrubString(`${origin}${path}`);
}

function scrubRequest(request: unknown): Json | undefined {
  if (!isRecord(request)) return undefined;
  const headers: Json = {};
  if (isRecord(request.headers)) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (SAFE_HEADERS.has(key.toLowerCase()) && typeof value === "string") headers[key] = scrubString(value);
    }
  }
  return {
    ...(typeof request.method === "string" ? { method: request.method } : {}),
    ...(scrubUrl(request.url) ? { url: scrubUrl(request.url) } : {}),
    headers,
  };
}

function scrubException(exception: unknown): unknown {
  if (!isRecord(exception) || !Array.isArray(exception.values)) return exception;
  return {
    ...exception,
    values: exception.values.map((value) => {
      if (!isRecord(value)) return value;
      const out: Json = { ...value };
      if (typeof out.value === "string") out.value = scrubString(out.value);
      if (isRecord(out.stacktrace) && Array.isArray(out.stacktrace.frames)) {
        out.stacktrace = {
          ...out.stacktrace,
          frames: out.stacktrace.frames.map((frame) => {
            if (!isRecord(frame)) return frame;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { vars, ...rest } = frame;
            return rest;
          }),
        };
      }
      return out;
    }),
  };
}

/** Returns null to drop the breadcrumb. */
export function scrubBreadcrumb<B>(breadcrumb: B): B | null {
  if (!isRecord(breadcrumb)) return breadcrumb;
  const category = typeof breadcrumb.category === "string" ? breadcrumb.category : "";
  if (category === "console") return null;
  const out: Json = { ...breadcrumb };
  if (typeof out.message === "string") out.message = scrubString(out.message);
  if (isRecord(out.data)) {
    if (category === "fetch" || category === "xhr" || category === "http" || category === "navigation") {
      const data = out.data;
      out.data = {
        ...(typeof data.method === "string" ? { method: data.method } : {}),
        ...(typeof data.status_code === "number" ? { status_code: data.status_code } : {}),
        ...(scrubUrl(data.url) ? { url: scrubUrl(data.url) } : {}),
        ...(scrubUrl(data.from) ? { from: scrubUrl(data.from) } : {}),
        ...(scrubUrl(data.to) ? { to: scrubUrl(data.to) } : {}),
      };
    } else {
      out.data = redact(out.data);
    }
  }
  return out as B;
}

function scrubContexts(contexts: unknown): unknown {
  if (!isRecord(contexts)) return contexts;
  const out: Json = {};
  for (const [key, value] of Object.entries(contexts)) {
    out[key] = STANDARD_CONTEXTS.has(key) ? value : redact(value);
  }
  return out;
}

function scrubTags(tags: unknown): unknown {
  if (!isRecord(tags)) return tags;
  const out: Json = {};
  for (const [key, value] of Object.entries(tags)) {
    out[key] = typeof value === "string" ? scrubString(value) : value;
  }
  return redact(out);
}

/** Scrubs an error or transaction event in place of the original. Never throws. */
export function scrubSentryEvent<E>(event: E): E {
  try {
    if (!isRecord(event)) return event;
    const out: Json = { ...event };
    if (isRecord(out.user)) out.user = typeof out.user.id === "string" ? { id: out.user.id } : undefined;
    if ("request" in out) out.request = scrubRequest(out.request);
    if (typeof out.message === "string") out.message = scrubString(out.message);
    if (isRecord(out.logentry)) {
      out.logentry = {
        message: typeof out.logentry.message === "string" ? scrubString(out.logentry.message) : undefined,
        params: Array.isArray(out.logentry.params) ? redact(out.logentry.params) : undefined,
      };
    }
    if (typeof out.transaction === "string") out.transaction = scrubUrl(out.transaction) ?? out.transaction;
    if ("exception" in out) out.exception = scrubException(out.exception);
    if ("extra" in out) out.extra = redact(out.extra);
    if ("contexts" in out) out.contexts = scrubContexts(out.contexts);
    if ("tags" in out) out.tags = scrubTags(out.tags);
    if (Array.isArray(out.breadcrumbs)) {
      out.breadcrumbs = out.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb)).filter((crumb) => crumb !== null);
    }
    if (Array.isArray(out.spans)) {
      out.spans = out.spans.map((span) =>
        isRecord(span)
          ? { ...span, description: typeof span.description === "string" ? scrubUrl(span.description) ?? scrubString(span.description) : span.description, data: undefined }
          : span,
      );
    }
    return out as E;
  } catch {
    // A scrubber failure must drop detail, never leak it.
    return { event_id: (event as Json | null)?.event_id, message: "[event dropped by scrubber]" } as E;
  }
}

export type SentryRuntime = "nodejs" | "edge" | "browser";

/**
 * The options every runtime passes to `Sentry.init`. Tracing is off unless
 * `SENTRY_TRACES_SAMPLE_RATE` (or the NEXT_PUBLIC_ one in the browser) is set;
 * session replay is never enabled (it would record what people type).
 */
export function sentryOptions(input: {
  dsn: string;
  runtime: SentryRuntime;
  environment?: string;
  release?: string;
  tracesSampleRate?: string;
}) {
  const rate = Number(input.tracesSampleRate ?? "0");
  return {
    dsn: input.dsn,
    environment: input.environment || "development",
    release: input.release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0,
    maxBreadcrumbs: 30,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    initialScope: { tags: { runtime: input.runtime } },
  };
}
