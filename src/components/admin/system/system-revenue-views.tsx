import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Copy,
  Cpu,
  Gauge,
  Hourglass,
  ScrollText,
} from "lucide-react";
import type {
  AdminLoad,
  AiSpendData,
  AuditActorFilter,
  AuditLogRow,
  DomainEventListRow,
  DomainEventState,
  MergeCandidateRow,
  QuotaData,
  StuckLeadRow,
} from "@/lib/admin/revenue-ops";
import {
  AUDIT_ACTOR_FILTERS,
  DOMAIN_EVENT_STATES,
} from "@/lib/admin/revenue-ops";
import {
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  type AdminRange,
} from "@/lib/admin/types";
import {
  formatNumber,
  titleise,
} from "@/lib/admin/format";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { Badge, StatusBadge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { MergeCandidateActions } from "./merge-candidate-actions";
import { RelativeTime } from "@/components/admin/relative-time";

/**
 * The revenue-engine views inside Admin -> System (design doc 05, Phase 5):
 * Lead ops (stuck leads, duplicate queue), AI spend (per workspace per task,
 * provider quota usage), Domain events and the Audit log.
 *
 * Server components: filters are plain links that rewrite the query string, so
 * every view is shareable and nothing here holds client state except the merge
 * actions, which go through the guarded server actions.
 */

/** ai_runs and cost_events price in USD; the admin GBP formatters would mislabel them. */
const USD = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const usd = (value: number) => USD.format(value);

function Unavailable({ message }: { message: string }) {
  return (
    <p className="text-content-muted flex items-center justify-center gap-2 px-5 py-10 text-center text-[13px]">
      <AlertTriangle className="text-warning-600 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "border-accent-500 bg-surface text-content shadow-xs"
          : "border-line text-content-muted hover:text-content",
      )}
    >
      {children}
    </Link>
  );
}

function href(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "")
      search.set(key, String(value));
  }
  return `/admin/system?${search.toString()}`;
}

function Pager({
  page,
  pageSize,
  total,
  base,
}: {
  page: number;
  pageSize: number;
  total: number;
  base: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="border-line-subtle text-content-muted flex items-center justify-between border-t px-5 py-2.5 text-[12px]">
      <span>
        {formatNumber(total)} total · page {page} of {pages}
      </span>
      <span className="flex gap-1.5">
        {page > 1 && (
          <FilterLink href={href({ ...base, page: page - 1 })} active={false}>
            Previous
          </FilterLink>
        )}
        {page < pages && (
          <FilterLink href={href({ ...base, page: page + 1 })} active={false}>
            Next
          </FilterLink>
        )}
      </span>
    </div>
  );
}

function RangeFilter({
  range,
  base,
}: {
  range: AdminRange;
  base: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {ADMIN_RANGES.map((option) => (
        <FilterLink
          key={option}
          href={href({ ...base, range: option })}
          active={option === range}
        >
          {ADMIN_RANGE_LABEL[option]}
        </FilterLink>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ lead ops */

export function SystemLeadOpsView({
  stuck,
  candidates,
  mergeStatus,
}: {
  stuck: AdminLoad<StuckLeadRow[]>;
  candidates: AdminLoad<MergeCandidateRow[]>;
  mergeStatus: "OPEN" | "MERGED" | "DISMISSED";
}) {
  return (
    <div className="space-y-5">
      <Panel
        icon={Hourglass}
        tone="warning"
        title="Stuck leads"
        description="Engaged and still contactable, with nothing done for them for 48 hours. Oldest first."
      >
        {stuck.status !== "ok" ? (
          <Unavailable message={stuck.message} />
        ) : stuck.data.length === 0 ? (
          <PanelEmpty>
            No lead has gone 48 hours without action after replying.
          </PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Replied</TableHead>
                  <TableHead>Last outbound</TableHead>
                  <TableHead>Last inbound</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stuck.data.map((row) => (
                  <TableRow key={row.leadId}>
                    <TableCell>
                      {row.name}
                      {row.humanTakeover && (
                        <Badge dense tone="info" className="ml-2">
                          person handling
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{row.businessName}</TableCell>
                    <TableCell>
                      <StatusBadge kind="lead" value={row.status} dense />
                    </TableCell>
                    <TableCell><RelativeTime value={row.firstRepliedAt} options={{ style: "ago" }} /></TableCell>
                    <TableCell>
                      {row.lastOutboundAt
                        ? formatRelative(row.lastOutboundAt, { style: "ago" })
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      {row.lastInboundAt
                        ? formatRelative(row.lastInboundAt, { style: "ago" })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel
        icon={Copy}
        tone="info"
        title="Duplicate queue"
        description="Possible duplicates the intake path would not merge on its own. Merges are recorded and can be undone."
        action={
          <div className="flex gap-1">
            {(["OPEN", "MERGED", "DISMISSED"] as const).map((option) => (
              <FilterLink
                key={option}
                href={href({ view: "lead-ops", merge: option })}
                active={option === mergeStatus}
              >
                {titleise(option.toLowerCase())}
              </FilterLink>
            ))}
          </div>
        }
      >
        {candidates.status !== "ok" ? (
          <Unavailable message={candidates.message} />
        ) : candidates.data.length === 0 ? (
          <PanelEmpty>
            {mergeStatus === "OPEN"
              ? "No possible duplicates waiting for a decision."
              : "Nothing here yet."}
          </PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Record A</TableHead>
                  <TableHead>Record B</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.leadA ? (
                        <span>
                          {row.leadA.name}
                          <span className="text-content-subtle block text-[11.5px]">
                            {row.leadA.email ?? "no email"}
                          </span>
                        </span>
                      ) : (
                        "Removed lead"
                      )}
                    </TableCell>
                    <TableCell>
                      {row.leadB ? (
                        <span>
                          {row.leadB.name}
                          <span className="text-content-subtle block text-[11.5px]">
                            {row.leadB.email ?? "no email"}
                          </span>
                        </span>
                      ) : row.prospectId ? (
                        "Sourced prospect"
                      ) : (
                        "Removed lead"
                      )}
                    </TableCell>
                    <TableCell>
                      {titleise(row.reason.toLowerCase().replace(/_/g, " "))}
                    </TableCell>
                    <TableCell>{row.businessName}</TableCell>
                    <TableCell>
                      <StatusBadge
                        kind="merge_candidate"
                        value={row.status}
                        dense
                      />
                    </TableCell>
                    <TableCell align="right">
                      <MergeCandidateActions
                        candidateId={row.id}
                        status={row.status}
                        leadA={row.leadA}
                        leadB={row.leadB}
                        undoableMergeEventId={row.undoableMergeEventId}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ AI spend */

export function SystemAiSpendView({
  spend,
  quotas,
  range,
}: {
  spend: AdminLoad<AiSpendData>;
  quotas: AdminLoad<QuotaData>;
  range: AdminRange;
}) {
  const base = { view: "ai-spend" };
  return (
    <div className="space-y-5">
      <RangeFilter range={range} base={base} />
      <Panel
        icon={Cpu}
        tone="accent"
        title="AI spend by workspace and task"
        description="Priced from ai_runs; refusals are the budget manager's SKIP and HUMAN decisions."
        action={
          spend.status === "ok" ? (
            <span className="text-content text-[13px] font-semibold">
              {usd(spend.data.totalCostUsd)}
            </span>
          ) : undefined
        }
      >
        {spend.status !== "ok" ? (
          <Unavailable message={spend.message} />
        ) : spend.data.rows.length === 0 ? (
          <PanelEmpty>No AI calls in this period.</PanelEmpty>
        ) : (
          <>
            {Object.keys(spend.data.decisions).length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-5 pb-3">
                {Object.entries(spend.data.decisions).map(([decision, n]) => (
                  <span
                    key={decision}
                    className="inline-flex items-center gap-1"
                  >
                    <StatusBadge kind="spend_decision" value={decision} dense />
                    <span className="text-content-muted text-[12px]">
                      {formatNumber(n)}
                    </span>
                  </span>
                ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead align="right">Calls</TableHead>
                    <TableHead align="right">Tokens</TableHead>
                    <TableHead align="right">Cost (USD)</TableHead>
                    <TableHead align="right">Refused</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spend.data.rows.map((row) => (
                    <TableRow key={`${row.businessId}|${row.taskType}`}>
                      <TableCell>{row.businessName}</TableCell>
                      <TableCell>{row.taskType}</TableCell>
                      <TableCell align="right" numeric>
                        {formatNumber(row.runs)}
                      </TableCell>
                      <TableCell align="right" numeric>
                        {formatNumber(row.tokens)}
                      </TableCell>
                      <TableCell align="right" numeric>
                        {usd(row.costUsd)}
                      </TableCell>
                      <TableCell align="right" numeric>
                        {row.refused ? formatNumber(row.refused) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {spend.data.truncated && (
              <p className="text-content-subtle px-5 py-2 text-[12px]">
                Only the first 20,000 calls are summed; narrow the range for
                exact totals.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        icon={Gauge}
        tone="info"
        title="Provider quota usage"
        description="Mailbox daily send caps are the quotas the product enforces. Other providers' volume is shown without a ceiling, because none is recorded."
      >
        {quotas.status !== "ok" ? (
          <Unavailable message={quotas.message} />
        ) : (
          <div className="grid gap-4 px-0 pb-2 lg:grid-cols-2">
            <div className="overflow-x-auto">
              {quotas.data.senders.length === 0 ? (
                <PanelEmpty>No active sending mailboxes.</PanelEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sender</TableHead>
                      <TableHead align="right">Today / cap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotas.data.senders.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          {s.email}
                          <span className="text-content-subtle block text-[11.5px]">
                            {s.businessName}
                          </span>
                        </TableCell>
                        <TableCell align="right" numeric>
                          <span
                            className={cn(
                              s.sentToday >= s.cap &&
                                "text-danger-600 font-semibold",
                            )}
                          >
                            {formatNumber(s.sentToday)} / {formatNumber(s.cap)}
                          </span>
                          {s.paused && (
                            <Badge dense tone="warning" className="ml-2">
                              paused
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <div className="overflow-x-auto">
              {quotas.data.providerVolume.length === 0 ? (
                <PanelEmpty>No provider cost events in this period.</PanelEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Metric</TableHead>
                      <TableHead align="right">Volume</TableHead>
                      <TableHead align="right">Cost (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotas.data.providerVolume.map((v) => (
                      <TableRow key={`${v.provider}|${v.metric}`}>
                        <TableCell>{v.provider}</TableCell>
                        <TableCell>{v.metric}</TableCell>
                        <TableCell align="right" numeric>
                          {formatNumber(v.quantity)}
                        </TableCell>
                        <TableCell align="right" numeric>
                          {usd(v.costUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- domain events */

export function SystemDomainEventsView({
  result,
  filters,
}: {
  result: AdminLoad<{
    rows: DomainEventListRow[];
    total: number;
    types: string[];
  }>;
  filters: {
    type: string;
    state: DomainEventState;
    range: AdminRange;
    page: number;
    pageSize: number;
  };
}) {
  const base = {
    view: "domain-events",
    type: filters.type,
    state: filters.state,
    range: filters.range,
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <RangeFilter range={filters.range} base={base} />
        <div className="flex flex-wrap gap-1">
          {DOMAIN_EVENT_STATES.map((state) => (
            <FilterLink
              key={state}
              href={href({ ...base, state })}
              active={state === filters.state}
            >
              {titleise(state)}
            </FilterLink>
          ))}
        </div>
      </div>
      <Panel
        icon={Activity}
        tone="accent"
        title="Domain events"
        description="The outbox: every business event, whether it has been fanned out to webhooks, automations and re-scoring, and any dispatch error."
      >
        {result.status !== "ok" ? (
          <Unavailable message={result.message} />
        ) : (
          <>
            <div className="flex flex-wrap gap-1 px-5 pb-3">
              <FilterLink
                href={href({ ...base, type: "all" })}
                active={filters.type === "all"}
              >
                All types
              </FilterLink>
              {result.data.types.map((type) => (
                <FilterLink
                  key={type}
                  href={href({ ...base, type })}
                  active={filters.type === type}
                >
                  {type}
                </FilterLink>
              ))}
            </div>
            {result.data.rows.length === 0 ? (
              <PanelEmpty>No events match these filters.</PanelEmpty>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Occurred</TableHead>
                      <TableHead>Dispatch</TableHead>
                      <TableHead>Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-[12px]">
                          {row.type}
                          {row.causationDepth > 0 && (
                            <span className="text-content-subtle ml-1 text-[11px]">
                              depth {row.causationDepth}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{row.businessName}</TableCell>
                        <TableCell className="text-[12px]">
                          {row.subjectType}
                          <span className="text-content-subtle block font-mono text-[11px]">
                            {row.subjectId?.slice(0, 8) ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>{formatDateTime(row.occurredAt, { year: true })}</TableCell>
                        <TableCell>
                          {row.dispatchError ? (
                            <Badge
                              dense
                              tone="danger"
                              title={row.dispatchError}
                            >
                              failed
                            </Badge>
                          ) : row.dispatchedAt ? (
                            <Badge dense tone="success">
                              dispatched
                            </Badge>
                          ) : (
                            <Badge dense tone="warning">
                              pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <details>
                            <summary className="text-content-muted cursor-pointer text-[12px]">
                              View
                            </summary>
                            <pre className="bg-surface-sunken mt-1 max-w-[420px] overflow-x-auto rounded p-2 text-[11px]">
                              {JSON.stringify(row.payload, null, 2)}
                            </pre>
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <Pager
              page={filters.page}
              pageSize={filters.pageSize}
              total={result.data.total}
              base={base}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- audit log */

export function SystemAuditView({
  result,
  filters,
}: {
  result: AdminLoad<{ rows: AuditLogRow[]; total: number }>;
  filters: {
    action: string;
    actor: AuditActorFilter;
    range: AdminRange;
    page: number;
    pageSize: number;
  };
}) {
  const base = {
    view: "audit",
    action: filters.action,
    actor: filters.actor,
    range: filters.range,
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <RangeFilter range={filters.range} base={base} />
        <div className="flex flex-wrap gap-1">
          {AUDIT_ACTOR_FILTERS.map((actor) => (
            <FilterLink
              key={actor}
              href={href({ ...base, actor })}
              active={actor === filters.actor}
            >
              {actor === "all"
                ? "All actors"
                : titleise(actor.replace(/_/g, " "))}
            </FilterLink>
          ))}
        </div>
        <form action="/admin/system" className="flex items-center gap-1.5">
          <input type="hidden" name="view" value="audit" />
          <input type="hidden" name="actor" value={filters.actor} />
          <input type="hidden" name="range" value={filters.range} />
          <input
            name="action"
            defaultValue={filters.action}
            placeholder="Action prefix, e.g. admin."
            aria-label="Filter by action prefix"
            className="border-line bg-surface h-7 w-56 rounded-md border px-2 text-[12px]"
          />
        </form>
      </div>
      <Panel
        icon={ScrollText}
        tone="neutral"
        title="Audit log"
        description="Append-only record of every write, by whom and through which caller. Credential-like values are redacted."
      >
        {result.status !== "ok" ? (
          <Unavailable message={result.message} />
        ) : result.data.rows.length === 0 ? (
          <PanelEmpty>No audit entries match these filters.</PanelEmpty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(row.createdAt, { year: true })}
                      </TableCell>
                      <TableCell className="font-mono text-[12px]">
                        {row.action}
                      </TableCell>
                      <TableCell className="text-[12px]">
                        {titleise(row.actorType.replace(/_/g, " "))}
                        <span className="text-content-subtle block font-mono text-[11px]">
                          {row.actorUserId?.slice(0, 8) ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>{row.businessName ?? "Platform"}</TableCell>
                      <TableCell className="text-[12px]">
                        {row.entityType ?? "—"}
                        <span className="text-content-subtle block font-mono text-[11px]">
                          {row.entityId?.slice(0, 8) ?? ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        {Object.keys(row.metadata).length === 0 ? (
                          "—"
                        ) : (
                          <details>
                            <summary className="text-content-muted cursor-pointer text-[12px]">
                              View
                            </summary>
                            <pre className="bg-surface-sunken mt-1 max-w-[420px] overflow-x-auto rounded p-2 text-[11px]">
                              {JSON.stringify(row.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pager
              page={filters.page}
              pageSize={filters.pageSize}
              total={result.data.total}
              base={base}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
