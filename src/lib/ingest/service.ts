import "server-only";
import { isEmailOrigin, originForIngestSource } from "@/lib/find-leads/email-origin";
import { prospectEmailOrigin, recordEmailOrigin } from "@/lib/find-leads/server/email-origin-store";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWrite, logWriteError } from "@/lib/supabase/write-result";
import { escapeIlike } from "@/lib/supabase/ilike";
import { enqueue } from "@/lib/jobs/queue";
import { checkSuppression } from "@/lib/policy/suppression";
import { recordPermission } from "@/lib/policy/service";
import type { ConsentStatus, RelationshipType, SubscriberType } from "@/lib/policy/types";
import { emitDomainEvent } from "@/lib/events/outbox";
import {
  mergePatch,
  resolveIdentity,
  type IdentityCandidates,
  type IdentityDecision,
  type IdentityLead,
  type IdentityProspect,
} from "@/lib/identity/resolve";
import { normaliseIngest, type NormalisedIngest } from "./normalise";
import { leadCapPolicyFor, leadIntakeGate } from "@/lib/billing/lead-cap";
import { leadCapacity } from "@/lib/billing/lead-meter";
import {
  domainEventFor,
  idempotencyKeyFor,
  insertConflictKind,
  processModeFor,
  replayOf,
  suppressionVerdict,
  validityProblem,
  writePlan,
  type ProcessMode,
  type StoredIngestRequest,
} from "./plan";
import {
  createdViaFor,
  defaultRelationshipFor,
  ingestInputSchema,
  intakeMethodFor,
  type IngestInput,
  type IngestResult,
  type IngestSourceType,
  type ParsedIngestInput,
} from "./types";

/**
 * `ingestLead()` — every inbound lead source converges here (design 03 §1).
 *
 *   1. validate (zod)                     -> INVALID
 *   2. normalise
 *   3. idempotency (ingest_requests)      -> DUPLICATE, first outcome returned
 *   4. suppression, every destination     -> recorded as SUPPRESSED, never lost
 *   5. identity resolution                -> existing lead | new lead | REVIEW
 *   6. write: insert, or fill blanks only; always one lead_touches row;
 *      contact_permissions upserted
 *   7. queue lead.process, keyed by the touch id
 *   8. emit lead.created | lead.touched
 *   9. return the outcome
 *
 * Throws on a failed database read or write (B13): a poller's cursor must not
 * move past a lead that was not stored, and a job must retry. A caller-level
 * refusal is an outcome, never an exception.
 */

export type IngestOptions = {
  /**
   * RECORD (default): a suppressed person is recorded and never contacted --
   * the business must see the enquiry. REFUSE: nothing is stored and the
   * outcome is REJECTED; the Add Lead wizard and MCP use this, where a person
   * is typing a contact in and "cannot be added" is the right answer.
   */
  onSuppressed?: "RECORD" | "REFUSE";
  /** Columns set on a *new* lead only (the wizard's routing, an import's source). */
  insertExtras?: Record<string, unknown>;
  /** `leads.external_id` for a new lead: the legacy per-provider dedupe key. */
  externalId?: string | null;
  /** lead.process: `false` to skip it entirely; otherwise its mode and hints. */
  process?:
    | false
    | { mode?: ProcessMode; serviceName?: string; sourceName?: string; priority?: number };
  /** Permission-record detail the caller knows better than a default. */
  permission?: {
    detail?: string | null;
    consentStatus?: ConsentStatus;
    evidence?: string | null;
    subscriberType?: SubscriberType;
    country?: string | null;
    recordedBy?: string | null;
    source?: string | null;
  };
  /** The lead_sources row this touch belongs to, when the caller already has one. */
  leadSourceId?: string | null;
  /** MANUAL only: accept a record with no email or mobile (a landline-only lead). */
  allowWithoutContactPoint?: boolean;
};

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

class IngestWriteError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "IngestWriteError";
    this.code = code;
  }
}

function fail(operation: string, error: { message: string; code?: string | null }): never {
  throw new IngestWriteError(`ingest: ${operation} failed: ${error.message}`, error.code ?? null);
}

function requestHash(input: ParsedIngestInput, normalised: NormalisedIngest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        person: normalised.person,
        source: {
          type: input.source.type,
          provider: input.source.provider,
          record: input.source.providerRecordId ?? null,
          form: input.source.formId ?? null,
          campaign: input.source.campaignId ?? null,
        },
        answers: input.answers ?? null,
      }),
    )
    .digest("hex");
}

/* --------------------------------------------------------------- loading */

async function loadCandidates(
  client: SupabaseClient,
  businessId: string,
  input: ParsedIngestInput,
  person: NormalisedIngest["person"],
  externalId: string | null,
): Promise<IdentityCandidates> {
  let providerRecordLeadId: string | null = null;

  if (input.source.providerRecordId) {
    const { data, error } = await client
      .from("lead_touches")
      .select("lead_id")
      .eq("business_id", businessId)
      .eq("provider", input.source.provider)
      .eq("provider_record_id", input.source.providerRecordId)
      .maybeSingle();
    if (error) fail("touch lookup", error);
    providerRecordLeadId = (data as { lead_id: string } | null)?.lead_id ?? null;
  }
  // Leads ingested before lead_touches existed are found by their legacy key.
  if (!providerRecordLeadId && externalId) {
    const { data, error } = await client
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) fail("external id lookup", error);
    providerRecordLeadId = (data as { id: string } | null)?.id ?? null;
  }

  const leadColumns = "id, email, phone_normalized, first_name, last_name, company_name, created_at";
  const live = () =>
    client
      .from("leads")
      .select(leadColumns)
      .eq("business_id", businessId)
      .is("archived_at", null)
      .eq("is_test", false)
      .is("identity_duplicate_of", null)
      .limit(20);

  const lookups: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>[] = [];
  if (person.email) lookups.push(live().eq("email_normalized", person.email));
  if (person.phone) lookups.push(live().eq("phone_normalized", person.phone));
  if (person.firstName && person.lastName) {
    lookups.push(
      live()
        .ilike("first_name", escapeIlike(person.firstName))
        .ilike("last_name", escapeIlike(person.lastName)),
    );
  }

  const prospectColumns =
    "id, email, phone_e164, first_name, last_name, promoted_to_lead_id, created_at, company:prospect_companies(name)";
  const prospectLookups: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>[] = [];
  if (person.email) {
    prospectLookups.push(
      client.from("prospects").select(prospectColumns).eq("business_id", businessId).eq("email", person.email).limit(5),
    );
  }
  if (person.phone) {
    prospectLookups.push(
      client.from("prospects").select(prospectColumns).eq("business_id", businessId).eq("phone_e164", person.phone).limit(5),
    );
  }
  if (person.firstName && person.lastName) {
    prospectLookups.push(
      client
        .from("prospects")
        .select(prospectColumns)
        .eq("business_id", businessId)
        .ilike("first_name", escapeIlike(person.firstName))
        .ilike("last_name", escapeIlike(person.lastName))
        .limit(10),
    );
  }

  const [leadResults, prospectResults] = await Promise.all([
    Promise.all(lookups),
    Promise.all(prospectLookups),
  ]);

  const leads = new Map<string, IdentityLead>();
  for (const result of leadResults) {
    if (result.error) fail("lead candidate lookup", result.error);
    for (const row of (result.data ?? []) as {
      id: string;
      email: string | null;
      phone_normalized: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
      created_at: string;
    }[]) {
      leads.set(row.id, {
        id: row.id,
        email: row.email ? row.email.trim().toLowerCase() : null,
        phone: row.phone_normalized,
        firstName: row.first_name,
        lastName: row.last_name,
        companyName: row.company_name,
        createdAt: row.created_at,
      });
    }
  }

  const prospects = new Map<string, IdentityProspect>();
  for (const result of prospectResults) {
    if (result.error) fail("prospect candidate lookup", result.error);
    for (const row of (result.data ?? []) as {
      id: string;
      email: string | null;
      phone_e164: string | null;
      first_name: string | null;
      last_name: string | null;
      promoted_to_lead_id: string | null;
      created_at: string;
      company: { name: string | null } | { name: string | null }[] | null;
    }[]) {
      const company = Array.isArray(row.company) ? row.company[0] : row.company;
      prospects.set(row.id, {
        id: row.id,
        email: row.email ? row.email.trim().toLowerCase() : null,
        phone: row.phone_e164,
        firstName: row.first_name,
        lastName: row.last_name,
        companyName: company?.name ?? null,
        createdAt: row.created_at,
        promotedToLeadId: row.promoted_to_lead_id,
      });
    }
  }

  return { providerRecordLeadId, leads: [...leads.values()], prospects: [...prospects.values()] };
}

async function suppressionFacts(businessId: string, person: NormalisedIngest["person"]) {
  // A failed lookup throws (checkSuppression): "unknown" is never "not
  // suppressed", and the caller's job retries.
  const [email, sms, whatsapp] = await Promise.all([
    person.email ? checkSuppression(businessId, "EMAIL", { email: person.email }) : null,
    person.phone ? checkSuppression(businessId, "SMS", { phone: person.phone }) : null,
    person.phone ? checkSuppression(businessId, "WHATSAPP", { phone: person.phone }) : null,
  ]);
  return { email, sms, whatsapp };
}

/* --------------------------------------------------------------- writing */

const LEAD_PROCESS_PROVIDERS = new Set([
  "meta",
  "csv",
  "manual",
  "test",
  "webform",
  "google_ads",
  "tiktok_ads",
  "linkedin_ads",
  "api",
  "mcp",
  "meta_dm",
  "connector",
]);

function processProviderFor(type: IngestSourceType, provider: string): string {
  if (LEAD_PROCESS_PROVIDERS.has(provider)) return provider;
  switch (type) {
    case "CSV":
      return "csv";
    case "MANUAL":
      return "manual";
    case "WEB_FORM":
      return "webform";
    case "MCP":
      return "mcp";
    case "SOCIAL_DM":
      return "meta_dm";
    case "API":
      return "api";
    default:
      return "connector";
  }
}

function touchRow(
  businessId: string,
  leadId: string,
  input: ParsedIngestInput,
  normalised: NormalisedIngest,
  outcome: "CREATED" | "MERGED" | "SUPPRESSED" | "REVIEW",
  providerRecordId: string | null,
  leadSourceId: string | null,
) {
  const s = input.source;
  return {
    business_id: businessId,
    lead_id: leadId,
    occurred_at: normalised.submittedAt ?? new Date().toISOString(),
    source_type: s.type,
    provider: s.provider,
    provider_record_id: providerRecordId,
    lead_source_id: leadSourceId,
    page_id: s.pageId ?? null,
    page_name: s.pageName ?? null,
    form_id: s.formId ?? null,
    form_name: s.formName ?? null,
    campaign_id: s.campaignId ?? null,
    campaign_name: s.campaignName ?? null,
    adset_id: s.adsetId ?? null,
    adset_name: s.adsetName ?? null,
    ad_id: s.adId ?? null,
    ad_name: s.adName ?? null,
    utm_source: normalised.utm.source,
    utm_medium: normalised.utm.medium,
    utm_campaign: normalised.utm.campaign,
    utm_term: normalised.utm.term,
    utm_content: normalised.utm.content,
    gclid: s.gclid ?? null,
    fbclid: s.fbclid ?? null,
    referrer: s.referrer ?? null,
    landing_url: s.landingUrl ?? null,
    caller_type: s.caller.type,
    caller_id: s.caller.id ?? null,
    answers: input.answers ?? {},
    ingest_outcome: outcome,
  };
}

const PERMISSION_UPGRADABLE = new Set(["UNKNOWN", "IMPORTED", "FOUND_BY_US", "OTHER"]);

async function upsertPermission(
  client: SupabaseClient,
  businessId: string,
  leadId: string,
  input: ParsedIngestInput,
  person: NormalisedIngest["person"],
  relationship: RelationshipType,
  options: IngestOptions,
): Promise<void> {
  const whatsappScope = input.consent?.whatsapp === true ? ["WHATSAPP"] : [];
  const evidence = input.consent?.evidence ?? options.permission?.evidence ?? null;
  const consentGranted = input.consent?.marketing === true && Boolean(evidence);
  const consentStatus: ConsentStatus = consentGranted
    ? "GRANTED"
    : (options.permission?.consentStatus ?? "UNKNOWN");

  const { data: existing, error } = await client
    .from("contact_permissions")
    .select("id, relationship_type, consent_status, consent_scope")
    .eq("business_id", businessId)
    .eq("subject_type", "LEAD")
    .eq("subject_id", leadId)
    .maybeSingle();
  if (error) fail("permission lookup", error);

  if (!existing) {
    await recordPermission({
      businessId,
      subject: { type: "LEAD", id: leadId },
      relationshipType: relationship,
      relationshipDetail:
        options.permission?.detail ?? `Arrived via ${input.source.provider} (${input.source.type})`,
      consentStatus,
      consentEvidence: evidence,
      consentSource: options.permission?.source ?? `ingest:${input.source.provider}`,
      subscriberType: options.permission?.subscriberType,
      country: options.permission?.country ?? null,
      email: person.email,
      phone: person.phone,
      recordedBy: options.permission?.recordedBy ?? null,
      ...(whatsappScope.length ? { consentScope: whatsappScope } : {}),
    });
    return;
  }

  // An existing record is evidence someone captured; a later touch only adds
  // to it. A scope is unioned, UNKNOWN consent is upgraded by evidenced
  // consent, and a weak relationship is upgraded by "they contacted us" --
  // nothing is ever narrowed or downgraded here.
  const row = existing as {
    id: string;
    relationship_type: string;
    consent_status: string;
    consent_scope: unknown;
  };
  const scope = Array.isArray(row.consent_scope) ? row.consent_scope.map(String) : [];
  const patch: Record<string, unknown> = {};
  for (const channel of whatsappScope) {
    if (!scope.map((value) => value.toUpperCase()).includes(channel)) {
      patch.consent_scope = [...scope, channel];
    }
  }
  if (consentGranted && row.consent_status === "UNKNOWN") {
    patch.consent_status = "GRANTED";
    patch.consent_evidence = evidence;
    patch.consent_captured_at = new Date().toISOString();
  }
  if (relationship === "THEY_CONTACTED_US" && PERMISSION_UPGRADABLE.has(row.relationship_type)) {
    patch.relationship_type = relationship;
    patch.relationship_detail = `Contacted the business via ${input.source.provider} (${input.source.type})`;
  }
  if (Object.keys(patch).length === 0) return;

  assertWrite(
    await client.from("contact_permissions").update(patch).eq("id", row.id),
    "ingest: permission update",
    { businessId, leadId },
  );
}

/* ----------------------------------------------------------------- main */

export async function ingestLead(
  rawInput: IngestInput,
  options: IngestOptions = {},
): Promise<IngestResult> {
  /* 1. validate ------------------------------------------------------ */
  const parsed = ingestInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      outcome: "INVALID",
      leadId: null,
      touchId: null,
      matchedBy: null,
      reasons: parsed.error.issues.slice(0, 5).map((issue) => `invalid:${issue.path.join(".") || "input"}`),
    };
  }
  const input = parsed.data;
  const businessId = input.businessId;

  /* 2. normalise ----------------------------------------------------- */
  const normalised = normaliseIngest(input);
  const { person } = normalised;
  const reasons = [...normalised.reasons];

  const problem = validityProblem(person, input.source, {
    allowWithoutContactPoint: options.allowWithoutContactPoint,
  });
  if (problem) {
    return { outcome: "INVALID", leadId: null, touchId: null, matchedBy: null, reasons: [...reasons, problem] };
  }

  const client = db();
  const hash = requestHash(input, normalised);

  /* 3. idempotency --------------------------------------------------- */
  const key = idempotencyKeyFor({
    idempotencyKey: input.idempotencyKey,
    provider: input.source.provider,
    providerRecordId: input.source.providerRecordId,
  });
  if (key) {
    const { data: stored, error } = await client
      .from("ingest_requests")
      .select("outcome, lead_id, touch_id, matched_by, reasons, request_hash")
      .eq("business_id", businessId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) fail("idempotency lookup", error);
    if (stored) return replayOf(stored as StoredIngestRequest, hash);
  }

  /* 4. suppression --------------------------------------------------- */
  const facts = await suppressionFacts(businessId, person);
  const verdict = suppressionVerdict(person, facts);
  reasons.push(...verdict.reasons);
  if (options.onSuppressed === "REFUSE" && verdict.reasons.length > 0) {
    // Nothing is stored: not the lead, not a touch, not an idempotency row.
    return { outcome: "REJECTED", leadId: null, touchId: null, matchedBy: null, reasons: [...reasons, "suppressed_refused"] };
  }

  /* 5. identity ------------------------------------------------------ */
  const externalId = options.externalId ?? null;
  let identity: IdentityDecision = resolveIdentity(
    person,
    await loadCandidates(client, businessId, input, person, externalId),
  );

  const relationship = (input.relationship ?? defaultRelationshipFor(input.source.type)) as RelationshipType;
  // A touch without a provider record still dedupes on the caller's key, so
  // two concurrent requests with one Idempotency-Key produce one touch.
  const touchRecordId =
    input.source.providerRecordId ?? (input.idempotencyKey ? `idem:${input.idempotencyKey}` : null);

  let plan = writePlan(identity, verdict.fullySuppressed);
  let leadId = "";
  let outcome: "CREATED" | "MERGED" | "SUPPRESSED" | "REVIEW" = "CREATED";
  let mergeRule: "EMAIL" | "PHONE" | "PROSPECT_PROMOTION" | null = null;
  let mergeConfidence = 0;
  let conflictLeadId: string | null = null;
  let inserted = false;
  let mergeBefore: Record<string, unknown> = {};
  let mergeAfter: Record<string, unknown> = {};

  /* 6. write ---------------------------------------------------------- */
  for (let attempt = 0; ; attempt += 1) {
    if (plan.action === "DUPLICATE") {
      const result: IngestResult = {
        outcome: "DUPLICATE",
        leadId: plan.leadId,
        touchId: null,
        matchedBy: "PROVIDER_RECORD",
        reasons: [...reasons, "same_provider_record"],
        originalOutcome: undefined,
      };
      await recordRequest(client, businessId, key, input, hash, "DUPLICATE", result);
      return result;
    }

    if (plan.action === "INSERT") {
      const review = plan.outcome === "REVIEW";

      // The plan's lead cap (billing/lead-cap.ts). A lead someone is CREATING
      // (Add lead, a CSV import with follow-up on, the API, MCP) that would be
      // followed up is refused at the cap, before anything is written. An
      // enquiry that ARRIVES is never refused: lead.process holds it instead.
      if (attempt === 0 && leadCapPolicyFor(input.source.type) === "REFUSE_AT_CAP") {
        const willBeWorked =
          options.process !== false &&
          processModeFor({
            outcome: plan.outcome,
            sourceType: input.source.type,
            requested: options.process?.mode,
          }) === "FULL";
        if (willBeWorked) {
          const capacity = await leadCapacity(businessId);
          const gate = leadIntakeGate({ sourceType: input.source.type, willBeWorked, ...capacity });
          if (!gate.allowed) {
            // Nothing stored: not the lead, not a touch, not an idempotency
            // row (a retry once there is room must be able to succeed).
            return { outcome: "REJECTED", leadId: null, touchId: null, matchedBy: null, reasons: [...reasons, gate.reason] };
          }
        }
      }
      const row: Record<string, unknown> = {
        business_id: businessId,
        first_name: person.firstName,
        last_name: person.lastName,
        email: person.email,
        phone: person.phone,
        phone_normalized: person.phone,
        company_name: person.companyName,
        postcode: person.postcode,
        service_id: input.serviceId ?? null,
        status: "NEW",
        intake_method: intakeMethodFor(input.source.type, input.source.provider),
        created_via: createdViaFor(input.source.type),
        relationship_type: relationship,
        source_submitted_at: normalised.submittedAt,
        external_id: externalId,
        ...(options.insertExtras ?? {}),
      };
      if (review) {
        // The shared number stays on the record (`phone`) but is not made this
        // lead's messaging key: it already belongs to another lead, and which
        // of them it really is, is the person's call.
        row.phone_normalized = null;
        row.needs_attention = true;
        row.attention_reason = "identity_review";
      }

      const { data, error } = await client.from("leads").insert(row).select("id").single();
      if (!error && data) {
        leadId = (data as { id: string }).id;
        inserted = true;
        outcome = plan.outcome;
        conflictLeadId = plan.conflictLeadId;
        break;
      }

      const conflict = insertConflictKind(error);
      if (conflict === "EXTERNAL_ID") {
        const { data: raced, error: racedError } = await client
          .from("leads")
          .select("id")
          .eq("business_id", businessId)
          .eq("external_id", externalId)
          .maybeSingle();
        if (racedError) fail("external id race lookup", racedError);
        if (raced) {
          plan = { action: "DUPLICATE", leadId: (raced as { id: string }).id };
          continue;
        }
      }
      if (conflict === "IDENTITY" && attempt === 0) {
        // Another ingest created this person between our lookup and insert:
        // re-resolve, which now finds them, and merge (design §2).
        identity = resolveIdentity(person, await loadCandidates(client, businessId, input, person, externalId));
        plan = writePlan(identity, verdict.fullySuppressed);
        reasons.push("insert_race_retried_as_merge");
        continue;
      }
      fail("lead insert", error ?? { message: "no row returned" });
    }

    // MERGE: fill blanks only, never provenance.
    const { data: existing, error: existingError } = await client
      .from("leads")
      .select("id, first_name, last_name, email, phone, phone_normalized, company_name, postcode, service_id, source_submitted_at")
      .eq("business_id", businessId)
      .eq("id", plan.leadId)
      .maybeSingle();
    if (existingError) fail("merge read", existingError);
    if (!existing) fail("merge read", { message: `lead ${plan.leadId} vanished` });

    const { patch, before } = mergePatch(existing as Record<string, unknown>, {
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email,
      phone: person.phone,
      phone_normalized: person.phone,
      company_name: person.companyName,
      postcode: person.postcode,
      service_id: input.serviceId ?? null,
      source_submitted_at: normalised.submittedAt,
    });

    if (Object.keys(patch).length > 0) {
      const first = await client.from("leads").update(patch).eq("id", plan.leadId).eq("business_id", businessId);
      if (first.error && insertConflictKind(first.error) === "IDENTITY") {
        // The contact point being filled in belongs to a different live lead.
        // Keep the rest of the fill-in; the touch still records the value.
        for (const field of ["email", "phone", "phone_normalized"] as const) {
          delete patch[field];
          delete before[field];
        }
        reasons.push("merge_contact_conflict_skipped");
        if (Object.keys(patch).length > 0) {
          assertWrite(
            await client.from("leads").update(patch).eq("id", plan.leadId).eq("business_id", businessId),
            "ingest: merge update",
            { businessId, leadId: plan.leadId },
          );
        }
      } else {
        assertWrite(first, "ingest: merge update", { businessId, leadId: plan.leadId });
      }
    }
    leadId = plan.leadId;
    outcome = plan.outcome;
    mergeRule = plan.rule;
    mergeConfidence = plan.confidence;
    mergeBefore = before as Record<string, unknown>;
    mergeAfter = patch as Record<string, unknown>;
    break;
  }

  /* email origin (§26) ------------------------------------------------- */
  // Only when this ingest wrote the address: a new lead, or a merge that
  // filled a blank email. Never overwrites the origin of an address it did
  // not write. Schema-lag tolerant (0131).
  if (person.email && (inserted || "email" in mergeAfter)) {
    const promotedFrom = (options.insertExtras as Record<string, unknown> | undefined)?.promoted_from_prospect_id;
    const fromProspect =
      typeof promotedFrom === "string" ? await prospectEmailOrigin(businessId, promotedFrom) : null;
    await recordEmailOrigin({
      table: "leads",
      businessId,
      id: leadId,
      origin: isEmailOrigin(fromProspect) ? fromProspect : originForIngestSource(input.source.type),
    });
  }

  /* touch -------------------------------------------------------------- */
  const { data: touch, error: touchError } = await client
    .from("lead_touches")
    .insert(touchRow(businessId, leadId, input, normalised, outcome, touchRecordId, options.leadSourceId ?? null))
    .select("id")
    .single();

  if (touchError) {
    if (touchError.code === "23505" && touchRecordId) {
      // The same submission, delivered twice at once: the other delivery's
      // touch stands and this one is a duplicate of it.
      const result: IngestResult = {
        outcome: "DUPLICATE",
        leadId,
        touchId: null,
        matchedBy: "PROVIDER_RECORD",
        reasons: [...reasons, "same_provider_record"],
      };
      await recordRequest(client, businessId, key, input, hash, "DUPLICATE", result);
      return result;
    }
    fail("touch insert", touchError);
  }
  const touchId = (touch as { id: string }).id;

  /* merge record: never silent ----------------------------------------- */
  if (mergeRule) {
    assertWrite(
      await client.from("merge_events").insert({
        business_id: businessId,
        lead_id: leadId,
        touch_id: touchId,
        rule: mergeRule,
        confidence: mergeConfidence,
        before: mergeBefore,
        after: mergeAfter,
        actor_type: input.source.caller.type,
        actor_id: input.source.caller.id ?? null,
      }),
      "ingest: merge event",
      { businessId, leadId },
    );
  }

  /* review / weak candidates / prospect link --------------------------- */
  if (conflictLeadId) {
    assertWrite(
      await client.from("merge_candidates").insert({
        business_id: businessId,
        lead_a_id: conflictLeadId,
        lead_b_id: leadId,
        reason: "PHONE_CONFLICT",
        evidence: { phone: person.phone, touch_id: touchId },
      }),
      "ingest: review candidate",
      { businessId, leadId },
      { ignoreCodes: ["23505"] },
    );
  }
  if (identity.kind === "NEW" && inserted) {
    for (const weak of identity.weak) {
      logWriteError(
        await client.from("merge_candidates").insert({
          business_id: businessId,
          lead_a_id: weak.kind === "LEAD" ? weak.id : leadId,
          lead_b_id: weak.kind === "LEAD" ? leadId : null,
          prospect_id: weak.kind === "PROSPECT" ? weak.id : null,
          reason: weak.kind === "LEAD" ? "WEAK_NAME_COMPANY" : "PROSPECT_MATCH",
          evidence: { touch_id: touchId, rule: "same_name_and_company" },
        }),
        "ingest: weak merge candidate",
        { businessId, leadId },
      );
    }
    if (identity.linkProspectId) {
      logWriteError(
        await client
          .from("prospects")
          .update({ promoted_to_lead_id: leadId, promoted_at: new Date().toISOString() })
          .eq("id", identity.linkProspectId)
          .eq("business_id", businessId)
          .is("promoted_to_lead_id", null),
        "ingest: link prospect",
        { businessId, leadId },
      );
      reasons.push("linked_prospect");
    }
  }

  /* permission --------------------------------------------------------- */
  await upsertPermission(client, businessId, leadId, input, person, relationship, options);

  /* 7. lead.process ----------------------------------------------------- */
  if (options.process !== false) {
    const mode = processModeFor({
      outcome,
      sourceType: input.source.type,
      requested: options.process?.mode,
    });
    const s = input.source;
    await enqueue(
      "lead.process",
      {
        leadId,
        touchId,
        newLead: inserted,
        mode,
        ...(options.process?.serviceName ? { serviceName: options.process.serviceName } : {}),
        source: {
          provider: processProviderFor(s.type, s.provider),
          pageId: s.pageId,
          pageName: s.pageName,
          formId: s.formId,
          formName: s.formName,
          campaignId: s.campaignId,
          campaignName: s.campaignName,
          adsetId: s.adsetId,
          adsetName: s.adsetName,
          adId: s.adId,
          adName: s.adName,
          sourceName: options.process?.sourceName,
        },
      },
      {
        businessId,
        priority: options.process?.priority ?? (mode === "FULL" ? 10 : 50),
        idempotencyKey: `lead.process:touch:${touchId}`,
      },
    );
  }

  /* 8. event ------------------------------------------------------------ */
  const event = domainEventFor({ outcome, inserted, leadId, touchId });
  await emitDomainEvent({
    businessId,
    type: event.type,
    subject: { type: "lead", id: leadId },
    dedupeKey: event.dedupeKey,
    occurredAt: normalised.submittedAt,
    payload: {
      lead_id: leadId,
      touch_id: touchId,
      outcome,
      source_type: input.source.type,
      source: input.source.provider,
      first_name: person.firstName,
      last_name: person.lastName,
      email: person.email,
      phone: person.phone,
      postcode: person.postcode,
      status: "NEW",
    },
  });

  /* 9. return ------------------------------------------------------------ */
  const matchedBy: IngestResult["matchedBy"] =
    mergeRule === "PROSPECT_PROMOTION" ? "PROSPECT" : mergeRule;

  const result: IngestResult = { outcome, leadId, touchId, matchedBy, reasons };
  await recordRequest(client, businessId, key, input, hash, outcome, result);
  return result;
}

async function recordRequest(
  client: SupabaseClient,
  businessId: string,
  key: string | null,
  input: ParsedIngestInput,
  hash: string,
  outcome: "CREATED" | "MERGED" | "DUPLICATE" | "SUPPRESSED" | "REVIEW",
  result: IngestResult,
): Promise<void> {
  if (!key) return;
  // 23505: a concurrent request with the same key finished first. Its row is
  // the first outcome, which is what a repeat must see.
  assertWrite(
    await client.from("ingest_requests").insert({
      business_id: businessId,
      idempotency_key: key,
      source_type: input.source.type,
      provider: input.source.provider,
      request_hash: hash,
      outcome,
      lead_id: result.leadId,
      touch_id: result.touchId,
      matched_by: result.matchedBy,
      reasons: result.reasons,
    }),
    "ingest: idempotency record",
    { businessId },
    { ignoreCodes: ["23505"] },
  );
}
