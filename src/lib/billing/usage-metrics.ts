/**
 * The usage ledger's vocabulary (V4 §18).
 *
 * Pure — no `server-only`, no Supabase — so the list can be asserted in tests
 * and rendered in Billing & Usage without a database, the same way
 * `policy/types.ts` keeps the policy vocabulary shareable.
 *
 * This file exists because the metric union in `audit.ts` was allowed to drift
 * from the database. The CHECK constraint on `usage_events` was widened twice
 * (0018, 0038) and the TypeScript type was not, so callers needing any of the
 * newer metrics stopped using the typed writer and hand-rolled their own insert
 * instead. There is now one list, and `recordUsage` accepts all of it, so the
 * cheapest path is also the correct one.
 *
 * **Adding a metric means editing this list and a migration, together.** The
 * constraint in `0062_usage_ledger.sql` is the mirror of `USAGE_METRICS`.
 */

export const USAGE_METRICS = [
  /* ------------------------------------------------------- lead lifecycle */
  "lead_processed",
  "prospect_promoted",

  /* ----------------------------------------------------------- messaging */
  "message_sent",
  "message_received",
  "campaign_message",
  "email_sent",
  "cold_email_sent",
  "reactivation_contact",
  "social_touch",
  "sms_outbound_segment",
  "sms_inbound_segment",
  "whatsapp_message",

  /* ------------------------------------------------------------------ AI */
  "ai_call",
  "ai_mini_input_token",
  "ai_mini_cached_token",
  "ai_mini_output_token",
  "ai_nano_input_token",
  "ai_nano_cached_token",
  "ai_nano_output_token",

  /* --------------------------------------------- sourcing and enrichment */
  "search_run",
  "discovery_lookup",
  "verified_prospect",
  "intent_monitor_run",
  /** Historical, undifferentiated. New writes use the three specific kinds. */
  "enrichment_unit",
  "enrichment_email",
  "enrichment_phone",
  "enrichment_company",
  "verification_unit",

  /* ------------------------------------------------------------- runtime */
  "agent_run",
  "mcp_call",
  "integration_api_call",

  /* --------------------------------------------------------------- seats */
  "active_user",
] as const;

export type UsageMetric = (typeof USAGE_METRICS)[number];

/**
 * What one unit of `quantity` counts. Recorded on the row so a line on an
 * invoice can be read without knowing the metric's history: "1,240" means
 * nothing, "1,240 tokens" means something.
 */
export type UsageUnit =
  | "record"
  | "message"
  | "segment"
  | "token"
  | "call"
  | "run"
  | "lookup"
  | "seat";

const UNITS: Record<UsageMetric, UsageUnit> = {
  lead_processed: "record",
  prospect_promoted: "record",
  verified_prospect: "record",

  message_sent: "message",
  message_received: "message",
  campaign_message: "message",
  email_sent: "message",
  cold_email_sent: "message",
  reactivation_contact: "message",
  social_touch: "message",
  whatsapp_message: "message",
  sms_outbound_segment: "segment",
  sms_inbound_segment: "segment",

  ai_call: "call",
  ai_mini_input_token: "token",
  ai_mini_cached_token: "token",
  ai_mini_output_token: "token",
  ai_nano_input_token: "token",
  ai_nano_cached_token: "token",
  ai_nano_output_token: "token",

  search_run: "run",
  intent_monitor_run: "run",
  agent_run: "run",
  discovery_lookup: "lookup",
  enrichment_unit: "lookup",
  enrichment_email: "lookup",
  enrichment_phone: "lookup",
  enrichment_company: "lookup",
  verification_unit: "lookup",

  mcp_call: "call",
  integration_api_call: "call",

  active_user: "seat",
};

export function unitFor(metric: UsageMetric): UsageUnit {
  return UNITS[metric];
}

/**
 * The product surface a charge is attributed to. Separate from the metric
 * because the same metric arrives from several places — an `ai_call` made by
 * Copilot and one made by an autonomous agent bill the same allowance but are
 * not the same line in a usage breakdown, and a workspace cannot act on
 * "you used 9.1M tokens" without knowing which of these spent them.
 */
export const USAGE_FEATURES = [
  "copilot",
  "agents",
  "follow_up",
  "outreach",
  "reactivation",
  "find_leads",
  "enrichment",
  "qualification",
  "inbox",
  "mcp",
  "integrations",
  "platform",
] as const;

export type UsageFeature = (typeof USAGE_FEATURES)[number];

const METRIC_SET = new Set<string>(USAGE_METRICS);

export function isUsageMetric(value: string): value is UsageMetric {
  return METRIC_SET.has(value);
}
