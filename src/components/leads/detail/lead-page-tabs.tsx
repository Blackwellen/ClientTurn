import "server-only";
import * as React from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Bot,
  ClipboardList,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton, SkeletonTable } from "@/components/ui/feedback";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { METHOD_EVIDENCE } from "@/lib/sales-library/method-router";
import { salesMethodLabel, type SalesMethod } from "@/lib/sales-library/types";
import { getLeadCapabilities, getLeadDetail } from "@/lib/leads/queries";
import {
  loadActivity,
  loadAttribution,
  loadDataRightsHistory,
  loadLeadAi,
  loadQualification,
  loadScoreHistory,
  type TouchView,
} from "@/lib/leads/detail-queries";
import {
  leadPageHref,
  type ActionAvailability,
  type LeadPageAction,
  type LeadPageTab,
  type QualificationItem,
} from "@/lib/leads/detail-page";
import { LeadPageConversation } from "./lead-page-conversation";
import { LeadPageDataRights } from "./lead-page-data-rights";

/**
 * The lead page's tabs. Each is its own async server component inside a
 * Suspense boundary keyed by the tab, so only the tab being looked at is
 * loaded, and each owns its three states: a skeleton while it loads, an
 * empty state that says what would fill it, and an error state that says
 * the read failed rather than pretending there is nothing.
 */

type TabProps = { businessId: string; leadId: string };

async function attempt<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.error("[lead page] tab failed to load", error);
    return { ok: false };
  }
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface shadow-xs">{children}</div>;
}

export function TabError({ leadId, tab, what }: { leadId: string; tab: LeadPageTab; what: string }) {
  return (
    <Panel>
      <ErrorState
        title={`${what} could not be loaded`}
        description="This is usually temporary, and nothing about the lead has changed."
      />
      <p className="pb-6 text-center">
        <Link
          href={leadPageHref(leadId, tab)}
          className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          Try again
        </Link>
      </p>
    </Panel>
  );
}

export function TabSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="rounded-xl border border-line bg-surface shadow-xs">
      <div className="border-b border-line-subtle px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <SkeletonTable rows={rows} />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center gap-2 border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-[14px] font-semibold text-content">{title}</h2>
        {count !== undefined && <span className="text-[12px] tabular-nums text-content-subtle">{count}</span>}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------ conversation */

export async function ConversationTab({ businessId, leadId, canWrite }: TabProps & { canWrite: boolean }) {
  const result = await attempt(() =>
    Promise.all([getLeadDetail(businessId, leadId), getLeadCapabilities(businessId)]),
  );
  if (!result.ok) return <TabError leadId={leadId} tab="conversation" what="The conversation" />;
  const [detail, capabilities] = result.data;
  if (!detail) return <TabError leadId={leadId} tab="conversation" what="The conversation" />;

  return (
    <div className="space-y-3">
      {!capabilities.sms && !capabilities.whatsapp && canWrite && (
        <p className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-[12.5px] text-warning-700">
          No SMS or WhatsApp sender is connected, so messages cannot be sent from here yet.{" "}
          <Link href={capabilities.messagingSetupHref} className="font-medium underline underline-offset-2">
            Connect one in Settings
          </Link>
          .
        </p>
      )}
      <LeadPageConversation detail={detail} capabilities={capabilities} canWrite={canWrite} />
    </div>
  );
}

/* ----------------------------------------------------------- qualification */

function QualificationList({ items, inferred }: { items: QualificationItem[]; inferred?: boolean }) {
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => (
        <li key={item.key} className="px-4 py-3">
          <p className="text-[12px] font-medium text-content-secondary">{item.question}</p>
          <p className="mt-0.5 text-[13.5px] text-content">{item.value}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-content-muted">
            <Badge tone={inferred ? "warning" : "neutral"} dense>
              {item.sourceLabel}
            </Badge>
            {item.evaluation && item.evaluation !== "not_evaluated" && (
              <span>Rule result: {item.evaluation.replace(/_/g, " ")}</span>
            )}
            {item.confidence !== null && item.confidence < 1 && (
              <span>{Math.round(item.confidence * 100)}% confidence</span>
            )}
            {item.at && <span>{formatRelative(item.at)}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function QualificationTab({ businessId, leadId }: TabProps) {
  const result = await attempt(() => loadQualification(businessId, leadId));
  if (!result.ok) return <TabError leadId={leadId} tab="qualification" what="Qualification" />;
  const { known, inferred, missing } = result.data;

  if (known.length + inferred.length + missing.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={ClipboardList}
          title="No qualification questions yet"
          description="Add the questions you qualify leads on, and each lead's answers appear here."
          action={
            <Link
              href="/app/follow-up?view=qualification"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Set up qualification
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="Known" count={known.length}>
        {known.length ? (
          <QualificationList items={known} />
        ) : (
          <p className="px-4 py-5 text-[12.5px] text-content-muted">Nothing the lead has told us yet.</p>
        )}
      </Section>
      <Section title="Inferred" count={inferred.length}>
        {inferred.length ? (
          <QualificationList items={inferred} inferred />
        ) : (
          <p className="px-4 py-5 text-[12.5px] text-content-muted">
            Nothing inferred. Inferred values are shown separately so they are never mistaken for an answer.
          </p>
        )}
      </Section>
      <Section title="Missing" count={missing.length}>
        {missing.length ? (
          <ul className="divide-y divide-line-subtle">
            {missing.map((item) => (
              <li key={item.questionId} className="flex items-start justify-between gap-2 px-4 py-3">
                <span className="text-[13px] text-content">{item.question}</span>
                {item.required && (
                  <Badge tone="warning" dense>
                    Required
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-[12.5px] text-content-muted">Every active question has an answer.</p>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------------------------------------- score history */

export async function ScoreHistoryTab({ businessId, leadId }: TabProps) {
  const result = await attempt(() => loadScoreHistory(businessId, leadId));
  if (!result.ok) return <TabError leadId={leadId} tab="scores" what="Score history" />;
  const rows = result.data;

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={BarChart3}
          title="Not scored yet"
          description="A lead is scored when it arrives and again whenever something about it changes. Use Re-score to score it now."
        />
      </Panel>
    );
  }

  return (
    <Section title="Score history" count={rows.length}>
      <ol className="divide-y divide-line-subtle">
        {rows.map((row, index) => {
          const previous = rows[index + 1];
          const delta = previous ? row.total - previous.total : null;
          return (
            <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <StatusBadge kind="lead_grade" value={row.grade} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-content">
                  <span className="font-semibold tabular-nums">{Math.round(row.total)}</span>
                  <span className="text-content-muted"> / 100</span>
                  {delta !== null && Math.round(delta) !== 0 && (
                    <span className={delta > 0 ? "ml-2 text-success-700" : "ml-2 text-danger-700"}>
                      {delta > 0 ? "+" : ""}
                      {Math.round(delta)}
                    </span>
                  )}
                  {row.isCurrent && (
                    <Badge tone="accent" dense className="ml-2">
                      Current
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[12.5px] text-content-secondary">{row.why}</p>
                <p className="mt-1 text-[11.5px] text-content-subtle">
                  {formatDateTime(row.createdAt)} · triggered by {row.trigger.split(":")[0].replace(/[._]/g, " ")} ·{" "}
                  {Math.round(row.confidence * 100)}% confidence · engine {row.scoringVersion}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------- attribution */

function TouchLine({ touch }: { touch: TouchView }) {
  const parts = [touch.campaign, touch.form, touch.ad, touch.utm].filter(Boolean);
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-content">
        {touch.provider} <span className="font-normal text-content-muted">· {touch.sourceType.replace(/_/g, " ").toLowerCase()}</span>
      </p>
      {parts.length > 0 && <p className="truncate text-[12px] text-content-secondary">{parts.join(" · ")}</p>}
      <p className="text-[11.5px] text-content-subtle">
        {formatDateTime(touch.occurredAt)}
        {touch.outcome !== "CREATED" && ` · ${touch.outcome.toLowerCase()}`}
      </p>
    </div>
  );
}

export async function AttributionTab({ businessId, leadId }: TabProps) {
  const result = await attempt(() => loadAttribution(businessId, leadId));
  if (!result.ok) return <TabError leadId={leadId} tab="attribution" what="Attribution" />;
  const { touches, first, last } = result.data;

  if (touches.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={MapPin}
          title="No recorded touches"
          description="Touches are recorded as a lead arrives through a source. This lead arrived before touch tracking, or was added without one."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="First touch">
          <div className="px-4 py-3">{first && <TouchLine touch={first} />}</div>
        </Section>
        <Section title="Last touch">
          <div className="px-4 py-3">{last && <TouchLine touch={last} />}</div>
        </Section>
      </div>
      <Section title="Every touch" count={touches.length}>
        <ol className="divide-y divide-line-subtle">
          {touches.map((touch) => (
            <li key={touch.id} className="px-4 py-3">
              <TouchLine touch={touch} />
              {(touch.landingUrl || touch.referrer) && (
                <p className="mt-1 truncate text-[11.5px] text-content-subtle">
                  {touch.landingUrl ? `Landed on ${touch.landingUrl}` : `Referred by ${touch.referrer}`}
                </p>
              )}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- activity */

const KIND_LABEL = { AUDIT: "Audit", EVENT: "Event", NOTE: "Note" } as const;
const KIND_TONE = { AUDIT: "neutral", EVENT: "info", NOTE: "accent" } as const;

export async function ActivityTab({ businessId, leadId }: TabProps) {
  const result = await attempt(() => loadActivity(businessId, leadId));
  if (!result.ok) return <TabError leadId={leadId} tab="activity" what="Activity" />;
  const rows = result.data;

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Activity}
          title="No activity recorded yet"
          description="Every change to this lead, by a person, an assistant or ClientTurn itself, is recorded here."
        />
      </Panel>
    );
  }

  return (
    <Section title="Activity and audit" count={rows.length}>
      <ol className="divide-y divide-line-subtle">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 px-4 py-3">
            <Badge tone={KIND_TONE[row.kind]} dense className="mt-0.5">
              {KIND_LABEL[row.kind]}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-content">
                {row.label}
                {row.actor && <span className="text-content-muted"> · {row.actor}</span>}
              </p>
              {row.detail && (
                <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-content-secondary">{row.detail}</p>
              )}
              <p className="mt-0.5 text-[11.5px] text-content-subtle">{formatDateTime(row.at)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ---------------------------------------------------------------------- AI */

function usd(value: number) {
  return `$${value.toFixed(value < 0.01 && value > 0 ? 4 : 2)}`;
}

export async function AiTab({ businessId, leadId }: TabProps) {
  const result = await attempt(() => loadLeadAi(businessId, leadId));
  if (!result.ok) return <TabError leadId={leadId} tab="ai" what="AI activity" />;
  const { agentRuns, aiRuns, totalCostUsd } = result.data;

  if (agentRuns.length === 0 && aiRuns.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Bot}
          title="No AI has worked on this lead"
          description="When the assistant replies, classifies a message or extracts an answer for this lead, each run and its cost appears here."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-content-secondary">
        <span className="font-semibold text-content">{usd(totalCostUsd)}</span> estimated AI cost on this lead
        across {aiRuns.length} {aiRuns.length === 1 ? "call" : "calls"}, as metered in US dollars at the
        provider&apos;s list price.
      </p>

      <Section title="Assistant turns" count={agentRuns.length}>
        {agentRuns.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-content-muted">The conversation assistant has not handled this lead.</p>
        ) : (
          <ol className="divide-y divide-line-subtle">
            {agentRuns.map((run) => (
              <li key={run.id} className="px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-content">
                  <Badge tone={run.status.toUpperCase() === "FAILED" ? "danger" : "neutral"} dense>
                    {run.status.toLowerCase()}
                  </Badge>
                  {run.outcome && <span>{run.outcome.replace(/_/g, " ").toLowerCase()}</span>}
                  {run.intent && <span className="text-content-muted">· intent {run.intent.toLowerCase()}</span>}
                  <span className="text-content-muted">· {usd(run.costUsd)}</span>
                </p>
                {run.method && (
                  <p className="mt-1 text-[12.5px] text-content-secondary">
                    Method: <span className="font-medium">{salesMethodLabel(run.method)}</span>
                    {run.methodReason && ` — ${run.methodReason}`}
                    <span className="ml-1 text-[11.5px] text-content-subtle">
                      (
                      {(METHOD_EVIDENCE[run.method as SalesMethod]?.grade ?? run.evidenceGrade ?? "ungraded")
                        .replace(/_/g, " ")
                        .toLowerCase()}
                      ; internal heuristic)
                    </span>
                  </p>
                )}
                <p className="mt-0.5 text-[11.5px] text-content-subtle">
                  {formatDateTime(run.at)}
                  {run.model && ` · ${run.model}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="AI calls" count={aiRuns.length}>
        {aiRuns.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-content-muted">No metered AI calls for this lead.</p>
        ) : (
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11.5px] text-content-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 text-right font-medium">Tokens</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {aiRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-2 text-content">
                    {run.task.replace(/_/g, " ")}
                    {run.status !== "ok" && (
                      <span className="ml-1 text-content-muted">({run.status.toLowerCase()})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-content-muted">{formatRelative(run.at)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{run.tokens.toLocaleString("en-GB")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(run.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------- data rights */

const RIGHTS_LABEL: Record<string, string> = {
  ARCHIVE: "Archived",
  SUPPRESS: "Suppressed",
  ANONYMISE: "Anonymised",
  DELETE: "Erased",
  EXPORT: "Exported",
  RESTRICT: "Processing restricted",
  RECTIFY: "Corrected",
};

export async function DataRightsTab({
  businessId,
  leadId,
  availability,
}: TabProps & { availability: Record<LeadPageAction, ActionAvailability> }) {
  const result = await attempt(() => loadDataRightsHistory(businessId, leadId));

  return (
    <div className="space-y-4">
      <Section title="Data rights">
        <div className="space-y-3 px-4 py-4">
          <p className="text-[12.5px] text-content-muted">
            Suppress stops contact and keeps everything. Anonymise removes the person&apos;s details and keeps the
            record. Erase removes the record and keeps only pseudonymous billing and audit rows and a hashed
            do-not-contact entry. Each is recorded below.
          </p>
          <LeadPageDataRights leadId={leadId} availability={availability} />
        </div>
      </Section>

      {!result.ok ? (
        <TabError leadId={leadId} tab="data-rights" what="The data-rights history" />
      ) : result.data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ShieldCheck}
            title="No data-rights actions yet"
            description="Nothing has been suppressed, exported, restricted or anonymised for this lead."
          />
        </Panel>
      ) : (
        <Section title="History" count={result.data.length}>
          <ol className="divide-y divide-line-subtle">
            {result.data.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <p className="text-[13px] text-content">
                  {RIGHTS_LABEL[row.action] ?? row.action}
                  {row.by && <span className="text-content-muted"> · {row.by}</span>}
                  {row.caller && row.caller !== "UI" && <span className="text-content-muted"> via {row.caller}</span>}
                </p>
                {row.reason && <p className="text-[12.5px] text-content-secondary">{row.reason}</p>}
                <p className="text-[11.5px] text-content-subtle">{formatDateTime(row.at)}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
