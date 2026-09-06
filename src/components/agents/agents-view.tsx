import * as React from "react";
import Link from "next/link";
import { Bot, Plus, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import {
  AGENT_TYPE_DEFINITIONS,
  AGENT_TYPES,
  type AgentListRow,
  type AgentType,
} from "@/lib/agents/types";
import { AgentCard } from "./agent-card";

/**
 * The Agents register.
 *
 * Grouped by role rather than presented as one flat grid, because the four
 * roles do genuinely different work and "which of my agents finds new
 * business?" is the question this page exists to answer.
 *
 * A role with no agents still gets a row — an empty section that explains what
 * the role would do is how someone discovers the capability, whereas hiding it
 * means they never learn it exists.
 */
export function AgentsView({
  agents,
  counts,
  canManage,
}: {
  agents: AgentListRow[];
  counts: { all: number; active: number; needsAttention: number; draft: number };
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Agents"
          description="Background workers that find opportunities, book conversations and bring quiet leads back."
          size="lg"
        />
        {canManage && (
          <Link
            href="/app/agents/new"
            className="bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-content-accent inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-[14px] font-semibold shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Plus className="size-4" aria-hidden />
            New agent
          </Link>
        )}
      </div>

      <SummaryStrip counts={counts} />

      {AGENT_TYPES.map((type) => (
        <AgentSection
          key={type}
          type={type}
          agents={agents.filter((agent) => agent.agentType === type)}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function SummaryStrip({
  counts,
}: {
  counts: { all: number; active: number; needsAttention: number; draft: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-5 py-3.5">
      <Stat label="agents" value={counts.all} />
      <Stat label="running" value={counts.active} tone="success" />
      <Stat label="need attention" value={counts.needsAttention} tone="warning" />
      <Stat label="draft" value={counts.draft} />

      <p className="ml-auto flex items-center gap-1.5 text-[12px] text-content-muted">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        Every agent runs inside your limits and contact rules
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <span className="text-[13px] text-content-muted">
      <strong
        className={cn(
          "text-[15px] font-semibold tabular-nums",
          tone === "success" && value > 0
            ? "text-success-600"
            : tone === "warning" && value > 0
              ? "text-warning-700"
              : "text-content",
        )}
      >
        {value.toLocaleString("en-GB")}
      </strong>{" "}
      {label}
    </span>
  );
}

function AgentSection({
  type,
  agents,
  canManage,
}: {
  type: AgentType;
  agents: AgentListRow[];
  canManage: boolean;
}) {
  const definition = AGENT_TYPE_DEFINITIONS[type];

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-content">{definition.label}s</h2>
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] tabular-nums text-content-secondary">
          {agents.length}
        </span>
      </div>

      {agents.length === 0 ? (
        <EmptyRole type={type} canManage={canManage} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Teaches the role rather than just reporting its absence. */
function EmptyRole({ type, canManage }: { type: AgentType; canManage: boolean }) {
  const definition = AGENT_TYPE_DEFINITIONS[type];

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-dashed border-line-strong bg-surface-sunken/40 p-5">
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-content-muted"
        >
          <Bot className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-content">{definition.tagline}</p>
          <p className="mt-1 max-w-2xl text-[12.5px] text-content-muted">
            {definition.description}
          </p>
        </div>
      </div>

      {canManage && (
        <Link
          href={`/app/agents/new?type=${type}`}
          className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Create {definition.label.toLowerCase()}
        </Link>
      )}
    </div>
  );
}
