/**
 * The decisions inside ingestLead(), separated from its I/O (design 03 §1).
 * Pure, so every outcome of the contract is asserted without a database
 * (tests/ingest.test.ts). `service.ts` gathers facts and calls these.
 */

import type { IdentityDecision } from "../identity/resolve.ts";
import type { NormalisedPerson } from "./normalise.ts";
import type { IngestOutcomeKind, IngestResult, IngestSourceType } from "./types.ts";

/* ---------------------------------------------------------- 1. validity */

/**
 * No email and no phone is INVALID, except a social DM, whose thread id is
 * the identity (Meta returns no email or phone for a messaging contact).
 */
export function validityProblem(
  person: Pick<NormalisedPerson, "email" | "phone">,
  source: { type: IngestSourceType; providerRecordId?: string | null },
  options: { allowWithoutContactPoint?: boolean } = {},
): string | null {
  if (person.email || person.phone) return null;
  if (source.type === "SOCIAL_DM" && source.providerRecordId) return null;
  // A manual lead with only a landline: a real contact point, not a
  // messaging one. Only a trusted caller (the wizard) may say so.
  if (options.allowWithoutContactPoint && source.type === "MANUAL") return null;
  return "no_contact_point";
}

/* ------------------------------------------------------- 3. idempotency */

/**
 * The idempotency key: the caller's own (an API `Idempotency-Key` header),
 * else the provider's record id, which is what makes a webhook and a poll
 * delivering the same lead one ingest. Null when neither exists (a manual add
 * is deduplicated by identity instead).
 */
export function idempotencyKeyFor(input: {
  idempotencyKey?: string | null;
  provider: string;
  providerRecordId?: string | null;
}): string | null {
  if (input.idempotencyKey) return `key:${input.idempotencyKey}`;
  if (input.providerRecordId) return `record:${input.provider}:${input.providerRecordId}`;
  return null;
}

export type StoredIngestRequest = {
  outcome: IngestOutcomeKind;
  lead_id: string | null;
  touch_id: string | null;
  matched_by: string | null;
  reasons: unknown;
  request_hash: string | null;
};

/** A repeated key returns the first outcome, unchanged, as DUPLICATE. */
export function replayOf(stored: StoredIngestRequest, requestHash: string | null): IngestResult {
  const reasons = Array.isArray(stored.reasons) ? stored.reasons.map(String) : [];
  const mismatch =
    requestHash !== null && stored.request_hash !== null && stored.request_hash !== requestHash;
  return {
    outcome: "DUPLICATE",
    leadId: stored.lead_id,
    touchId: stored.touch_id,
    matchedBy: "IDEMPOTENCY_KEY",
    reasons: mismatch ? [...reasons, "idempotency_key_reused_with_different_body"] : reasons,
    originalOutcome: stored.outcome,
  };
}

/* ------------------------------------------------------- 4. suppression */

export type SuppressionFacts = {
  email: { reason: string } | null;
  sms: { reason: string } | null;
  whatsapp: { reason: string } | null;
};

/**
 * Whether the person can be contacted on anything they supplied. SUPPRESSED
 * means every supplied destination is blocked; a partly blocked person is
 * still CREATED, with the blocked channels named in the reasons (the send
 * guard re-checks per channel before every send regardless).
 */
export function suppressionVerdict(
  person: Pick<NormalisedPerson, "email" | "phone">,
  facts: SuppressionFacts,
): { fullySuppressed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (person.email && facts.email) reasons.push(`suppressed:EMAIL:${facts.email.reason}`);
  if (person.phone && facts.sms) reasons.push(`suppressed:SMS:${facts.sms.reason}`);
  if (person.phone && facts.whatsapp) reasons.push(`suppressed:WHATSAPP:${facts.whatsapp.reason}`);

  const emailBlocked = !person.email || Boolean(facts.email);
  const phoneBlocked = !person.phone || (Boolean(facts.sms) && Boolean(facts.whatsapp));
  const anySupplied = Boolean(person.email || person.phone);
  return { fullySuppressed: anySupplied && emailBlocked && phoneBlocked, reasons };
}

/* ------------------------------------------------------- 5-6. the write */

export type WritePlan =
  | { action: "DUPLICATE"; leadId: string }
  | { action: "INSERT"; outcome: "CREATED" | "SUPPRESSED" | "REVIEW"; conflictLeadId: string | null; linkProspectId: string | null }
  | { action: "MERGE"; outcome: "MERGED" | "SUPPRESSED"; leadId: string; rule: "EMAIL" | "PHONE" | "PROSPECT_PROMOTION"; confidence: number };

/**
 * From the identity decision and the suppression verdict to what is written.
 * Suppression never prevents recording (the business must see the enquiry);
 * it only changes the outcome to "recorded, will not be contacted".
 */
export function writePlan(identity: IdentityDecision, fullySuppressed: boolean): WritePlan {
  switch (identity.kind) {
    case "DUPLICATE":
      return { action: "DUPLICATE", leadId: identity.leadId };
    case "MERGE":
      return {
        action: "MERGE",
        outcome: fullySuppressed ? "SUPPRESSED" : "MERGED",
        leadId: identity.leadId,
        rule: identity.rule,
        confidence: identity.confidence,
      };
    case "REVIEW":
      return { action: "INSERT", outcome: "REVIEW", conflictLeadId: identity.conflictLeadId, linkProspectId: null };
    case "NEW":
      return {
        action: "INSERT",
        outcome: fullySuppressed ? "SUPPRESSED" : "CREATED",
        conflictLeadId: null,
        linkProspectId: identity.linkProspectId,
      };
  }
}

/* ----------------------------------------------------- 7. lead.process */

export type ProcessMode = "FULL" | "RECORD_ONLY";

/**
 * How much of `lead.process` a touch gets.
 *
 * FULL (qualification, metering, follow-up) only for a brand-new lead that
 * may be contacted. A merge must never restart a sequence the lead already
 * finished; a REVIEW waits for a person; a suppressed lead is recorded only;
 * a social DM is worked by the conversation flow that received it; and a CSV
 * row is follow-up only when the operator asked for it. RECORD_ONLY still
 * attributes, records permission, notifies integrations and scores.
 */
export function processModeFor(input: {
  outcome: "CREATED" | "MERGED" | "SUPPRESSED" | "REVIEW";
  sourceType: IngestSourceType;
  requested?: ProcessMode;
}): ProcessMode {
  if (input.outcome !== "CREATED") return "RECORD_ONLY";
  if (input.sourceType === "SOCIAL_DM") return "RECORD_ONLY";
  return input.requested ?? "FULL";
}

/* --------------------------------------------------------- 8. the event */

export function domainEventFor(input: {
  outcome: "CREATED" | "MERGED" | "SUPPRESSED" | "REVIEW";
  inserted: boolean;
  leadId: string;
  touchId: string;
}): { type: "lead.created" | "lead.touched"; dedupeKey: string } {
  return input.inserted
    ? { type: "lead.created", dedupeKey: `lead.created:${input.leadId}` }
    : { type: "lead.touched", dedupeKey: `lead.touched:${input.touchId}` };
}

/* ------------------------------------------------------ insert conflict */

/**
 * Which unique index a failed lead insert hit, from the Postgres error. An
 * identity index is retried as a merge (design §2 "race safety"); the legacy
 * `(business_id, external_id)` key is the same provider record arriving twice.
 */
export function insertConflictKind(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined):
  | "IDENTITY"
  | "EXTERNAL_ID"
  | "OTHER_UNIQUE"
  | null {
  if (!error || error.code !== "23505") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (/leads_identity_(email|phone)_key/.test(text)) return "IDENTITY";
  if (/external_id/.test(text)) return "EXTERNAL_ID";
  return "OTHER_UNIQUE";
}
