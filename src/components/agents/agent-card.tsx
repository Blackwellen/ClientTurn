import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  CircleAlert,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  AGENT_TYPE_DEFINITIONS,
  agentStatusLabel,
  agentStatusTone,
  autonomyLabel,
  cadenceLabel,
  SOURCE_DEFINITIONS,
  type AgentListRow,
} from "@/lib/agents/types";

/**
 * One agent, as a card.
 *
 * Leads with what the agent is *doing* rather than what it is configured as:
 * the numbers that matter when you open this page are how much it found this
 * week and whether anything is stuck waiting for a person. Configuration is
 * secondary and sits in the footer.
 *
 * Blocked work is promoted to the top of the card, because an agent that is
 * quietly waiting for approval looks identical to an agent that is working
 * unless the UI says otherwise.
 */
export function AgentCard({ agent }: { agent: AgentListRow }) {
  const definition = AGENT_TYPE_DEFINITIONS[agent.agentType];
  const needsPerson = agent.blocked > 0 || agent.pendingReviewCount > 0;
  const waiting = agent.blocked + agent.pendingReviewCount;

  return (
    <Link
      href={`/app/agents/${agent.id}`}
      className={cn(
        "group flex h-full flex-col rounded-xl border bg-surface p-5 shadow-xs",
        "transition-shadow duration-150 hover:shadow-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        agent.status === "ERROR" ? "border-danger-100" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            definition.accent === "success"
              ? "bg-success-50 text-success-600"
              : definition.accent === "purple"
                ? "bg-purple-50 text-purple-700"
                : definition.accent === "info"
                  ? "bg-info-50 text-info-700"
                  : "bg-accent-50 text-content-accent",
          )}
        >
          <Bot className="size-5" />
        </span>

        <Badge tone={agentStatusTone(agent.status)} dot>
          {agentStatusLabel(agent.status)}
        </Badge>
      </div>

      <h3 className="mt-4 truncate text-[15px] font-semibold text-content group-hover:text-content-accent">
        {agent.name}
      </h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[12.5px] text-content-muted">
        {agent.description || definition.tagline}
      </p>

      {needsPerson && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-warning-700">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {waiting.toLocaleString("en-GB")} waiting for you
        </p>
      )}

      <dl className="my-4 grid grid-cols-3 gap-3 border-y border-line-subtle py-4">
        <Metric label="Found" sub="7 days" value={agent.prospects7d} />
        <Metric label="To Leads" sub="7 days" value={agent.leads7d} />
        <Metric label="In queue" sub="now" value={agent.queued} />
      </dl>

      {agent.enabledSources.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {agent.enabledSources.slice(0, 3).map((key) => (
            <Badge key={key} tone="neutral" dense>
              {SOURCE_DEFINITIONS[key]?.label ?? key}
            </Badge>
          ))}
          {agent.enabledSources.length > 3 && (
            <Badge tone="neutral" dense>
              +{agent.enabledSources.length - 3}
            </Badge>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 text-[11.5px] text-content-subtle">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {cadenceLabel(agent.cadence)}
          </span>

          {/* Enrichment is shown as icons because it is the setting people most
              often need to confirm at a glance, and the two carry different
              obligations. */}
          {agent.enrichEmail && (
            <Tooltip content="Finds and verifies a work email address">
              <Mail className="size-3.5" aria-label="Email enrichment on" />
            </Tooltip>
          )}
          {agent.enrichPhone && (
            <Tooltip content="Looks up a business phone number. Finding a number does not grant permission to call or text it.">
              <Phone className="size-3.5" aria-label="Phone enrichment on" />
            </Tooltip>
          )}

          <Tooltip content={autonomyLabel(agent.autonomy)}>
            <ShieldCheck className="size-3.5" aria-label={autonomyLabel(agent.autonomy)} />
          </Tooltip>
        </span>

        <ArrowUpRight
          className="size-4 shrink-0 text-content-subtle transition-colors group-hover:text-content-accent"
          aria-hidden
        />
      </div>
    </Link>
  );
}

function Metric({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <div className="min-w-0">
      <dd className="text-[19px] font-semibold leading-none tabular-nums text-content">
        {value.toLocaleString("en-GB")}
      </dd>
      <dt className="mt-1.5 truncate text-[11px] text-content-muted">
        {label} <span className="text-content-subtle">· {sub}</span>
      </dt>
    </div>
  );
}
