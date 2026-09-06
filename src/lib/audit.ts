import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
  | "workspace.activated"
  | "workspace.settings_updated"
  | "workspace.delete_requested"
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
  | "sourcing_run.budget_limit_reached"
  | "prospect.suppressed"
  | "prospect.approved"
  | "prospect.promoted_to_lead"
  | "prospect.added_to_campaign"
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
  | "intent_monitor.updated";

export async function recordAudit(entry: {
  businessId: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "system" | "platform_admin" | "provider";
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createAdminClient();
  await supabase.from("audit_log").insert({
    business_id: entry.businessId,
    actor_user_id: entry.actorUserId ?? null,
    actor_type: entry.actorType ?? "user",
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    metadata: (entry.metadata ?? {}) as never,
  });
}

export async function recordUsage(entry: {
  businessId: string;
  metric:
    | "lead_processed"
    | "message_sent"
    | "message_received"
    | "ai_call"
    | "campaign_message";
  quantity?: number;
  unitCost?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createAdminClient();
  await supabase.from("usage_events").insert({
    business_id: entry.businessId,
    metric: entry.metric,
    quantity: entry.quantity ?? 1,
    unit_cost: entry.unitCost ?? null,
    source: entry.source ?? null,
    metadata: (entry.metadata ?? {}) as never,
  });
}
