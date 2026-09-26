import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite } from "@/lib/supabase/write-result";
import { serverEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { tokenHash } from "./hash";
import { normaliseEmail, normalisePhoneE164 } from "@/lib/ingest/normalise";
import { queueNotification } from "@/lib/jobs/handlers/shared";
import {
  PRIVACY_REQUEST_TYPE_COPY,
  routedFromMarker,
  routingTargets,
  type RoutingMatch,
  type PrivacyRequestKind,
  type PrivacyRequestState,
  type WorkspacePrivacyRequest,
} from "./types";

/**
 * Data-subject requests (Phase 6, DSAR).
 *
 * Two doors in:
 *
 *   * the public form at /privacy-request -- platform-level (business_id
 *     null) until ClientTurn routes it, because a stranger cannot be told
 *     which of our customers holds their data without us first verifying who
 *     they are;
 *   * a workspace recording a request it received itself (Settings -> Data
 *     controls, or the privacy_request.create operation).
 *
 * The clocks (acknowledge_by = +30 days for the DUAA complaint duty, due_at =
 * +1 month for the Art 12(3) response) are set by a database trigger, so no
 * writer can forget them.
 */

const VERIFY_TTL_HOURS = 72;

/** Where a workspace answers a privacy request. */
const PRIVACY_REQUESTS_PATH = "/app/settings?section=data-controls";

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/* ------------------------------------------------------------ public intake */

export type PublicRequestInput = {
  type: PrivacyRequestKind;
  name: string;
  email: string;
  phone?: string;
  context?: string;
  details?: string;
};

/**
 * Records a public request and emails a verification link. The token is
 * returned to nobody but the email: only its sha256 is stored.
 *
 * Returns the reference whatever the email outcome, because the request is
 * received the moment it is recorded and the clocks start then -- a failed
 * email does not un-receive it, and an operator can see it is unverified.
 */
export async function createPublicRequest(
  input: PublicRequestInput,
): Promise<{ reference: string; emailed: boolean }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + VERIFY_TTL_HOURS * 3_600_000).toISOString();

  const { data, error } = await db()
    .from("privacy_requests")
    .insert({
      business_id: null,
      request_type: input.type,
      subject_name: input.name,
      subject_email: input.email.trim().toLowerCase(),
      subject_phone: input.phone ?? null,
      subject_context: input.context ?? null,
      details: input.details ?? null,
      source: "PUBLIC_FORM",
      verification_status: "PENDING",
      verification_token_hash: tokenHash(token),
      verification_expires_at: expires,
    })
    .select("id, reference")
    .single();
  assertWrite({ error }, "privacy_requests insert (public)");
  const row = data as { id: string; reference: string };

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "privacy_request.received",
    entityType: "privacy_request",
    entityId: row.id,
    metadata: { reference: row.reference, type: input.type, source: "PUBLIC_FORM" },
  });

  const emailed = await sendVerificationEmail(input.email, input.name, row.reference, input.type, token);
  return { reference: row.reference, emailed };
}

async function sendVerificationEmail(
  to: string,
  name: string,
  reference: string,
  type: PrivacyRequestKind,
  token: string,
): Promise<boolean> {
  const key = serverEnv.resend.apiKey;
  if (!key) return false;

  const link = `${serverEnv.siteUrl.replace(/\/$/, "")}/privacy-request/verify?token=${encodeURIComponent(token)}`;
  const what = PRIVACY_REQUEST_TYPE_COPY[type].label.toLowerCase();
  const text = [
    `Hello ${name},`,
    "",
    `We received a request to ${what} (reference ${reference}).`,
    "",
    "To confirm it was you, open this link within 72 hours:",
    link,
    "",
    "If you did not make this request, ignore this email and nothing will happen.",
    "",
    "ClientTurn",
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: serverEnv.resend.from,
        to: [to],
        subject: `Confirm your privacy request ${reference}`,
        text,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Confirms a request from its emailed link. The same answer for an unknown
 * and an expired token, so the page is not an oracle for which tokens exist.
 */
export async function verifyRequestToken(
  token: string,
): Promise<{ ok: true; reference: string } | { ok: false }> {
  const client = db();
  const { data } = await client
    .from("privacy_requests")
    .select("id, reference, verification_status, verification_expires_at")
    .eq("verification_token_hash", tokenHash(token))
    .maybeSingle();
  const row = data as {
    id: string;
    reference: string;
    verification_status: string;
    verification_expires_at: string | null;
  } | null;
  if (!row) return { ok: false };

  if (row.verification_expires_at && new Date(row.verification_expires_at).getTime() < Date.now()) {
    const expired = await client
      .from("privacy_requests")
      .update({ verification_status: "EXPIRED", verification_token_hash: null })
      .eq("id", row.id);
    assertWrite(expired, "privacy_requests expire token", { id: row.id });
    return { ok: false };
  }

  const updated = await client
    .from("privacy_requests")
    .update({
      verification_status: "VERIFIED",
      verified_at: new Date().toISOString(),
      // Single use: the link cannot be replayed once it has done its job.
      verification_token_hash: null,
    })
    .eq("id", row.id);
  assertWrite(updated, "privacy_requests verify", { id: row.id });

  await recordAudit({
    businessId: null,
    actorType: "system",
    action: "privacy_request.verified",
    entityType: "privacy_request",
    entityId: row.id,
    metadata: { reference: row.reference },
  });

  // Routing failure must not un-verify the person: they did their part, and
  // the platform-admin view still has the request. It is logged instead.
  try {
    await routeVerifiedPublicRequest(row.id);
  } catch (error) {
    console.error("[privacy-requests] routing failed", {
      id: row.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true, reference: row.reference };
}

/* --------------------------------------------------------------- routing */

/**
 * Hands a verified public request to every workspace that holds the person.
 *
 * A public request is filed against ClientTurn (business_id null) because a
 * stranger cannot be told which customer holds their data before they have
 * proved who they are. Once verified, the controllers who actually hold the
 * data -- our customers -- have to act on it, inside the same statutory clock.
 * So each matching workspace gets its own copy, received at the original time
 * (the clocks are the person's, not ours), linked back by reference, and its
 * owners and admins are notified. The platform row stays, for the admin view.
 *
 * Matched on the verified email across leads and prospects, and on the phone
 * they typed across leads. A phone-only match is routed as PENDING
 * verification: the email is what they proved, the phone is only a claim.
 *
 * Idempotent: a workspace that already has a copy is not given a second one.
 */
export async function routeVerifiedPublicRequest(
  requestId: string,
): Promise<{ routed: number }> {
  const client = db();
  const { data: parentData, error: parentError } = await client
    .from("privacy_requests")
    .select(
      "id, reference, request_type, subject_name, subject_email, subject_phone, subject_context, details, received_at, verification_status, business_id",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (parentError) throw new Error(`privacy request read failed: ${parentError.message}`);
  const parent = parentData as {
    id: string;
    reference: string;
    request_type: string;
    subject_name: string | null;
    subject_email: string | null;
    subject_phone: string | null;
    subject_context: string | null;
    details: string | null;
    received_at: string;
    verification_status: string;
    business_id: string | null;
  } | null;
  if (!parent || parent.business_id !== null || parent.verification_status !== "VERIFIED") {
    return { routed: 0 };
  }

  const email = normaliseEmail(parent.subject_email);
  const phone = normalisePhoneE164(parent.subject_phone);
  const emailValue = email.ok ? email.value : null;
  const phoneValue = phone.ok ? phone.value : null;

  const matches: RoutingMatch[] = [];
  if (emailValue) {
    const [leads, prospects] = await Promise.all([
      client
        .from("leads")
        .select("id, business_id")
        .eq("email_normalized", emailValue)
        .limit(200),
      client.from("prospects").select("business_id").ilike("email", emailValue).limit(200),
    ]);
    if (leads.error) throw new Error(`lead lookup failed: ${leads.error.message}`);
    if (prospects.error) throw new Error(`prospect lookup failed: ${prospects.error.message}`);
    for (const lead of (leads.data ?? []) as { id: string; business_id: string }[]) {
      matches.push({ businessId: lead.business_id, via: "EMAIL", leadId: lead.id });
    }
    for (const prospect of (prospects.data ?? []) as { business_id: string }[]) {
      matches.push({ businessId: prospect.business_id, via: "EMAIL", leadId: null });
    }
  }
  if (phoneValue) {
    const { data, error } = await client
      .from("leads")
      .select("id, business_id")
      .eq("phone_normalized", phoneValue)
      .limit(200);
    if (error) throw new Error(`lead phone lookup failed: ${error.message}`);
    for (const lead of (data ?? []) as { id: string; business_id: string }[]) {
      matches.push({ businessId: lead.business_id, via: "PHONE", leadId: lead.id });
    }
  }

  const targets = routingTargets(matches);
  const marker = routedFromMarker(parent.reference);
  let routed = 0;

  for (const target of targets) {
    const { data: existing, error: existingError } = await client
      .from("privacy_requests")
      .select("id")
      .eq("business_id", target.businessId)
      .like("details", `${marker}%`)
      .limit(1);
    if (existingError) throw new Error(`routing check failed: ${existingError.message}`);
    if ((existing ?? []).length > 0) continue;

    const details = [
      marker,
      target.emailMatched
        ? "The person confirmed they own this email address."
        : "Matched on a phone number the person typed. Their email was verified, the phone was not, so confirm who they are before acting.",
      parent.details ?? "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);

    const { data: child, error: insertError } = await client
      .from("privacy_requests")
      .insert({
        business_id: target.businessId,
        request_type: parent.request_type,
        subject_name: parent.subject_name,
        subject_email: parent.subject_email,
        subject_phone: parent.subject_phone,
        subject_context: parent.subject_context,
        subject_lead_id: target.leadId,
        details,
        source: "PUBLIC_FORM",
        verification_status: target.emailMatched ? "VERIFIED" : "PENDING",
        verified_at: target.emailMatched ? new Date().toISOString() : null,
        // The statutory clock started when the person asked.
        received_at: parent.received_at,
      })
      .select("id, reference")
      .single();
    assertWrite({ error: insertError }, "privacy_requests insert (routed)", {
      businessId: target.businessId,
    });
    const childRow = child as { id: string; reference: string };
    routed += 1;

    await recordAudit({
      businessId: target.businessId,
      actorType: "system",
      action: "privacy_request.routed",
      entityType: "privacy_request",
      entityId: childRow.id,
      metadata: { reference: childRow.reference, from: parent.reference },
    });

    const what =
      PRIVACY_REQUEST_TYPE_COPY[parent.request_type as PrivacyRequestKind]?.label.toLowerCase() ??
      parent.request_type.toLowerCase();
    await queueNotification({
      businessId: target.businessId,
      type: "lead_attention",
      severity: "warning",
      title: `Privacy request ${childRow.reference} needs a response`,
      body: `Someone whose details you hold asked to ${what}. The legal clock started when they asked, so respond from Settings, Data controls.`,
      linkUrl: PRIVACY_REQUESTS_PATH,
      entityType: "privacy_request",
      entityId: childRow.id,
      dedupeKey: `privacy-routed:${childRow.id}`,
    });
  }

  if (routed > 0) {
    const { error: parentUpdateError } = await client
      .from("privacy_requests")
      .update({
        status: "IN_PROGRESS",
        resolution_note: `Routed to ${targets.length} workspace${targets.length === 1 ? "" : "s"} holding this person's details.`,
      })
      .eq("id", parent.id)
      .eq("status", "PENDING");
    if (parentUpdateError) {
      console.error("[privacy-requests] parent status update failed", parentUpdateError.message);
    }
  }

  return { routed };
}

/* ------------------------------------------------------------- workspace */


const WORKSPACE_FIELDS =
  "id, reference, request_type, subject_email, subject_name, status, verification_status, source, received_at, acknowledge_by, acknowledged_at, due_at, subject_lead_id, details";

type Row = {
  id: string;
  reference: string | null;
  request_type: string;
  subject_email: string | null;
  subject_name: string | null;
  status: PrivacyRequestState;
  verification_status: string;
  source: string;
  received_at: string;
  acknowledge_by: string | null;
  acknowledged_at: string | null;
  due_at: string | null;
  subject_lead_id: string | null;
  details: string | null;
};

function shape(row: Row): WorkspacePrivacyRequest {
  return {
    id: row.id,
    reference: row.reference ?? "—",
    type: row.request_type,
    subjectEmail: row.subject_email,
    subjectName: row.subject_name,
    status: row.status,
    verificationStatus: row.verification_status,
    source: row.source,
    receivedAt: row.received_at,
    acknowledgeBy: row.acknowledge_by,
    acknowledgedAt: row.acknowledged_at,
    dueAt: row.due_at,
    subjectLeadId: row.subject_lead_id,
    details: row.details,
  };
}

export async function listWorkspaceRequests(
  businessId: string,
  limit = 50,
): Promise<WorkspacePrivacyRequest[]> {
  const { data, error } = await db()
    .from("privacy_requests")
    .select(WORKSPACE_FIELDS)
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Privacy request list failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(shape);
}

export type WorkspaceRequestInput = {
  type: PrivacyRequestKind;
  subjectName?: string | null;
  subjectEmail?: string | null;
  subjectPhone?: string | null;
  subjectLeadId?: string | null;
  details?: string | null;
  /** Whether the workspace has already confirmed who the person is. */
  identityVerified: boolean;
  receivedAt?: string | null;
};

export async function createWorkspaceRequest(
  businessId: string,
  userId: string | null,
  input: WorkspaceRequestInput,
): Promise<WorkspacePrivacyRequest> {
  const client = db();

  if (input.subjectLeadId) {
    const { data: lead } = await client
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("id", input.subjectLeadId)
      .maybeSingle();
    if (!lead) throw new RequestInputError("That lead could not be found.");
  }

  const { data, error } = await client
    .from("privacy_requests")
    .insert({
      business_id: businessId,
      request_type: input.type,
      subject_name: input.subjectName ?? null,
      subject_email: input.subjectEmail?.trim().toLowerCase() || null,
      subject_phone: input.subjectPhone ?? null,
      subject_lead_id: input.subjectLeadId ?? null,
      details: input.details ?? null,
      source: "WORKSPACE",
      verification_status: input.identityVerified ? "VERIFIED" : "PENDING",
      verified_at: input.identityVerified ? new Date().toISOString() : null,
      created_by: userId,
      // The statutory clock runs from when the person asked, which may be
      // before somebody got round to recording it here.
      ...(input.receivedAt ? { received_at: input.receivedAt } : {}),
    })
    .select(WORKSPACE_FIELDS)
    .single();
  assertWrite({ error }, "privacy_requests insert (workspace)", { businessId });
  return shape(data as Row);
}

export class RequestInputError extends Error {}

export type WorkspaceRequestPatch = {
  status?: PrivacyRequestState;
  acknowledged?: boolean;
  identityVerified?: boolean;
  subjectLeadId?: string | null;
  note?: string | null;
};

export async function updateWorkspaceRequest(
  businessId: string,
  userId: string | null,
  requestId: string,
  patch: WorkspaceRequestPatch,
): Promise<{ before: WorkspacePrivacyRequest; after: WorkspacePrivacyRequest }> {
  const client = db();
  const { data: current } = await client
    .from("privacy_requests")
    .select(WORKSPACE_FIELDS)
    .eq("business_id", businessId)
    .eq("id", requestId)
    .maybeSingle();
  if (!current) throw new RequestInputError("That request could not be found.");
  const before = shape(current as Row);

  const closing = patch.status === "COMPLETED" || patch.status === "REJECTED";
  if (closing && !patch.note?.trim()) {
    throw new RequestInputError("Record how this request was resolved before closing it.");
  }
  if (patch.subjectLeadId) {
    const { data: lead } = await client
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("id", patch.subjectLeadId)
      .maybeSingle();
    if (!lead) throw new RequestInputError("That lead could not be found.");
  }

  const update: Record<string, unknown> = { handled_by: userId };
  if (patch.status) {
    update.status = patch.status;
    update.completed_at = closing ? new Date().toISOString() : null;
  }
  if (patch.note !== undefined) update.resolution_note = patch.note;
  if (patch.acknowledged === true && !before.acknowledgedAt) {
    update.acknowledged_at = new Date().toISOString();
  }
  if (patch.identityVerified === true && before.verificationStatus !== "VERIFIED") {
    update.verification_status = "VERIFIED";
    update.verified_at = new Date().toISOString();
    update.verification_token_hash = null;
  }
  if (patch.subjectLeadId !== undefined) update.subject_lead_id = patch.subjectLeadId;

  const { data, error } = await client
    .from("privacy_requests")
    .update(update)
    .eq("business_id", businessId)
    .eq("id", requestId)
    .select(WORKSPACE_FIELDS)
    .single();
  assertWrite({ error }, "privacy_requests update", { businessId, requestId });
  return { before, after: shape(data as Row) };
}
