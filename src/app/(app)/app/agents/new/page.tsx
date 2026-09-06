import * as React from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAgentWizardOptions } from "@/lib/agents/queries";
import { AGENT_TYPES, type AgentType } from "@/lib/agents/types";
import { AgentWizard } from "@/components/agents/agent-wizard";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "New agent · ClientTurn" };
export const dynamic = "force-dynamic";

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const workspace = await requireRole("admin");
  const [params, options] = await Promise.all([
    searchParams,
    getAgentWizardOptions(workspace.businessId),
  ]);

  const supabase = await createClient();
  const { data: plans, error } = await supabase
    .from("search_strategies")
    .select("id, version, search_sessions!search_strategies_session_id_fkey(title)")
    .eq("business_id", workspace.businessId)
    .eq("status", "APPROVED");

  if (error) throw new Error("Could not load approved search plans.");

  const initialType: AgentType =
    AGENT_TYPES.find((candidate) => candidate === params.type) ?? "SOURCING";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create an agent"
        description="Choose a role, pick where it may look, set the boundaries, then review."
        size="lg"
      />
      <AgentWizard
        plans={(plans ?? []).map((plan) => ({
          id: plan.id,
          name: `${plan.search_sessions?.title ?? "Approved search"} · v${plan.version}`,
        }))}
        sourceAvailability={options.sourceAvailability}
        initialType={initialType}
      />
    </div>
  );
}
