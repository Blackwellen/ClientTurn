import * as React from "react";
import Link from "next/link";
import { CircleAlert, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { leadDisplayName, type LeadListRow } from "@/lib/leads/types";
import {
  SOURCE_DEFINITIONS,
  autonomyDescription,
  autonomyLabel,
  cadenceLabel,
  queueStatusTone,
  queueTypeLabel,
  severityTone,
  sourceStatusTone,
  type AgentActivityRow,
  type AgentQueueRow,
  type AgentSourceRow,
} from "@/lib/agents/types";
import type { AgentDetail } from "@/lib/agents/queries";

/**
 * The Agent detail tabs.
 *
 * Each is a plain server component taking exactly the data its tab loaded, so
 * a tab that is not open costs nothing — the page only queries for the one
 * being viewed.
 */

/* ---------------------------------------------------------------- overview */

export function OverviewTab({
  agent,
  activity,
  runCount,
}: {
  agent: AgentDetail["agent"];
  activity: AgentActivityRow[];
  runCount: number;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Found this week" value={agent.prospects7d} />
        <StatCard label="Moved to Leads this week" value={agent.leads7d} />
        <StatCard label="In queue" value={agent.queued} />
        <StatCard
          label="Waiting for you"
          value={agent.blocked + agent.pendingReviewCount}
          tone={agent.blocked + agent.pendingReviewCount > 0 ? "warning" : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Recent activity" className="lg:col-span-2">
          {activity.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-content-muted">
              Activity appears here once this agent has been configured and run.
            </p>
          ) : (
            <ActivityList events={activity.slice(0, 6)} />
          )}
        </Panel>

        <Panel title="Operating boundaries">
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-[12.5px] text-content-secondary">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-content-accent" aria-hidden />
              {autonomyDescription(agent.autonomy)}
            </p>

            <dl className="space-y-2 border-t border-line-subtle pt-3 text-[12.5px]">
              <Row label="Approval" value={autonomyLabel(agent.autonomy)} />
              <Row label="Schedule" value={cadenceLabel(agent.cadence)} />
              <Row
                label="Daily limit"
                value={`${agent.dailyProspectCap.toLocaleString("en-GB")} prospects`}
              />
              <Row
                label="Monthly limit"
                value={`${agent.monthlyProspectCap.toLocaleString("en-GB")} prospects`}
              />
              <Row label="Minimum grade" value={agent.minimumGrade} />
              <Row
                label="Next run"
                value={
                  agent.nextRunAt
                    ? new Date(agent.nextRunAt).toLocaleString("en-GB")
                    : "Not scheduled"
                }
              />
              <Row label="Sourcing runs" value={runCount.toLocaleString("en-GB")} />
            </dl>

            {/* Stated on the surface where people configure enrichment, not
                buried in terms: discovering a number is not consent to use it. */}
            <p className="border-t border-line-subtle pt-3 text-[11.5px] text-content-muted">
              Finding a contact detail never grants permission to use it. Every message is
              checked against opt-outs, consent and channel rules before it is sent.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- leads */

export function LeadsTab({ leads }: { leads: LeadListRow[] }) {
  return (
    <Panel
      title="Leads from this agent"
      action={
        <Link
          href="/app/find-leads?view=prospects"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          Review sourced prospects
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      }
    >
      <p className="mb-3 text-[12.5px] text-content-muted">
        Sourced records stay in Find Leads as prospects until they are reviewed and
        promoted. Only promoted records appear here.
      </p>

      {leads.length === 0 ? (
        <EmptyState
          title="Nothing promoted yet"
          description="When a prospect from this agent becomes a lead, it will appear here and in your main Leads inbox."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/app/leads?lead=${lead.id}`}
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-surface-hover"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-content">
                    {leadDisplayName(lead)}
                  </span>
                  {lead.email && (
                    <span className="block truncate text-[12px] text-content-muted">
                      {lead.email}
                    </span>
                  )}
                </span>
                <Badge tone="neutral" dense>
                  {lead.status}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- queue */

export function QueueTab({
  queue,
  runs,
}: {
  queue: AgentQueueRow[];
  runs: { id: string; title: string | null; status: string; targetVerified: number }[];
}) {
  // Blocked work first: an agent waiting for a person is the single most
  // actionable thing on this page.
  const blocked = queue.filter((item) => item.status === "BLOCKED");
  const rest = queue.filter((item) => item.status !== "BLOCKED");

  return (
    <div className="space-y-5">
      {blocked.length > 0 && (
        <Panel title={`Waiting for you (${blocked.length})`}>
          <ul className="divide-y divide-line-subtle">
            {blocked.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        </Panel>
      )}

      {runs.length > 0 && (
        <Panel title="Sourcing runs">
          <ul className="divide-y divide-line-subtle">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/app/find-leads/runs/${run.id}`}
                  className="truncate text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
                >
                  {run.title || "Sourcing run"}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-[12px] text-content-muted">
                  Target {run.targetVerified.toLocaleString("en-GB")}
                  <Badge tone="neutral" dense>
                    {run.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Work queue">
        {rest.length === 0 ? (
          <EmptyState
            title="Nothing queued"
            description="Work appears here while the agent is running. Start it from the header when its plan is ready."
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {rest.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function QueueRow({ item }: { item: AgentQueueRow }) {
  const reason = item.blockedReason ?? item.errorMessage;

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-content">
          {item.subjectLabel || queueTypeLabel(item.itemType)}
        </p>
        {reason && (
          <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-content-muted">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-600" aria-hidden />
            {reason}
          </p>
        )}
      </div>
      <Badge tone={queueStatusTone(item.status)} dense dot>
        {item.status.toLowerCase().replace(/_/g, " ")}
      </Badge>
    </li>
  );
}

/* ----------------------------------------------------------------- sources */

export function SourcesTab({ sources }: { sources: AgentSourceRow[] }) {
  return (
    <Panel
      title="Sources"
      action={
        <Link
          href="/app/settings?view=connections"
          className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          Manage connections
        </Link>
      }
    >
      {/* Said once, plainly, on the surface where people expect to find
          "search LinkedIn": we use official routes only. */}
      <p className="mb-4 text-[12.5px] text-content-muted">
        ClientTurn only uses official APIs, licensed data and your own accounts. Social
        networks do not permit searching their members for prospecting, so LinkedIn and Meta
        appear here as inbound lead sources from advertising accounts you own.
      </p>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources configured"
          description="Add sources when you create or edit this agent. Without one, it has nowhere to look."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {sources.map((source) => {
            const definition = SOURCE_DEFINITIONS[source.sourceKey];
            return (
              <li key={source.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-content">
                      {definition?.label ?? source.sourceKey}
                    </p>
                    {definition && (
                      <p className="mt-0.5 text-[12px] text-content-muted">
                        {definition.description}
                      </p>
                    )}
                    <p className="mt-1 text-[11.5px] text-content-subtle">
                      {definition?.mechanism}
                    </p>
                    {(source.statusDetail || source.errorMessage) && (
                      <p className="mt-1 text-[12px] text-warning-700">
                        {source.errorMessage ?? source.statusDetail}
                      </p>
                    )}
                  </div>

                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={sourceStatusTone(source.status)} dense dot>
                      {source.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                    {!source.enabled && (
                      <Badge tone="neutral" dense>
                        off
                      </Badge>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- campaign */

export function CampaignTab({ agent }: { agent: AgentDetail["agent"] }) {
  return (
    <Panel title="Campaign and conversion">
      <p className="text-[12.5px] text-content-muted">
        Discovering a prospect never starts outreach on its own. Approved prospects join an
        acquisition campaign, where budgets, caps and contact rules are enforced server-side
        before anything is sent.
      </p>

      <dl className="mt-4 space-y-2 border-t border-line-subtle pt-3 text-[12.5px]">
        <Row
          label="Campaign"
          value={agent.campaignId ? "Linked" : "Not linked — prospects wait for review"}
        />
        <Row
          label="Conversion goal"
          value={agent.conversionGoalId ? "Set" : "Not set"}
        />
        <Row
          label="Promote automatically"
          value={agent.autoPromoteToLeads ? "Yes, when eligible" : "No — you promote manually"}
        />
      </dl>

      <div className="mt-4 flex flex-wrap gap-4 border-t border-line-subtle pt-3 text-[12.5px] font-medium text-content-accent">
        <Link href="/app/find-leads?view=campaigns" className="underline-offset-4 hover:underline">
          Acquisition campaigns
        </Link>
        <Link href="/app/follow-up" className="underline-offset-4 hover:underline">
          Booking and follow-up
        </Link>
        <Link href="/app/reactivation" className="underline-offset-4 hover:underline">
          Reactivation
        </Link>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- activity */

export function ActivityTab({ activity }: { activity: AgentActivityRow[] }) {
  return (
    <Panel title="Activity history">
      {activity.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Every configuration change and every run this agent makes is recorded here."
        />
      ) : (
        <ActivityList events={activity} />
      )}
    </Panel>
  );
}

function ActivityList({ events }: { events: AgentActivityRow[] }) {
  return (
    <ul className="divide-y divide-line-subtle">
      {events.map((event) => (
        <li key={event.id} className="py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-2">
              <Badge tone={severityTone(event.severity)} dense dot>
                {event.severity.toLowerCase()}
              </Badge>
              <span className="text-[13px] font-medium text-content">{event.title}</span>
            </span>
            <time
              dateTime={event.createdAt}
              className="text-[11.5px] tabular-nums text-content-subtle"
            >
              {new Date(event.createdAt).toLocaleString("en-GB")}
            </time>
          </div>
          {event.detail && (
            <p className="mt-1 text-[12.5px] text-content-muted">{event.detail}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- settings */

export function SettingsTab({
  agent,
  canManage,
  controls,
}: {
  agent: AgentDetail["agent"];
  canManage: boolean;
  controls: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <Panel title="Configuration">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Schedule" value={cadenceLabel(agent.cadence)} />
          <Field label="Approval" value={autonomyLabel(agent.autonomy)} />
          <Field
            label="Daily limit"
            value={`${agent.dailyProspectCap.toLocaleString("en-GB")} prospects`}
          />
          <Field
            label="Monthly limit"
            value={`${agent.monthlyProspectCap.toLocaleString("en-GB")} prospects`}
          />
          <Field label="Minimum grade" value={agent.minimumGrade} />
          <Field
            label="Email enrichment"
            value={agent.enrichEmail ? "On" : "Off"}
            hint={agent.verifyEmail ? "Addresses are verified before use" : undefined}
          />
          <Field
            label="Phone enrichment"
            value={agent.enrichPhone ? "On" : "Off"}
            hint="A found number does not grant permission to call or text it"
          />
          <Field
            label="Promote to Leads"
            value={agent.autoPromoteToLeads ? "Automatic when eligible" : "Manual"}
          />
        </dl>
      </Panel>

      {canManage && (
        <Panel title="Run state">
          <p className="mb-3 text-[12.5px] text-content-muted">
            Pause the agent before changing its plan in Find Leads. Changes take effect on the
            next run.
          </p>
          {controls}
        </Panel>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- shared */

function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-5 shadow-xs", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-content">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <p className="text-[12.5px] text-content-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[24px] font-semibold leading-none tabular-nums",
          tone === "warning" ? "text-warning-700" : "text-content",
        )}
      >
        {value.toLocaleString("en-GB")}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className="text-right font-medium text-content">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-content">{value}</dd>
      {hint && <p className="mt-0.5 text-[11.5px] text-content-subtle">{hint}</p>}
    </div>
  );
}
