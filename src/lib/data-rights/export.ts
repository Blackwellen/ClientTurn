import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubjectNotFoundError } from "./executor";

/**
 * Subject-access export (UK GDPR Art 15): everything held on one lead, and the
 * prospect record it came from if it was sourced, in one JSON document.
 *
 * Includes the things a person is entitled to understand, not only the things
 * they typed: where the details came from (provenance), what permission was
 * recorded, every contactability decision and the rules version behind it,
 * scores with their explanations (Art 15(1)(h), Art 22A-D), and whether they
 * are on the do-not-contact list.
 *
 * Every read is scoped to the workspace. Row caps keep one enormous history
 * from exhausting the function; a capped section says so rather than
 * silently truncating.
 */

const CAP = 2000;

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

type Section = { rows: unknown[]; truncated: boolean };

async function section(
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Section> {
  const { data, error } = await query;
  if (error) {
    // An export that silently omits a section is a wrong answer to a legal
    // request. Fail loudly and let the person retry.
    throw new Error(`Export read failed: ${error.message}`);
  }
  const rows = data ?? [];
  return { rows, truncated: rows.length >= CAP };
}

export type SubjectExport = {
  format: "clientturn.subject-export.v1";
  generated_at: string;
  business_id: string;
  subject: { type: "LEAD"; id: string };
  notes: string[];
  lead: Record<string, unknown>;
  sections: Record<string, Section>;
};

export async function exportLead(businessId: string, leadId: string): Promise<SubjectExport> {
  const client = db();

  const { data: lead, error } = await client
    .from("leads")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`Export read failed: ${error.message}`);
  if (!lead) throw new SubjectNotFoundError();

  const row = lead as Record<string, unknown>;
  const prospectIds = new Set<string>();
  if (typeof row.promoted_from_prospect_id === "string") prospectIds.add(row.promoted_from_prospect_id);
  const { data: promoted } = await client
    .from("prospects")
    .select("id")
    .eq("business_id", businessId)
    .eq("promoted_to_lead_id", leadId);
  for (const p of (promoted ?? []) as { id: string }[]) prospectIds.add(p.id);
  const prospects = [...prospectIds];

  const bySubject = (table: string, columns = "*") =>
    client
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .or(
        prospects.length > 0
          ? `and(subject_type.eq.LEAD,subject_id.eq.${leadId}),and(subject_type.eq.PROSPECT,subject_id.in.(${prospects.join(",")}))`
          : `and(subject_type.eq.LEAD,subject_id.eq.${leadId})`,
      )
      .limit(CAP);

  const byLead = (table: string, columns = "*", order = "created_at") =>
    client
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order(order, { ascending: true })
      .limit(CAP);

  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : null;
  const phone =
    typeof row.phone_normalized === "string" && row.phone_normalized
      ? row.phone_normalized
      : typeof row.phone === "string"
        ? row.phone
        : null;

  const [
    touches,
    sourceEvidence,
    permissions,
    contactability,
    decisions,
    notices,
    scores,
    tags,
    opportunities,
    answers,
    conversations,
    messages,
    bookings,
    notes,
    handoffs,
    extractions,
    merges,
    rightsActions,
    privacyRequests,
    prospectRows,
    prospectSources,
    prospectScores,
    suppression,
    intentSignals,
    qualificationFacts,
    assessments,
  ] = await Promise.all([
    section(byLead("lead_touches", "*", "occurred_at")),
    section(bySubject("lead_source_evidence")),
    section(bySubject("contact_permissions")),
    section(bySubject("contactability_results")),
    section(bySubject("compliance_decisions")),
    section(bySubject("privacy_notice_events")),
    section(byLead("lead_scores")),
    section(byLead("lead_tags", "*", "set_at")),
    section(byLead("opportunities")),
    section(
      client
        .from("qualification_answers")
        .select("answer_text, answer_value, evaluation, source, confidence, answered_at, qualification_questions(question_text)")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("answered_at", { ascending: true })
        .limit(CAP),
    ),
    section(
      client
        .from("conversations")
        .select("id, channel, state, subject, counterparty_name, counterparty_handle, created_at, last_message_at")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .limit(CAP),
    ),
    section(
      client
        .from("messages")
        .select("id, conversation_id, direction, channel, subject, body, status, origin, sent_at, delivered_at, received_at, created_at, reply_classification")
        .eq("business_id", businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .limit(CAP),
    ),
    section(byLead("bookings", "id, provider, starts_at, ends_at, location, status, notes, created_at")),
    section(byLead("lead_notes", "id, body, author_kind, created_at")),
    section(byLead("agent_handoffs", "id, reason, priority, summary_json, status, created_at, resolved_at")),
    section(byLead("conversation_agent_extractions", "field, value_json, confidence, accepted, created_at")),
    section(byLead("merge_events")),
    section(bySubject("data_rights_actions", "action, caller, reason, performed_at, summary")),
    section(
      client
        .from("privacy_requests")
        .select("reference, request_type, status, received_at, acknowledged_at, due_at, completed_at")
        .eq("business_id", businessId)
        .eq("subject_lead_id", leadId)
        .limit(CAP),
    ),
    prospects.length
      ? section(
          client
            .from("prospects")
            .select("id, first_name, last_name, role_title, email, phone_e164, linkedin_url, location_json, source_provider, subscriber_type, outreach_eligibility, eligibility_reason, grade, score, created_at, last_contacted_at, social_platform, social_handle, social_profile_url")
            .eq("business_id", businessId)
            .in("id", prospects),
        )
      : Promise.resolve({ rows: [], truncated: false }),
    prospects.length
      ? section(
          client
            .from("prospect_data_sources")
            .select("prospect_id, field_name, value_json, provider, source_type, source_url, confidence, obtained_at, policy_tags")
            .eq("business_id", businessId)
            .in("prospect_id", prospects)
            .limit(CAP),
        )
      : Promise.resolve({ rows: [], truncated: false }),
    prospects.length
      ? section(
          client
            .from("prospect_scores")
            .select("prospect_id, score_version, total_score, grade, factor_json, explanation, created_at")
            .eq("business_id", businessId)
            .in("prospect_id", prospects)
            .limit(CAP),
        )
      : Promise.resolve({ rows: [], truncated: false }),
    email || phone
      ? section(
          client.rpc("data_rights_subject_suppressions", {
            p_business_id: businessId,
            p_email: email,
            p_phone: phone,
          }) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
        )
      : Promise.resolve({ rows: [], truncated: false }),
    // Qualification intelligence (0134). The signals carry verbatim excerpts,
    // the facts carry the person's answers, and the assessments are automated
    // profiling (Art 15(1)(h), Art 22A-D), so all three are owed in full.
    section(
      byLead(
        "lead_intent_signals",
        "id, category, signal_type, polarity, strength, confidence, source, observed_at, half_life_hours, flat_until, expires_at, resume_at, reason, evidence_excerpt, rule_version, retracted_at, created_at",
        "observed_at",
      ),
    ),
    section(
      byLead(
        "lead_qualification_facts",
        "id, dimension, value, value_normalised, state, source, question_intent_key, confidence, observed_at, valid_until, verified_at, superseded_at, created_at",
        "observed_at",
      ),
    ),
    section(
      byLead(
        "lead_assessments",
        "id, intent_state, intent_score, intent_categories, intent_evidence, intent_contradictions, intent_confidence, valid_until, goal, qualification_completeness, dimension_status, nba, engine_version, engine_mode, trigger_event, is_current, created_at",
      ),
    ),
  ]);

  const sections: Record<string, Section> = {
    source_and_arrivals: touches,
    source_evidence: sourceEvidence,
    contact_permissions: permissions,
    contactability_decisions: contactability,
    compliance_reviews: decisions,
    privacy_notices_sent: notices,
    scores_with_explanations: scores,
    tags: tags,
    opportunities,
    qualification_answers: answers,
    conversations,
    messages,
    bookings,
    notes,
    ai_handovers: handoffs,
    ai_extracted_facts: extractions,
    record_merges: merges,
    do_not_contact: suppression,
    data_rights_history: rightsActions,
    privacy_requests: privacyRequests,
    sourced_prospect_records: prospectRows,
    prospect_provenance: prospectSources,
    prospect_scores: prospectScores,
    intent_signals: intentSignals,
    qualification_facts: qualificationFacts,
    qualification_assessments: assessments,
  };

  const notes_: string[] = [
    "Scores are produced by deterministic rules. Each score row lists the factors and the explanation used; a person can ask for any automated decision to be reviewed by a human.",
    "Contactability decisions record the rules version that produced them, so each past decision can be checked against the rules in force at the time.",
    "Intent signals, qualification facts and assessments are produced by deterministic, versioned rules (the engine_version and rule_version on each row). An AI assist may only propose a candidate value, which is stored as INFERRED at most and never decides anything on its own.",
    "Do-not-contact entries stored as a one-way hash are reported as HASHED: the address itself is no longer held.",
  ];
  const truncated = Object.entries(sections)
    .filter(([, value]) => value.truncated)
    .map(([key]) => key);
  if (truncated.length > 0) {
    notes_.push(
      `These sections reached the ${CAP.toLocaleString("en-GB")}-row limit of one export and may be incomplete: ${truncated.join(", ")}. Contact support for a complete copy.`,
    );
  }

  return {
    format: "clientturn.subject-export.v1",
    generated_at: new Date().toISOString(),
    business_id: businessId,
    subject: { type: "LEAD", id: leadId },
    notes: notes_,
    // The unsubscribe token is a credential for the one-click opt-out link,
    // not information about the person.
    lead: Object.fromEntries(Object.entries(row).filter(([key]) => key !== "unsubscribe_token")),
    sections,
  };
}

/** Counts per section, for the audit summary. Never the contents. */
export function exportSummary(doc: SubjectExport): Record<string, number> {
  return Object.fromEntries(
    Object.entries(doc.sections).map(([key, value]) => [key, value.rows.length]),
  );
}
