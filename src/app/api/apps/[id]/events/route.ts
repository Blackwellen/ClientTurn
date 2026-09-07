import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecret } from "@/lib/security/secret-box";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import type { AuthMethod } from "@/lib/integrations/apps";

/**
 * The inbound contact endpoint.
 *
 * This is the whole of what a connector "installation" is: a URL that accepts
 * one contact per request from a system the customer already runs. It calls
 * nothing outward and holds no grant on the sending system.
 *
 * Every rejection below is recorded against the installation with a short,
 * non-sensitive reason so Connections can tell the customer their sender is
 * misconfigured instead of silently dropping traffic. The reason string never
 * contains any part of the body or the credential.
 */

const MAX_BODY_BYTES = 16_384;
const MAX_CLOCK_SKEW_SECONDS = 300;

/** Compares without leaking length or content through timing. */
function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length is not itself secret, and timingSafeEqual throws on a mismatch.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const payloadSchema = z
  .object({
    eventId: z.string().min(1).max(150),
    eventType: z.string().max(60).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    email: z.email().max(254).optional(),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
    company: z.string().max(150).optional(),
  })
  .refine((v) => !!v.email || !!v.phone);

/** Best-effort read of the sender's own event id, for deduplicating a replay. */
function readEventId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { eventId?: unknown }).eventId;
  return typeof candidate === "string" ? candidate.slice(0, 150) : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await rateLimitResponse("webhook:inbound", request.headers);
  if (limited) return limited;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid installation" }, { status: 400 });
  }

  const db = createAdminClient();

  /**
   * Records why a request was refused, then refuses it.
   *
   * `keep` carries the body into the failure log so a person can see what was
   * lost and replay it. It is passed **only after authentication succeeded** —
   * a request that failed the signature check is recorded as a reason and a
   * count, never as content. Storing unauthenticated bodies would make a public
   * endpoint a place anyone can write arbitrary JSON for staff to read back.
   */
  async function reject(
    reason: string,
    message: string,
    status: number,
    keep?: { payload: unknown; externalEventId?: string },
  ) {
    await db
      .rpc("record_workspace_app_failure", { p_install_id: id, p_reason: reason })
      // A failed bookkeeping write must not turn a 401 into a 500.
      .then(
        () => undefined,
        () => undefined,
      );

    if (keep) {
      await db
        .rpc("record_connector_event_failure", {
          p_install_id: id,
          p_reason: reason,
          p_payload: keep.payload as never,
          p_external_event_id: keep.externalEventId ?? null,
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }

    return Response.json({ error: message }, { status });
  }

  const { data: install } = await db
    .from("workspace_app_installs")
    .select("secret_ciphertext,credentials_ciphertext,auth_method")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();

  if (!install) {
    // No row to record against, and no signal about whether the id exists.
    return Response.json({ error: "Installation unavailable" }, { status: 401 });
  }

  const method = (install.auth_method ?? "hmac_sha256") as AuthMethod;
  const opened = openSecret(install.credentials_ciphertext ?? install.secret_ciphertext);
  if (!opened) {
    return Response.json({ error: "Installation unavailable" }, { status: 401 });
  }

  // Installs created before the credential model stored a bare secret rather
  // than a JSON object, and both shapes must keep working.
  let credentials: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(opened);
    credentials =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : { signing_secret: opened };
  } catch {
    credentials = { signing_secret: opened };
  }

  // Content type is enforced before the body is read: it costs nothing and
  // turns a class of misconfigured sender into a clear error rather than a
  // confusing JSON parse failure.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reject("bad_content_type", "Content-Type must be application/json", 415);
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return reject("payload_too_large", "Payload too large", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return reject("payload_too_large", "Payload too large", 413);
  }

  // --- authentication -------------------------------------------------
  if (method === "hmac_sha256") {
    const timestamp = request.headers.get("x-clientturn-timestamp") ?? "";
    const signature = request.headers.get("x-clientturn-signature") ?? "";

    // Bounded digits rather than an exact width, so this neither rejects a
    // valid pre-2001 clock nor breaks when Unix time gains a digit.
    if (!/^\d{9,12}$/.test(timestamp)) {
      return reject("bad_timestamp", "Invalid timestamp", 401);
    }
    // Symmetric: a clock far in the future is as much a misconfiguration as
    // one far in the past, and accepting it would widen the replay window.
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      return reject("stale_timestamp", "Expired timestamp", 401);
    }

    const secret = credentials.signing_secret;
    if (!secret) return reject("misconfigured", "Installation unavailable", 401);

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex");

    if (!/^[a-f0-9]{64}$/.test(signature) || !safeCompare(signature, expected)) {
      return reject("invalid_signature", "Invalid signature", 401);
    }
  } else if (method === "bearer") {
    const header = request.headers.get("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
    if (!token || !safeCompare(token, credentials.bearer_token ?? "")) {
      return reject("invalid_token", "Invalid credentials", 401);
    }
  } else if (method === "api_key_header") {
    const name = credentials.header_name ?? "";
    const supplied = name ? (request.headers.get(name) ?? "") : "";
    if (!supplied || !safeCompare(supplied, credentials.api_key ?? "")) {
      return reject("invalid_api_key", "Invalid credentials", 401);
    }
  } else if (method === "basic") {
    const header = request.headers.get("authorization") ?? "";
    const encoded = header.toLowerCase().startsWith("basic ") ? header.slice(6) : "";
    const decoded = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    const separator = decoded.indexOf(":");
    const user = separator === -1 ? "" : decoded.slice(0, separator);
    const pass = separator === -1 ? "" : decoded.slice(separator + 1);
    // Both halves are always compared so a wrong username and a wrong
    // password take the same time to reject.
    const userOk = safeCompare(user, credentials.username ?? "");
    const passOk = safeCompare(pass, credentials.password ?? "");
    if (!userOk || !passOk) {
      return reject("invalid_basic_auth", "Invalid credentials", 401);
    }
  } else {
    return reject("misconfigured", "Installation unavailable", 401);
  }

  // --- payload --------------------------------------------------------
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return reject("invalid_json", "Invalid JSON", 400);
  }

  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) {
    // Authenticated but malformed. Worth keeping: this is a sender whose field
    // mapping is wrong, and the body is what shows which field.
    return reject(
      "invalid_payload",
      "Provide eventId and a valid email or E.164 phone.",
      400,
      { payload: value, externalEventId: readEventId(value) },
    );
  }

  const { error } = await db.rpc("receive_workspace_app_event", {
    p_install_id: id,
    p_event_id: parsed.data.eventId,
    p_payload: parsed.data,
  });

  if (error) {
    // Authenticated and valid, and we still lost it. This is the case replay
    // exists for.
    return reject("queue_failed", "Event could not be queued", 503, {
      payload: parsed.data,
      externalEventId: parsed.data.eventId,
    });
  }

  return Response.json(
    { accepted: true, eventId: parsed.data.eventId, status: "queued" },
    { status: 202 },
  );
}
