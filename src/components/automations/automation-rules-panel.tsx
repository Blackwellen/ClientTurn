import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation } from "@/lib/services";
import type { BusinessRoleName } from "@/lib/services/types";
import { capabilitiesFor } from "@/lib/billing/capabilities";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { AI_PERMISSIONS, aiMay, type AiPermission } from "@/lib/commercial/ai-permissions";
import type { RuleView } from "@/lib/services/operations/automation";
import { ErrorState } from "@/components/ui/feedback";
import { AutomationRulesBoard, type BuilderContext } from "./automation-rules-board";

/**
 * Follow-Up -> Automations (gap map §45): the workspace's event-triggered
 * rules, their recent runs, and the builder. Reads through the service layer
 * (automation_rule.list) like every other surface; the options the builder
 * offers (catalogue items, nurture campaigns, approved checkout links) and the
 * switches that decide whether an action will run are read here so the
 * builder can say so before a rule is saved rather than after it skips.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

async function builderContext(businessId: string): Promise<BuilderContext> {
  const [items, campaigns, authority, capabilities, voice] = await Promise.all([
    db().from("catalogue_items").select("key, name").eq("business_id", businessId).eq("active", true).is("archived_at", null).order("name").limit(200),
    db().from("campaigns").select("id, name, status").eq("business_id", businessId).in("status", ["DRAFT", "SCHEDULED", "PAUSED"]).order("created_at", { ascending: false }).limit(50),
    loadCommercialAuthoritySettings(businessId),
    capabilitiesFor(businessId),
    db().from("voice_settings").select("voice_enabled, admin_kill_switch").eq("business_id", businessId).maybeSingle(),
  ]);
  const ai = aiAuthorityOf(authority);
  const caps: Record<string, boolean> = Object.fromEntries(Object.entries(capabilities).map(([k, d]) => [k, Boolean(d.allowed)]));
  const voiceRow = voice.data as { voice_enabled: boolean; admin_kill_switch: boolean } | null;
  caps.voice_enabled = Boolean(voiceRow?.voice_enabled && !voiceRow.admin_kill_switch && capabilities.voice_sales_enabled?.allowed);
  return {
    catalogueItems: ((items.data ?? []) as { key: string; name: string }[]).map((i) => ({ id: i.key, name: i.name })),
    campaigns: ((campaigns.data ?? []) as { id: string; name: string; status: string }[]).map((c) => ({ id: c.id, name: c.name, status: c.status })),
    checkoutLinks: authority.approved_checkout_links.map((l) => ({ id: l.id, label: l.label })),
    aiPermissions: Object.fromEntries(AI_PERMISSIONS.map((p) => [p, aiMay(ai, p)])) as Record<AiPermission, boolean>,
    capabilities: caps,
  };
}

export async function AutomationRulesPanel({
  businessId,
  userId,
  role,
  canEdit,
}: {
  businessId: string;
  userId: string;
  role: BusinessRoleName;
  canEdit: boolean;
}) {
  const [list, context] = await Promise.all([
    runOperation<{ rules: RuleView[]; pendingMigration: boolean }>("automation_rule.list", {}, {
      businessId,
      userId,
      role,
      caller: "UI",
      correlationId: randomUUID(),
    }),
    builderContext(businessId),
  ]);

  if (!list.success) {
    return <ErrorState title="Automations could not be loaded" description={list.message} />;
  }

  return (
    <AutomationRulesBoard
      rules={list.data.rules}
      pendingMigration={list.data.pendingMigration}
      context={context}
      canEdit={canEdit}
    />
  );
}
