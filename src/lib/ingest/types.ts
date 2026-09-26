/**
 * The one intake contract (design 03 §1).
 *
 * Every inbound source -- ad-platform pollers, the Google Ads webhook, the
 * Add Lead wizard, CSV import, the public API, MCP and Meta DMs -- describes
 * what arrived in this shape and hands it to `ingestLead()`
 * (`./service.ts`). The outcome is a deterministic contract, never prose.
 *
 * Pure: zod and types only, no `server-only`, so tests import it directly.
 */

import { z } from "zod";

export const INGEST_SOURCE_TYPES = [
  "AD_FORM",
  "WEB_FORM",
  "CSV",
  "MANUAL",
  "API",
  "MCP",
  "CONNECTOR",
  "SOCIAL_DM",
  "CRM",
] as const;
export type IngestSourceType = (typeof INGEST_SOURCE_TYPES)[number];

export const INGEST_CALLER_TYPES = [
  "SYSTEM",
  "USER",
  "API_KEY",
  "MCP_CLIENT",
  "CONNECTOR",
] as const;
export type IngestCallerType = (typeof INGEST_CALLER_TYPES)[number];

/**
 * CREATED    a new lead was written.
 * MERGED     an existing lead matched on strong evidence; blanks were filled.
 * DUPLICATE  the same submission (or idempotency key) was already ingested;
 *            the first outcome is returned unchanged.
 * SUPPRESSED recorded, but every supplied destination is suppressed: it will
 *            not be contacted.
 * INVALID    nothing usable arrived (no valid email or phone).
 * REVIEW     recorded as a new lead, but identity is conflicting (same phone,
 *            different email) and a person must decide.
 * REJECTED   nothing is stored (a refused suppressed contact, or a caller
 *            that asked for suppressed contacts to be refused).
 */
export const INGEST_OUTCOMES = [
  "CREATED",
  "MERGED",
  "DUPLICATE",
  "SUPPRESSED",
  "INVALID",
  "REVIEW",
  "REJECTED",
] as const;
export type IngestOutcomeKind = (typeof INGEST_OUTCOMES)[number];

/** The relationship vocabulary of `contact_permissions.relationship_type`. */
export const INGEST_RELATIONSHIPS = [
  "THEY_CONTACTED_US",
  "EXISTING_CUSTOMER",
  "REFERRAL",
  "REQUESTED_INFORMATION",
  "EXPLICIT_MARKETING_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "ACCEPTED_SOCIAL_CONNECTION",
  "FOUND_BY_US",
  "IMPORTED",
  "OTHER",
  "UNKNOWN",
] as const;
export type IngestRelationship = (typeof INGEST_RELATIONSHIPS)[number];

const text = (max: number) => z.string().trim().max(max).optional();
const id = text(300);
const name = text(300);

export const ingestSourceSchema = z.object({
  type: z.enum(INGEST_SOURCE_TYPES),
  // meta | google_ads | linkedin_ads | tiktok_ads | zapier | api | mcp | ...
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_:.-]+$/, "provider must be a lower-case slug"),
  providerRecordId: z.string().trim().min(1).max(300).optional(),
  pageId: id,
  pageName: name,
  formId: id,
  formName: name,
  campaignId: id,
  campaignName: name,
  adsetId: id,
  adsetName: name,
  adId: id,
  adName: name,
  utm: z
    .object({
      source: text(200),
      medium: text(200),
      campaign: text(200),
      term: text(200),
      content: text(200),
    })
    .optional(),
  gclid: text(300),
  fbclid: text(300),
  referrer: text(2000),
  landingUrl: text(2000),
  /** The provider's own submission time. Speed to lead starts here. */
  submittedAt: z.union([z.string().trim().max(60), z.number().finite()]).optional(),
  caller: z.object({
    type: z.enum(INGEST_CALLER_TYPES),
    id: z.string().trim().max(200).optional(),
  }),
});

export const ingestPersonSchema = z.object({
  firstName: text(120),
  lastName: text(120),
  email: text(320),
  phone: text(60),
  companyName: text(200),
  roleTitle: text(200),
  postcode: text(20),
});

export const ingestInputSchema = z.object({
  businessId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  source: ingestSourceSchema,
  person: ingestPersonSchema,
  answers: z
    .record(z.string().trim().min(1).max(200), z.string().max(2000))
    .refine((value) => Object.keys(value).length <= 50, "At most 50 answers")
    .optional(),
  consent: z
    .object({
      marketing: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      evidence: z.string().trim().max(2000).optional(),
    })
    .optional(),
  relationship: z.enum(INGEST_RELATIONSHIPS).optional(),
  serviceId: z.uuid().optional(),
});

export type IngestInput = z.input<typeof ingestInputSchema>;
export type ParsedIngestInput = z.output<typeof ingestInputSchema>;

/** What a caller gets back. Deterministic: the same input gives the same kind. */
export type IngestResult = {
  outcome: IngestOutcomeKind;
  leadId: string | null;
  touchId: string | null;
  /** Which identity rule matched, when one did. */
  matchedBy: "PROVIDER_RECORD" | "IDEMPOTENCY_KEY" | "EMAIL" | "PHONE" | "PROSPECT" | null;
  /** Machine codes, never prose. */
  reasons: string[];
  /** For DUPLICATE: the outcome the first request produced. */
  originalOutcome?: IngestOutcomeKind;
};

/**
 * The default relationship a source establishes when the caller states none.
 * A person who filled in a form, or who messaged the business, did contact it
 * -- that is a fact. Every other route must say; UNKNOWN is the honest default
 * and the policy engine treats it as no basis.
 */
export function defaultRelationshipFor(type: IngestSourceType): IngestRelationship {
  return type === "AD_FORM" || type === "WEB_FORM" || type === "SOCIAL_DM"
    ? "THEY_CONTACTED_US"
    : "UNKNOWN";
}

/** `leads.intake_method` for a new lead (vocabulary: 0038 check). */
export function intakeMethodFor(type: IngestSourceType, provider: string): string {
  switch (type) {
    case "AD_FORM":
    case "SOCIAL_DM":
      return provider.startsWith("meta") ? "META" : "OTHER";
    case "WEB_FORM":
      return "WEBFORM";
    case "CSV":
      return "IMPORT";
    case "MANUAL":
      return "MANUAL";
    case "CONNECTOR":
      return provider === "pipedrive" ? "PIPEDRIVE" : "API";
    case "API":
    case "MCP":
    case "CRM":
      return "API";
  }
}

/** `leads.created_via` for a new lead (vocabulary: 0040 check). */
export function createdViaFor(type: IngestSourceType): string {
  switch (type) {
    case "AD_FORM":
    case "WEB_FORM":
    case "SOCIAL_DM":
      return "INBOUND";
    case "CSV":
      return "IMPORT";
    case "MANUAL":
      return "MANUAL_WIZARD";
    case "API":
    case "MCP":
    case "CONNECTOR":
    case "CRM":
      return "API";
  }
}
