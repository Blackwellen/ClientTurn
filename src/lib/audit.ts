import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  unitFor,
  type UsageFeature,
  type UsageMetric,
} from "@/lib/billing/usage-metrics";
import type { ServiceOperationName } from "@/lib/services/registry";

export type AuditAction =
  // Business Profile (V4 section 26): the customer-visible memory layer.
  | "lead.imported"
  | "business_fact.deleted"
  | "business_fact.locked"
  | "icp_profile.saved"
  | "conversion_goal.saved"
  | "member.invited"
  | "member.invite_accepted"
  | "member.removed"
  | "member.role_changed"
  | "integration.connected"
  | "integration.tested"
  | "integration.disconnected"
  | "integration.reconnect_required"
  | "crm.pushed"
  | "crm.push_failed"
  | "automation.published"
  | "automation.created"
  | "automation.draft_saved"
  | "automation.activated"
  | "automation.paused"
  | "automation.draft_discarded"
  | "automation.quiet_hours_changed"
  | "automation.timezone_changed"
  | "automation.channel_budget_changed"
  | "automation.contact_frequency_changed"
  | "reengagement.trigger_fired"
  | "reengagement.trigger_skipped"
  | "automation.test_message_sent"
  | "ai_settings.updated"
  | "qualification.question_saved"
  | "qualification.question_deleted"
  | "qualification.question_reordered"
  | "qualification.rule_saved"
  | "qualification.rule_deleted"
  | "qualification.published"
  | "booking.status_changed"
  | "campaign.launched"
  | "campaign.cancelled"
  | "lead.status_changed"
  | "lead.attention_changed"
  | "lead.assigned"
  | "lead.automation_resumed"
  | "lead.message_queued"
  | "lead.human_takeover"
  | "lead.opt_out_override_attempt"
  | "lead.created_manually"
  | "lead.follow_up_started"
  | "lead.prospect_redirect"
  // Conversation-agent operations. Every one of these is performed by a
  // person, never by the agent -- the agent has no path to these actions.
  | "agent.handover_acknowledged"
  | "agent.handover_assigned"
  | "agent.handover_resolved"
  | "agent.handover_cancelled"
  | "agent.draft_sent"
  | "agent.draft_discarded"
  | "agent.conversation_taken_over"
  | "agent.conversation_returned_to_ai"
  | "billing.tokens_purchase_started"
  | "billing.tokens_purchased"
  | "billing.tokens_refunded"
  | "billing.plan_changed"
  | "billing.trial_checkout_started"
  | "billing.terms_accepted"
  | "billing.credits_purchase_started"
  | "billing.credits_purchased"
  | "billing.credits_refunded"
  // Voice purchases (OD-2): minute packs and the dedicated-number item.
  | "billing.voice_pack_purchase_started"
  | "billing.voice_pack_purchased"
  | "billing.voice_number_added"
  | "billing.voice_removed"
  | "billing.upgrade_suggestions_changed"
  // Billing batch 2 (gap audit 15): SCA, delayed payments, disputes, and the
  // number release after a subscription ends.
  | "billing.payment_action_required"
  | "billing.async_payment_failed"
  | "billing.dispute_opened"
  | "billing.dispute_closed"
  | "billing.number_release_scheduled"
  | "billing.number_release_cancelled"
  | "admin.impersonation"
  | "admin.workspace_suspended"
  | "admin.workspace_unsuspended"
  | "admin.login"
  | "admin.login_failed"
  | "admin.logout"
  | "admin.step_up"
  | "admin.step_up_failed"
  | "admin.support_view"
  | "admin.onboarding_email_resent"
  | "admin.integration_health_check"
  | "admin.webhook_retried"
  | "admin.event_retried"
  | "admin.error_triaged"
  | "admin.provider_health_refreshed"
  | "admin.action_denied"
  // Platform Administration expansion (V4 §43-§47). Job control, compliance
  // publishing, controlled billing changes and platform settings.
  | "admin.job_retried"
  | "admin.job_reconciled"
  | "admin.job_cancelled"
  | "admin.job_dead_lettered"
  | "admin.policy_version_created"
  | "admin.policy_version_published"
  | "admin.policy_version_archived"
  | "admin.suppression_removed"
  | "admin.privacy_request_updated"
  | "admin.compliance_export"
  | "admin.plan_changed"
  | "admin.subscription_cancelled_at_period_end"
  | "admin.subscription_cancellation_reverted"
  | "admin.credit_applied"
  | "admin.credit_reversed"
  | "admin.entitlement_granted"
  | "admin.entitlement_revoked"
  | "admin.trial_extended"
  | "admin.provider_settings_updated"
  | "admin.platform_settings_updated"
  | "admin.feature_flag_updated"
  | "admin.ai_kill_switch_toggled"
  // P5 admin voice ops (brief §58): emergency controls and the voice GM check.
  | "admin.voice_control"
  | "admin.voice_margin_checked"
  // Maintenance mode and platform banners (0161, docs/MAINTENANCE.md).
  | "admin.maintenance_scheduled"
  | "admin.maintenance_updated"
  | "admin.maintenance_ended"
  | "admin.maintenance_cancelled"
  | "admin.maintenance_notice_queued"
  | "admin.banner_created"
  | "admin.banner_updated"
  | "admin.banner_ended"
  | "admin.banner_deleted"
  | "workspace.activated"
  | "workspace.settings_updated"
  | "workspace.delete_requested"
  // Day-90 deletion after cancellation (billing/workspace-deletion.ts).
  | "workspace.deletion_notice_sent"
  | "workspace.deletion_started"
  | "workspace.deleted_after_retention"
  | "workspace.deletion_hold_set"
  | "workspace.deletion_hold_released"
  | "service.created"
  | "service.updated"
  | "service.deleted"
  | "profile.updated"
  | "profile.password_changed"
  | "profile.password_reset_requested"
  | "billing.portal_opened"
  | "export.performed"
  | "campaign.created"
  | "campaign.paused"
  | "campaign.resumed"
  | "campaign.duplicated"
  | "campaign.updated"
  | "campaign.deleted"
  | "campaign.scheduled"
  | "campaign.completed"
  | "import.performed"
  | "lead.imported"
  | "integration.slack_channel_set"
  // The developer platform (Settings -> Developer). Issuing a credential or
  // pointing a webhook at a new URL is an administrative act with consequences
  // outside the product, so each one is a dated fact rather than a silent
  // settings change.
  | "api_key.created"
  | "api_key.revoked"
  | "webhook_endpoint.created"
  | "webhook_endpoint.updated"
  | "webhook_endpoint.deleted"
  | "webhook_endpoint.secret_rotated"
  | "webhook_endpoint.tested"
  // Find Leads (V4 §11.20). Every step that spends money, changes what will be
  // contacted, or moves a record across the Prospect/Lead boundary is logged.
  | "acquisition_profile.analysed"
  | "acquisition_profile.analysis_failed"
  | "acquisition_profile.updated"
  | "search_session.created"
  | "search_session.renamed"
  | "search_session.archived"
  | "search_plan.modified"
  | "sourcing_run.created"
  | "sourcing_run.paused"
  | "sourcing_run.resumed"
  | "sourcing_run.stopped"
  | "sourcing_run.completed"
  | "sourcing_run.failed"
  | "sourcing_run.target_increased"
  // Signals. Pausing one silently switches off part of a workspace's pipeline
  // and launching one spends provider money, so both are recorded.
  | "signal.paused"
  | "signal.resumed"
  | "signal.launched"
  | "sourcing_run.budget_limit_reached"
  | "prospect.suppressed"
  | "prospect.approved"
  | "prospect.promoted_to_lead"
  | "prospect.added_to_campaign"
  | "prospect.removed_from_campaign"
  | "prospect.marked_for_review"
  | "prospect.research_refreshed"
  | "prospect.contact_enriched"
  | "social_account.saved"
  | "social_account.status_changed"
  | "social_outreach.invited"
  | "social_outreach.messaged"
  | "social_outreach.accepted"
  | "social_outreach.withdrawn"
  | "social_outreach.declined"
  | "social_outreach.reply_recorded"
  | "prospect.research_summarised"
  | "prospect.exported"
  // Selected rows from the Leads list, via api/exports/leads.
  | "lead.exported"
  | "recurring_search.created"
  | "recurring_search.paused"
  | "recurring_search.resumed"
  | "recurring_search.stopped"
  | "outreach.dispatched"
  | "sender_identity.created"
  | "outreach_campaign.created"
  | "outreach_campaign.launched"
  | "outreach_campaign.paused"
  | "outreach_campaign.stopped"
  | "intent_category.created"
  | "intent_category.updated"
  | "intent_category.deleted"
  | "intent_monitor.created"
  | "intent_monitor.updated"
  // Platform support desk (V4 §39). Reading another tenant's thread is already
  // logged as `admin.support_view`; these are the writes.
  | "admin.support_replied"
  | "admin.support_note_added"
  | "admin.support_status_changed"
  | "admin.support_assigned"
  // Affiliate programme (V4 §41-43).
  | "affiliate.applied"
  | "affiliate.approved"
  | "affiliate.rejected"
  | "affiliate.suspended"
  | "affiliate.link_created"
  | "affiliate.payout_marked_paid"
  | "affiliate.commission_approved"
  | "affiliate.commission_rejected"
  // The commission ledger. Every entry that changes what a partner is owed is
  // audited, because "why was I paid this" must be answerable months later.
  // Amounts are recorded; tax identifiers and bank details never are.
  | "affiliate.commission_created"
  | "affiliate.commission_reversed"
  | "affiliate.commission_adjusted"
  | "affiliate.payout_scheduled"
  | "affiliate.payout_processed"
  | "affiliate.payout_failed"
  | "affiliate.payment_method_connected"
  | "affiliate.promo_code_created"
  | "affiliate.profile_changed"
  | "affiliate.tax_info_changed"
  | "affiliate.identity_state_changed"
  | "affiliate.notification_prefs_changed"
  // Affiliate audit 17: fraud review, tiers, payout approval, re-accrual.
  | "affiliate.referral_held"
  | "affiliate.referral_rejected"
  | "affiliate.flag_reviewed"
  | "affiliate.tier_changed"
  | "affiliate.tiers_updated"
  | "affiliate.settings_changed"
  | "affiliate.payout_approved"
  | "affiliate.payout_cancelled"
  | "affiliate.commission_reaccrued"
  // Owner decisions 2026-09-28: a partnership closed with a negative balance
  // writes the deficit off (never invoiced).
  | "affiliate.closed"
  | "affiliate.commission_written_off"
  | "affiliate.exported"
  // V4 expansion (§19-§28). Every meaningful write on the nine new surfaces.
  | "analytics.exported"
  | "follow_up.sender_changed"
  | "follow_up.fallback_changed"
  | "integration.test_email_sent"
  | "business_fact.saved"
  | "business_fact.verified"
  | "business_fact.unlocked"
  | "knowledge_source.added"
  | "knowledge_source.removed"
  | "outreach_guidance.updated"
  | "billing.allocation_changed"
  | "billing.overage_changed"
  | "billing.spend_cap_changed"
  | "support.ticket_created"
  | "support.ticket_replied"
  // Copilot writes. The Copilot never writes to a table directly; this records
  // that it invoked a domain service, and that a human confirmed it (§28.9).
  | "copilot.action_executed"
  | "copilot.action_denied"
  // Data rights (Phase 6). The acts themselves audit under their service
  // operation names; these are the ones with no operation behind them.
  | "data_rights.retention_enforced"
  | "privacy_request.received"
  | "privacy_request.verified"
  | "privacy_request.routed"
  // Revenue engine Phase 3: channels, closing, handoff.
  | "booking.rescheduled"
  | "commercial_authority.updated"
  | "checkout.proposed"
  // The direct-sale loop (0143): payments confirmed from the customer's own
  // Stripe or order webhook, and the endpoints that receive them.
  | "payment.received"
  | "payment.confirmed"
  | "payments.endpoint_created"
  | "payments.secret_saved"
  | "payments.secret_rotated"
  | "payments.endpoint_toggled"
  | "handoff.brief_generated"
  | "crm.note_pushed"
  | "inmail.recorded"
  | "inmail.reply_recorded"
  | "social.fallback_enrolled"
  | "domain_health.checked"
  // Revenue engine Phase 5: the duplicate queue. A merge or its undo from the
  // admin System view; the workspace path audits as merge_candidate.resolve.
  | "admin.merge_candidate_resolved"
  | "admin.merge_reverted"
  // Quote-to-cash (P2). The staff-side acts audit under their service
  // operation names (quote.send, invoice.issue ...); these are the acts with
  // no operation behind them: the customer on the public page, and the jobs.
  | "quote.customer_viewed"
  | "quote.customer_accepted"
  | "quote.customer_signed"
  | "quote.pdf_rendered"
  | "quote.expired"
  | "quote.nudged"
  // Quote-to-cash in the agent (brief §72, §74): a paid quote stopped every
  // sales chase; the owner changed what the AI may do.
  | "quote.chasing_stopped"
  | "commercial_authority.ai_updated"
  | "invoice.issued_automatically"
  | "invoice.reminded"
  | "invoice.marked_overdue"
  // Voice P2. The staff-side acts audit under their service operation names
  // (voice.request_call, voice.number_request ...); these are the jobs' acts
  // and the provider callbacks, with no operation behind them.
  | "voice.call_queued"
  | "voice.call_placed"
  | "voice.call_cancelled"
  | "voice.call_completed"
  | "voice.pack_credited"
  | "number.activated"
  | "number.needs_attention"
  | "number.bundle_rejected"
  | "number.release_scheduled"
  | "admin.voice_kill_switch"
  | "billing.voice_pack_refunded"
  | "voice.inbound_answered"
  // The daily voice.retention job: recordings and transcripts removed for a
  // workspace's retention setting (jobs/handlers/voice-retention.ts).
  | "voice.retention_enforced";

/**
 * The full audit vocabulary.
 *
 * `AuditAction` covers the surfaces that predate the service layer. Every
 * operation in the service registry audits under its own name — `lead.archive`
 * — with `.denied` appended when it was refused, and both are admitted here as
 * literal unions rather than as `string`, so a typo is a build failure and not
 * an audit row nobody can search for.
 */
export type AnyAuditAction =
  | AuditAction
  | ServiceOperationName
  | `${ServiceOperationName}.denied`;

/**
 * Writes one audit row and returns its id.
 *
 * The id matters: the service layer puts it in the envelope, so a caller
 * claiming "I archived that lead" hands back the row that proves it. An
 * assertion nobody can check is not an audit trail.
 */
export async function recordAudit(entry: {
  businessId: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "platform_admin" | "provider";
  action: AnyAuditAction;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("audit_log")
    .insert({
      business_id: entry.businessId,
      actor_user_id: entry.actorUserId ?? null,
      actor_type: entry.actorType ?? "user",
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: (entry.metadata ?? {}) as never,
    })
    .select("id")
    .single();

  // Never thrown: an audit write must not undo or block the action it
  // records. But a missing row is logged, so the gap in the trail is visible
  // rather than silent, and the caller receives null rather than an id.
  if (error) {
    console.error("[audit] recordAudit insert failed", {
      businessId: entry.businessId,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return data?.id ?? null;
}

export type UsageEntry = {
  businessId: string;
  metric: UsageMetric;
  quantity?: number;
  unitCost?: number;
  source?: string;
  /** The product surface being charged. See `usage-metrics.ts`. */
  feature?: UsageFeature;
  /** The external provider paid for this, where one was. */
  provider?: string;
  /** What the charge was for, so a line can be traced back to a record. */
  entity?: { type: string; id: string };
  /**
   * Stable key for the operation being charged. A retried worker presenting the
   * same key is charged once. Omit only for a metric no retry can duplicate.
   */
  operationId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * The one way anything is written to the usage ledger.
 *
 * Nothing else may insert into `usage_events`. That rule is the whole point:
 * Billing & Usage is an aggregation of this table, and a counter incremented
 * somewhere else is a number no invoice can defend.
 *
 * Idempotent when given an `operationId` — a repeat is dropped rather than
 * charged again, and a duplicate is not an error, because the caller's job is
 * to record the fact once, not to know whether it already has.
 */
export async function recordUsage(entry: UsageEntry) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("usage_events").insert({
    business_id: entry.businessId,
    metric: entry.metric,
    unit: unitFor(entry.metric),
    quantity: entry.quantity ?? 1,
    unit_cost: entry.unitCost ?? null,
    source: entry.source ?? null,
    feature: entry.feature ?? null,
    provider: entry.provider ?? null,
    entity_type: entry.entity?.type ?? null,
    entity_id: entry.entity?.id ?? null,
    operation_id: entry.operationId ?? null,
    metadata: (entry.metadata ?? {}) as never,
  });

  // 23505 is the unique index on (business_id, operation_id): this operation
  // has already been charged, which is the outcome the caller wanted.
  if (error && error.code !== "23505") throw error;
}

/**
 * Reverses a charge without rewriting history.
 *
 * The ledger refuses UPDATE by trigger, so a provider that failed after billing
 * us, or a charge raised in error, is corrected by posting the opposite
 * quantity against the same operation. Both rows survive, and the balance is
 * their sum.
 */
export async function reverseUsage(input: {
  businessId: string;
  metric: UsageMetric;
  /** The `operationId` of the entry being reversed. */
  operationId: string;
  quantity?: number;
  reason: string;
}) {
  const supabase = createAdminClient();

  const { error } = await supabase.from("usage_events").insert({
    business_id: input.businessId,
    metric: input.metric,
    unit: unitFor(input.metric),
    quantity: -(input.quantity ?? 1),
    source: "adjustment",
    operation_id: `reversal:${input.operationId}`,
    adjusts_operation_id: input.operationId,
    metadata: { reason: input.reason } as never,
  });

  if (error && error.code !== "23505") throw error;
}
