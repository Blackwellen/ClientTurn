/**
 * Where personal data about a lead or prospect lives, and what each data-rights
 * act does to it (Revenue Engine Phase 6, brief §§15, 83-87).
 *
 * Pure -- no `server-only`, no Supabase -- so the rule list can be asserted in
 * tests against a scan of the migrations. `tests/data-rights.test.ts` fails when
 * a table that links to a person (a `lead_id`, `*_lead_id`, `prospect_id`,
 * `*_prospect_id`, `subject_id` or `conversation_id` column) is added without a
 * rule here, and when a rule here says a table is redacted or removed but the
 * SQL executor (`data_rights_scrub` in migration 0124) never touches it.
 *
 * The executor itself is SQL, in one transaction, because an erasure touches
 * ~50 tables and half an erasure is worse than none: the person is partly
 * gone and nothing says which half. This file is the declaration the SQL is
 * checked against, and the vocabulary the summary wording is built from.
 */

/** What anonymising does to a table's rows about the person. */
export type AnonymiseTreatment =
  /** Personal columns replaced with null or "[removed]"; the row stays. */
  | "REDACT"
  /** Rows deleted. */
  | "REMOVE"
  /** Scheduled work for the person stopped; the row stays as history. */
  | "STOP"
  /** Plaintext destination replaced by a salted hash (decision Q5). */
  | "HASH"
  /** Untouched: holds ids, amounts, outcomes and timestamps only. */
  | "RETAIN";

/** What deleting does, after anonymising. */
export type DeleteTreatment =
  /** Rows go with the lead or prospect (FK cascade or explicit delete). */
  | "REMOVE"
  /** Kept, pseudonymous: the id no longer resolves to anybody. */
  | "RETAIN";

export type PersonalDataRule = {
  table: string;
  /** How a row is tied to the person. */
  link: string;
  anonymise: AnonymiseTreatment;
  delete: DeleteTreatment;
  /** What the table holds, as a person would describe it. */
  label: string;
  /** Required whenever something stays: why it may. */
  retainedBecause?: string;
};

export const PERSONAL_DATA_RULES: readonly PersonalDataRule[] = [
  /* ------------------------------------------------------------ the person */
  {
    table: "leads",
    link: "id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "name, email, phone, postcode, company and notes on the lead",
  },
  {
    table: "prospects",
    link: "promoted_to_lead_id / leads.promoted_from_prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "the sourced prospect record (name, role, email, phone, social profile)",
  },
  {
    table: "suppression_entries",
    link: "the person's email, phone or social thread id",
    anonymise: "HASH",
    delete: "RETAIN",
    label: "do-not-contact entries",
    retainedBecause:
      "Suppression must outlive erasure, or the person could be contacted again. Kept as a salted hash, never as a readable address.",
  },

  /* ---------------------------------------------------------- conversation */
  {
    table: "conversations",
    link: "lead_id / prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "conversation threads (names, handles, subjects)",
  },
  {
    table: "messages",
    link: "lead_id / prospect_id / conversation_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "message text, subjects and attachments",
  },
  {
    table: "conversation_summaries",
    link: "conversation_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "AI conversation summaries",
  },
  {
    table: "conversation_agent_runs",
    link: "lead_id / conversation_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "AI assistant decision details",
    retainedBecause:
      "The run's cost, tokens and outcome are billing records; the decision text is removed.",
  },
  {
    table: "conversation_agent_extractions",
    link: "lead_id / agent run",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "facts the AI assistant extracted",
  },
  {
    table: "agent_handoffs",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "hand-over summaries",
  },
  {
    table: "ai_runs",
    link: "lead_id / conversation_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "AI results",
    retainedBecause: "AI usage is billed from these rows; only the result text is removed.",
  },

  /* ------------------------------------------------------- qualification */
  {
    table: "qualification_answers",
    link: "lead_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "qualification answers",
  },
  {
    table: "lead_notes",
    link: "lead_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "team notes",
  },
  {
    table: "bookings",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "booking locations, notes and links",
  },
  {
    table: "lead_scores",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "score explanations",
  },
  {
    table: "lead_tags",
    link: "lead_id",
    anonymise: "RETAIN",
    delete: "REMOVE",
    label: "rule-based tags",
    retainedBecause: "Deterministic labels with no personal values; they feed aggregate reporting.",
  },
  {
    table: "opportunities",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "opportunity names, deal notes and opportunity memory",
    retainedBecause:
      "Revenue and stage are the workspace's own sales record; the name, notes and memory (0131, cleared by trigger) are removed.",
  },

  /*
   * Qualification intelligence (0134). Removed on anonymise by the
   * leads_qualification_intel_clear_on_anonymise trigger, which fires when
   * data_rights_scrub sets leads.anonymised_at (same transaction); new rows
   * for an anonymised lead are refused by a before-insert trigger. Removed on
   * delete by the lead_id cascade.
   */
  {
    table: "lead_intent_signals",
    link: "lead_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "buying signals and the words quoted as their evidence",
  },
  {
    table: "lead_qualification_facts",
    link: "lead_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "what the person told us or we inferred, per qualification topic",
  },
  {
    table: "lead_assessments",
    link: "lead_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "intent and qualification assessments, and suggested next steps",
  },

  {
    table: "lead_assignments",
    link: "lead_id",
    anonymise: "RETAIN",
    delete: "REMOVE",
    label: "assignment history",
    retainedBecause: "Which team member held the lead, and when. No personal data about the lead.",
  },

  /* ----------------------------------------------------------- automation */
  {
    table: "automation_runs",
    link: "lead_id",
    anonymise: "STOP",
    delete: "REMOVE",
    label: "follow-up sequences",
  },
  {
    table: "automation_events",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "follow-up event details",
    retainedBecause: "Event types and times feed follow-up reporting; the payloads are removed.",
  },
  {
    table: "campaign_contacts",
    link: "lead_id",
    anonymise: "STOP",
    delete: "REMOVE",
    label: "reactivation campaign places",
  },
  {
    table: "outreach_recipient_runs",
    link: "prospect_id",
    anonymise: "STOP",
    delete: "REMOVE",
    label: "cold outreach sequences",
  },
  {
    table: "crm_push_records",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "CRM sync errors",
  },
  {
    table: "ai_budget_decisions",
    link: "lead_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "AI budget decisions",
    retainedBecause: "Append-only spend-control log: task, stage and amounts, no personal values.",
  },

  /* ---------------------------------------------------- intake/provenance */
  {
    table: "lead_touches",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "form answers, referrer and click ids on each arrival",
  },
  {
    table: "merge_events",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "merge before/after snapshots",
  },
  {
    table: "merge_candidates",
    link: "lead_a_id / lead_b_id / prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "duplicate-match evidence",
  },
  {
    table: "ingest_requests",
    link: "lead_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "intake fingerprints",
    retainedBecause: "Idempotency ledger: outcome and key only once the input fingerprint is removed.",
  },
  {
    table: "lead_import_rows",
    link: "created_lead_id / duplicate_of_lead_id / *_prospect_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "CSV import rows",
    retainedBecause:
      "The row stays as a line in its import's totals; its values were removed when the person was anonymised.",
  },
  {
    table: "contact_permissions",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "recorded contact permissions (addresses and consent wording)",
  },
  {
    table: "contactability_results",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "contactability decision evidence",
  },
  {
    table: "compliance_decisions",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "compliance review notes",
    retainedBecause:
      "The decision itself is accountability evidence (UK GDPR Art 5(2)); its rationale text and evidence are removed.",
  },
  {
    table: "lead_source_evidence",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "source evidence (how the details were obtained)",
  },
  {
    table: "privacy_notice_events",
    link: "subject_type + subject_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "privacy notice delivery records",
    retainedBecause: "Proof that the Article 14 notice was given: notice version and time, no personal values.",
  },
  {
    table: "intent_events",
    link: "lead_id / prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "buying-signal evidence",
  },

  /* ------------------------------------------------------------ prospects */
  {
    table: "prospect_data_sources",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "sourced field values and source links",
  },
  {
    table: "prospect_enrichments",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "enrichment results",
  },
  {
    table: "prospect_verifications",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "verification details",
  },
  {
    table: "prospect_scores",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "prospect score explanations",
  },
  {
    table: "prospect_intent_matches",
    link: "prospect_id",
    anonymise: "RETAIN",
    delete: "REMOVE",
    label: "intent matches",
    retainedBecause: "Links between a signal and a prospect id, with a score impact. No personal values.",
  },
  {
    table: "search_feedback",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "search feedback notes",
  },
  {
    table: "sourcing_run_results",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "sourcing candidate names",
    retainedBecause: "Sourcing run cost and outcome per candidate; the candidate name is removed.",
  },
  {
    table: "social_connection_states",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "social connection profile links and notes",
  },
  {
    table: "social_action_log",
    link: "prospect_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "social action log",
    retainedBecause: "Rate-limit ledger of actions taken (type and time). No personal values.",
  },
  {
    table: "social_outbound_messages",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "social message text (unsent drafts discarded)",
  },
  {
    table: "inmail_sends",
    link: "lead_id / prospect_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "LinkedIn InMail notes",
    retainedBecause: "The send and reply times count against the InMail allowance; the note is removed.",
  },
  {
    table: "social_inbound_replies",
    link: "prospect_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "social reply text",
  },
  {
    table: "workspace_app_events",
    link: "prospect_id or the person's address in the payload",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "connected-app event payloads",
    retainedBecause: "The event row and its id stay for de-duplication; the payload is removed.",
  },

  /* -------------------------------------------------------------- agents */
  {
    table: "agent_runs",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "AI agent results",
    retainedBecause: "Agent cost and budget accounting; the result text is removed.",
  },
  {
    table: "agent_queue_items",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "agent queue labels",
  },
  {
    table: "agent_activity_events",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "agent activity details",
    retainedBecause: "The agent's activity history stays; its wording about the person is replaced.",
  },
  {
    table: "business_learning_events",
    link: "subject_type + subject_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "learning evidence",
    retainedBecause: "Aggregate learning about the workspace; the per-person evidence is removed.",
  },

  /* ------------------------------------------------------ billing/audit */
  {
    table: "cost_events",
    link: "subject_type + subject_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "cost records",
    retainedBecause: "Billing record (amounts and ids). Retained for accounting.",
  },
  {
    table: "usage_reservations",
    link: "subject_type + subject_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "usage reservations",
    retainedBecause: "Billing record (metric, quantity, ids). Retained for accounting.",
  },
  {
    table: "domain_events",
    link: "subject_type + subject_id / payload.lead_id / payload email",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "internal event payload values",
    retainedBecause: "The event outbox keeps its ids and types; personal values in payloads are removed.",
  },
  {
    table: "privacy_requests",
    link: "subject_lead_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "the privacy request itself",
    retainedBecause:
      "The record of the request and how it was answered is itself required to show the request was handled.",
  },
  {
    table: "data_rights_actions",
    link: "subject_type + subject_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "this record of what was done",
    retainedBecause: "Append-only record of each data-rights act. Holds counts and table names, never personal values.",
  },
] as const;

/**
 * Tables with no person-link column that still hold personal data about the
 * person, matched another way. Not part of the migration scan; listed so the
 * summary can name them and the SQL can be checked to touch them.
 */
export const INDIRECT_RULES: readonly PersonalDataRule[] = [
  {
    table: "message_events",
    link: "message_id",
    anonymise: "REDACT",
    delete: "REMOVE",
    label: "delivery event payloads",
  },
  {
    table: "conversation_agent_actions",
    link: "agent run",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "AI tool-call summaries",
    retainedBecause: "The tool name, status and latency stay; the inputs and results are removed.",
  },
  {
    table: "agent_tool_calls",
    link: "agent run",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "agent tool-call arguments",
    retainedBecause: "The call and its cost stay; the arguments are removed.",
  },
  {
    table: "notifications",
    link: "entity_id",
    anonymise: "REMOVE",
    delete: "REMOVE",
    label: "in-app notifications",
  },
  {
    table: "jobs",
    link: "payload.leadId / payload.prospectId",
    anonymise: "STOP",
    delete: "RETAIN",
    label: "pending background jobs",
    retainedBecause: "Finished job rows hold ids only and are purged by the retention job.",
  },
  {
    table: "webhook_events",
    link: "the person's address or form id in the payload",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "raw inbound payloads",
    retainedBecause: "The event row stays for de-duplication; the payload is removed.",
  },
  {
    table: "connector_event_failures",
    link: "the person's address in the payload",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "rejected inbound payloads",
    retainedBecause: "The failure row stays; the payload is removed.",
  },
  {
    table: "webhook_deliveries",
    link: "payload.data.lead_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "outgoing webhook payloads",
    retainedBecause: "The delivery record (event type, status) stays; the payload is removed.",
  },
  {
    table: "audit_log",
    link: "entity_id / metadata.lead_id",
    anonymise: "REDACT",
    delete: "RETAIN",
    label: "personal values inside audit entries",
    retainedBecause: "The audit trail of who did what stays, with pseudonymous ids; personal values are removed.",
  },
  {
    table: "workspace_stream_events",
    link: "entity_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "live-update pings",
    retainedBecause: "Ids and event kinds only, used to refresh open screens.",
  },
  {
    table: "usage_events",
    link: "entity_id",
    anonymise: "RETAIN",
    delete: "RETAIN",
    label: "metered usage",
    retainedBecause: "Append-only billing ledger with ids and quantities.",
  },
] as const;

export const ALL_RULES: readonly PersonalDataRule[] = [...PERSONAL_DATA_RULES, ...INDIRECT_RULES];

export function ruleFor(table: string): PersonalDataRule | undefined {
  return ALL_RULES.find((rule) => rule.table === table);
}

/** Tables anonymising leaves untouched. */
export function retainedOnAnonymise(): string[] {
  return ALL_RULES.filter((rule) => rule.anonymise === "RETAIN").map((rule) => rule.table);
}

/** Tables that survive a delete (pseudonymous). */
export function retainedOnDelete(): string[] {
  return ALL_RULES.filter((rule) => rule.delete === "RETAIN").map((rule) => rule.table);
}

/**
 * The columns that tie a row to a person, for the migration scan.
 *
 * `lead_a_id`/`lead_b_id` (merge_candidates) are deliberately not in the
 * pattern: that table also carries `prospect_id`, which is how the scan finds
 * it, and a looser pattern would sweep in unrelated `*_id` columns.
 */
export const PERSON_LINK_COLUMN = /^(lead_id|[a-z_]+_lead_id|prospect_id|[a-z_]+_prospect_id|subject_id|conversation_id)$/;
