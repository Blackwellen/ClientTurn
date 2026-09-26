import "server-only";
import * as React from "react";
import { randomUUID } from "node:crypto";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { runOperation } from "@/lib/services";
import type { CrmPullView, WhatsAppStepView } from "@/lib/services/operations/channels";
import { ErrorState } from "@/components/ui/feedback";
import { CrmPullPanel } from "./crm-pull-panel";
import { WhatsAppTemplatesPanel, type TemplateView } from "./whatsapp-templates-panel";

function LoadError({ title }: { title: string }) {
  return (
    <section className="border-line bg-surface rounded-xl border shadow-xs">
      <ErrorState
        title={`${title} could not be loaded`}
        description="Nothing has been changed. Refresh the page to try again."
      />
    </section>
  );
}

/**
 * The CRM import toggle (§29) and the WhatsApp template registry (§45), in
 * Settings -> Connections. Reads go through the service operations with the
 * viewer's own role, so this page sees exactly what MCP or the API would.
 * Each panel fails on its own: a broken read never takes the section down.
 */
export async function ChannelControls() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");
  const context = {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
  };

  const [crm, whatsapp, entitlements] = await Promise.all([
    runOperation<{ crms: CrmPullView[] }>("crm_pull.list", {}, context),
    runOperation<{ transport: "twilio" | "meta"; templates: TemplateView[]; steps: WhatsAppStepView[] }>(
      "whatsapp_template.list",
      {},
      context,
    ),
    getEntitlements(workspace.businessId).catch(() => null),
  ]);

  return (
    <>
      {crm.success ? (
        <CrmPullPanel crms={crm.data.crms} canManage={canManage} />
      ) : (
        <LoadError title="CRM import" />
      )}
      {whatsapp.success ? (
        <WhatsAppTemplatesPanel
          transport={whatsapp.data.transport}
          templates={whatsapp.data.templates}
          steps={whatsapp.data.steps}
          canManage={canManage}
          whatsappEnabled={Boolean(entitlements?.whatsappEnabled)}
        />
      ) : (
        <LoadError title="WhatsApp templates" />
      )}
    </>
  );
}
