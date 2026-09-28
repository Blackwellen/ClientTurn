/**
 * The plan's lead cap ("100 / 400 / 1,000 new leads a month") on every way a
 * lead can be created (gap audit 15 top-10 #10). Pure; the ingest service,
 * prospect promotion, the resume-follow-up operation and
 * `tests/entitlement-holes.test.ts` share it.
 *
 * ## What the cap counts
 *
 * A lead counts once, when ClientTurn starts WORKING it: the first time it is
 * followed up (the `lead_processed` meter, keyed `lead:<id>`, written by
 * lead.process or by `meterLeadIfNeeded`). A lead stored as a record only (a
 * reactivation list, an import the owner did not ask to message, a merged
 * repeat enquiry, a suppressed or review lead) is not counted until someone
 * starts following it up.
 *
 * ## What happens at the cap, by path
 *
 *   * An enquiry that ARRIVES (ad forms, web forms, connectors, social DMs,
 *     CRM pulls): always stored, never lost. lead.process then holds it: no
 *     follow-up, a flag on the lead and one owner notice a day (existing
 *     behaviour, `lead-process.ts`).
 *   * A lead someone CREATES (Add lead, CSV import with follow-up on, the
 *     public API, MCP `create_lead`): refused up front with "plan_limit" and
 *     nothing stored, so the caller learns now rather than finding a held
 *     lead later. A read-only (ended) or paused-for-payment workspace refuses
 *     the same way.
 *   * Promoting a Find Leads prospect, and resuming follow-up on a lead that
 *     was never metered: refused at the cap, otherwise metered at once.
 *   * Voice inbound creates no lead (an unknown caller gets the message or
 *     transfer path, `voice/inbound.ts`), so it has no cap to check.
 */

import type { IngestSourceType } from "../ingest/types.ts";

/** Sources where someone is creating the lead (refused at the cap). */
export const CREATED_LEAD_SOURCES: readonly IngestSourceType[] = ["MANUAL", "CSV", "API", "MCP"];

/** Sources where an enquiry arrives by itself (stored, then held at the cap). */
export const ARRIVING_LEAD_SOURCES: readonly IngestSourceType[] = ["AD_FORM", "WEB_FORM", "CONNECTOR", "SOCIAL_DM", "CRM"];

export type LeadCapPolicy = "REFUSE_AT_CAP" | "STORE_AND_HOLD";

export function leadCapPolicyFor(sourceType: IngestSourceType): LeadCapPolicy {
  return CREATED_LEAD_SOURCES.includes(sourceType) ? "REFUSE_AT_CAP" : "STORE_AND_HOLD";
}

export type LeadCapReason = "plan_limit" | "subscription_inactive";

export type LeadCapDecision = { allowed: true } | { allowed: false; reason: LeadCapReason };

/**
 * Whether a new lead may be created now.
 *
 * @param willBeWorked the lead would be followed up (process mode FULL), so
 *        it counts against the cap. A record-only lead never does.
 */
export function leadIntakeGate(input: {
  sourceType: IngestSourceType;
  willBeWorked: boolean;
  active: boolean;
  used: number;
  limit: number;
}): LeadCapDecision {
  if (leadCapPolicyFor(input.sourceType) === "STORE_AND_HOLD") return { allowed: true };
  if (!input.willBeWorked) return { allowed: true };
  if (!input.active) return { allowed: false, reason: "subscription_inactive" };
  if (input.used >= input.limit) return { allowed: false, reason: "plan_limit" };
  return { allowed: true };
}

/** Promotion or resume: starts work on an existing record. */
export function startWorkGate(input: { alreadyMetered: boolean; active: boolean; used: number; limit: number }): LeadCapDecision {
  if (input.alreadyMetered) return { allowed: true };
  if (!input.active) return { allowed: false, reason: "subscription_inactive" };
  if (input.used >= input.limit) return { allowed: false, reason: "plan_limit" };
  return { allowed: true };
}

export function leadCapMessage(reason: LeadCapReason, limit: number): string {
  return reason === "plan_limit"
    ? `This workspace has reached its limit of ${limit.toLocaleString("en-GB")} new leads for this billing period. Leads that arrive by themselves are still kept; upgrade, or wait for the next period, to add more.`
    : "This workspace's subscription is not active, so new leads cannot be added. Update billing to carry on.";
}

/** The ingest reason code a refusal is reported with. */
export const PLAN_LIMIT_REASON = "plan_limit";
export const SUBSCRIPTION_INACTIVE_REASON = "subscription_inactive";
