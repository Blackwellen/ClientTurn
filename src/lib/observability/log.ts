/**
 * Structured operational events for voice, quotes and payments (brief §61).
 *
 * Pure: no `server-only`, no Supabase, no network. It writes one JSON line per
 * event to the console, which is what Vercel and the local dev server collect.
 * Import it from any server module (and from the other agents' voice/quote
 * code) as `@/lib/observability/log` or, from a pure module, by relative path.
 *
 * THE REDACTION RULE (tests/observability-log.test.ts):
 *   Generic logs NEVER carry transcript text, phone numbers or email
 *   addresses. Three layers enforce it, so one mistake is not a leak:
 *     1. Forbidden keys (transcript, text, body, summary, phone, e164, to,
 *        from, email, ...) are replaced by "[redacted]" wherever they appear,
 *        at any depth.
 *     2. Any string value that looks like an email address or a phone number
 *        is masked in place, whatever key it sits under.
 *     3. Long free-text strings are truncated to 200 characters, so a stray
 *        paragraph of conversation cannot ride along under an innocent key.
 *   Identifiers (call id, lead id, quote id), states, codes, durations,
 *   counts and money amounts are what an event is for, and pass through.
 *
 * Nothing here is a metric store: `voice_call_events`, `quote_events` and
 * `checkout_payments` remain the systems of record. This is for operators
 * reading logs when something goes wrong.
 */

export const OBSERVABILITY_EVENTS = [
  // voice
  "voice.call_requested",
  "voice.eligibility_decided",
  "voice.provider_initiated",
  "voice.answered",
  "voice.disconnected",
  "voice.duration_recorded",
  "voice.tool_used",
  "voice.transferred",
  "voice.post_processed",
  "voice.cost_recorded",
  "voice.error",
  // quotes
  "quote.event",
  "quote.error",
  // payments
  "payment.recorded",
  "payment.error",
  // experiments
  "experiment.promoted",
  "experiment.rolled_back",
  // admin controls and analytics reads
  "admin.voice_control",
  "analytics.read_failed",
  // push alerts and their failures (src/lib/ops/alerts.ts)
  "ops.alert",
  "ops.error",
] as const;

export type ObservabilityEvent = (typeof OBSERVABILITY_EVENTS)[number];

export type LogLevel = "info" | "warn" | "error";

/** Keys whose values are never logged, compared case-insensitively after removing `_` and `-`. */
const FORBIDDEN_KEYS = new Set(
  [
    "transcript",
    "transcripts",
    "segments",
    "text",
    "body",
    "message",
    "content",
    "utterance",
    "words",
    "summary",
    "evidence",
    "evidenceexcerpt",
    "notes",
    "note",
    "phone",
    "phonenumber",
    "mobile",
    "e164",
    "to",
    "from",
    "tonumber",
    "fromnumber",
    "callerid",
    "caller",
    "email",
    "emailaddress",
    "signeremail",
    "actoremail",
    "name",
    "firstname",
    "lastname",
    "fullname",
    "signername",
    "typedname",
    "address",
    "recordingurl",
    "url",
  ].map((key) => key.toLowerCase()),
);

export const REDACTED = "[redacted]";
const MAX_STRING = 200;
const MAX_DEPTH = 5;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * A phone number: an optional +, then 7 or more digits allowing spaces,
 * dots, dashes and brackets between them. UUIDs are not matched because
 * their groups are hex and separated by dashes in a fixed 8-4-4-4-12 shape,
 * which is checked first and left alone.
 */
const PHONE = /(?:\+|\b00)?\(?\d[\d\s().-]{6,}\d/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(normaliseKey(key));
}

/** Masks emails and phone numbers inside one string, and caps its length. */
export function scrubString(value: string): string {
  if (UUID.test(value) || ISO_DATE.test(value)) return value;
  let out = value.replace(EMAIL, "[email]");
  out = out.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 7 ? "[phone]" : match;
  });
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

/**
 * A deep copy with every forbidden key replaced and every string scrubbed.
 * Never throws: an unserialisable value becomes a type tag.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message) };
  if (depth >= MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isForbiddenKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return `[${typeof value}]`;
}

export type LogRecord = {
  ts: string;
  level: LogLevel;
  event: ObservabilityEvent;
  fields: Record<string, unknown>;
};

/** Builds the record without writing it. Exposed for tests and for callers that batch. */
export function buildLogRecord(
  event: ObservabilityEvent,
  fields: Record<string, unknown> = {},
  level: LogLevel = "info",
  now: Date = new Date(),
): LogRecord {
  return {
    ts: now.toISOString(),
    level,
    event,
    fields: redact(fields) as Record<string, unknown>,
  };
}

type Sink = (line: string, level: LogLevel) => void;

const consoleSink: Sink = (line, level) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

let sink: Sink = consoleSink;

/** Tests swap the sink to capture lines. Returns a restore function. */
export function setLogSink(next: Sink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

/**
 * Writes one structured, redacted event. Never throws: logging must not be
 * the reason a call, a quote or a payment fails.
 */
export function logEvent(
  event: ObservabilityEvent,
  fields: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  try {
    const record = buildLogRecord(event, fields, level);
    sink(JSON.stringify({ ct: "obs", ...record }), level);
  } catch {
    // Swallowed on purpose (see above).
  }
}

/** Convenience wrappers for the common shapes. */
export const obs = {
  info: (event: ObservabilityEvent, fields?: Record<string, unknown>) => logEvent(event, fields, "info"),
  warn: (event: ObservabilityEvent, fields?: Record<string, unknown>) => logEvent(event, fields, "warn"),
  error: (event: ObservabilityEvent, fields?: Record<string, unknown>) => logEvent(event, fields, "error"),
};
