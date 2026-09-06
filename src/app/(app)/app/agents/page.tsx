import * as React from "react";
import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getAgentCounts, listAgents } from "@/lib/agents/queries";
import { AgentsView } from "@/components/agents/agents-view";

export const metadata: Metadata = { title: "Agents · ClientTurn" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const workspace = await requireWorkspace();

  // Neither depends on the other, so the page never waterfalls.
  const [agents, counts] = await Promise.all([
    listAgents(workspace.businessId),
    getAgentCounts(workspace.businessId),
  ]);

  return (
    <AgentsView
      agents={agents}
      counts={counts}
      canManage={hasRole(workspace.role, "admin")}
    />
  );
}
