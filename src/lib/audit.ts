import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuditAction =
  | "member.invited"
  | "member.invite_accepted"
  | "member.removed"
  | "member.role_changed"
  | "integration.connected"
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
  | "workspace.activated"
  | "workspace.settings_updated"
  | "workspace.delete_requested"
  | "service.created"
  | "service.updated"
  | "service.deleted"
  | "profile.updated"
  | "profile.password_changed"
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
  | "integration.slack_channel_set";

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
