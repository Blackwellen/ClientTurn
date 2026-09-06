import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Bot } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  getAgent,
  getAgentActivity,
  getAgentLeads,
  getAgentQueue,
} from "@/lib/agents/queries";
import {
  TAB_LABELS,
  agentStatusLabel,
  agentStatusTone,
  agentTypeLabel,
  cadenceLabel,
  tabsForType,
  type AgentTab,
} from "@/lib/agents/types";
import { Badge } from "@/components/ui/badge";
import { TabLink, TabLinkBar } from "@/components/ui/tabs";
import { AgentControls } from "@/components/agents/agent-controls";
import {
  ActivityTab,
  CampaignTab,
  LeadsTab,
  OverviewTab,
  QueueTab,
  SettingsTab,
  SourcesTab,
} from "@/components/agents/agent-tabs";

export const metadata: Metadata = { title: "Agent · ClientTurn" };
export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [workspace, { id }, query] = await Promise.all([
    requireWorkspace(),
    params,
    searchParams,
  ]);

  // A malformed id is a 404, not a database error.
  if (!z.uuid().safeParse(id).success) notFound();

  const detail = await getAgent(workspace.businessId, id);
  if (!detail) notFound();

  const { agent, sources } = detail;
  const canManage = hasRole(workspace.role, "admin");

  // Tabs are per-type: a booking agent has no Sources tab because it does not
  // discover anything. An unknown or unavailable tab falls back to Overview.
  const available = tabsForType(agent.agentType);
  const tab: AgentTab =
    available.find((candidate) => candidate === query.tab) ?? "overview";

  // Only the open tab's data is fetched. Runs are needed by two tabs, so they
  // load whenever either is open rather than on every render.
  const needsRuns = tab === "overview" || tab === "queue";
  const supabase = await createClient();

  const [queue, activity, leads, runsResult] = await Promise.all([
    tab === "queue" ? getAgentQueue(workspace.businessId, id) : Promise.resolve([]),
    tab === "overview" || tab === "activity"
      ? getAgentActivity(workspace.businessId, id, tab === "activity" ? 100 : 10)
      : Promise.resolve([]),
    tab === "leads" ? getAgentLeads(workspace.businessId, id) : Promise.resolve([]),
    needsRuns
      ? supabase
          .from("sourcing_runs")
          .select("id, title, status, target_verified")
          .eq("business_id", workspace.businessId)
          .eq("agent_id", id)
          .order("created_at", { ascending: false })
          .limit(25)
      : Promise.resolve({ data: [] }),
  ]);

  const runs = (runsResult.data ?? []).map((run) => ({
    id: run.id,
    title: run.title,
    status: run.status,
    targetVerified: run.target_verified,
  }));

  return (
    <div className="space-y-5">
      <Link
        href="/app/agents"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-content-muted hover:text-content"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All agents
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-content-accent"
          >
            <Bot className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[11.5px] uppercase tracking-wide text-content-muted">
              {agentTypeLabel(agent.agentType)}
            </p>
            <h1 className="mt-0.5 truncate text-[24px] font-semibold tracking-[-0.02em] text-content">
              {agent.name}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-content-muted">
              <Badge tone={agentStatusTone(agent.status)} dot>
                {agentStatusLabel(agent.status)}
              </Badge>
              {cadenceLabel(agent.cadence)}
            </p>
          </div>
        </div>

        {canManage && <AgentControls id={id} status={agent.status} />}
      </header>

      {agent.statusReason && (
        <p
          role="status"
          className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-[12.5px] text-warning-700"
        >
          {agent.statusReason}
        </p>
      )}

      <TabLinkBar aria-label="Agent sections">
        {available.map((candidate) => (
          <TabLink
            key={candidate}
            href={`/app/agents/${id}?tab=${candidate}`}
            active={candidate === tab}
          >
            {TAB_LABELS[candidate]}
          </TabLink>
        ))}
      </TabLinkBar>

      {tab === "overview" && (
        <OverviewTab agent={agent} activity={activity} runCount={runs.length} />
      )}
      {tab === "leads" && <LeadsTab leads={leads} />}
      {tab === "queue" && <QueueTab queue={queue} runs={runs} />}
      {tab === "sources" && <SourcesTab sources={sources} />}
      {tab === "campaign" && <CampaignTab agent={agent} />}
      {tab === "activity" && <ActivityTab activity={activity} />}
      {tab === "settings" && (
        <SettingsTab
          agent={agent}
          canManage={canManage}
          controls={<AgentControls id={id} status={agent.status} />}
        />
      )}
    </div>
  );
}
