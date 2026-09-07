"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Drawer, DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { IconTile, ProviderMark } from "@/components/admin/ui";
import { formatDateTime, formatRelative } from "@/lib/admin/format";
import {
  JOB_PRIORITY_LABEL,
  JOB_PRIORITY_TONE,
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  type JobDetail,
} from "@/lib/admin/jobs-types";

const TABS = ["Overview", "Logs", "Payload", "Related", "Actions"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-words text-content">
        {children}
      </dd>
    </div>
  );
}

/**
 * The job drawer. Retry is deliberately *not* a one-click affordance in the
 * table: it lives here, under the failure reason and the safety check, because
 * the operator needs to have read both before they decide.
 */
export function JobDetailDrawer({
  job,
  pending,
  onClose,
  onRetry,
  onCancel,
  onDeadLetter,
}: {
  job: JobDetail;
  pending: string | null;
  onClose: () => void;
  onRetry: (jobId: string, confirmUnverifiable?: boolean) => void;
  onCancel: (jobId: string) => void;
  onDeadLetter: (jobId: string) => void;
}) {
  // Mounted under `key={job.id}`, so opening a different job remounts this
  // component. That is what guarantees a new job can never inherit the previous
  // one's accepted-repeat checkbox — a reset effect would run a render too late.
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [acceptedRepeat, setAcceptedRepeat] = React.useState(false);

  const retryDisabled =
    !job.retryable ||
    job.retryBlockedReason !== null ||
    (job.requiresUnverifiableConfirmation && !acceptedRepeat) ||
    pending === `retry:${job.id}`;

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={job.shortId}
      header={
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="lr-tabular truncate text-[16px] font-semibold text-content">
              {job.shortId}
            </h2>
            <Badge tone={JOB_STATUS_TONE[job.status]} dot>
              {JOB_STATUS_LABEL[job.status]}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-content-muted">
            <span className="font-medium text-content-secondary">{job.typeLabel}</span>
            <span className="flex items-center gap-1.5">
              <ProviderMark provider={job.provider} />
              {job.providerLabel}
            </span>
            <Badge tone={JOB_PRIORITY_TONE[job.priorityBand]} className="px-2">
              {JOB_PRIORITY_LABEL[job.priorityBand]} priority
            </Badge>
            <span>Created {formatDateTime(job.createdAt)}</span>
          </div>
        </div>
      }
      footer={
        <DrawerFooter className="gap-2">
          <Button
            onClick={() => onRetry(job.id, acceptedRepeat || undefined)}
            disabled={retryDisabled}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Retry job
          </Button>
          <Button
            variant="secondary"
            onClick={() => onCancel(job.id)}
            disabled={!job.cancellable || pending === `cancel:${job.id}`}
            className="gap-1.5"
          >
            <Ban className="size-3.5" aria-hidden />
            Cancel job
          </Button>
          <Button
            variant="ghost"
            onClick={() => onDeadLetter(job.id)}
            disabled={job.status !== "FAILED" || pending === `dlq:${job.id}`}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Move to DLQ
          </Button>
        </DrawerFooter>
      }
    >
      <div className="border-b border-line px-5">
        <div role="tablist" aria-label="Job detail" className="flex gap-1 overflow-x-auto">
          {TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                tab === option
                  ? "border-accent-500 text-content-accent"
                  : "border-transparent text-content-muted hover:text-content",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <DrawerBody className="space-y-4">
        {tab === "Overview" && (
          <>
            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-1 text-[13px] font-semibold text-content">Job details</h3>
              <dl className="divide-y divide-line-subtle">
                <Row label="Job ID">
                  <span className="lr-tabular">{job.shortId}</span>
                </Row>
                <Row label="Type">{job.typeLabel}</Row>
                <Row label="Provider">{job.providerLabel}</Row>
                <Row label="Status">{JOB_STATUS_LABEL[job.status]}</Row>
                <Row label="Priority">
                  {JOB_PRIORITY_LABEL[job.priorityBand]} ({job.priority})
                </Row>
                <Row label="Attempts">
                  <span className="lr-tabular">
                    {job.attempts} / {job.maxAttempts}
                  </span>
                </Row>
                <Row label="Created at">{formatDateTime(job.createdAt)}</Row>
                <Row label="Due at">{formatDateTime(job.runAt)}</Row>
                <Row label="Started at">
                  {job.startedAt ? formatDateTime(job.startedAt) : "Not started"}
                </Row>
                <Row label="Queue">{job.queue}</Row>
                <Row label="Worker">{job.worker ?? "—"}</Row>
                <Row label="Action key">
                  <span className="lr-tabular break-all">
                    {job.actionKey ?? "Not deduplicated"}
                  </span>
                </Row>
                {job.businessId && (
                  <Row label="Customer">
                    <Link
                      href={`/admin/customers?customer=${job.businessId}`}
                      className="text-content-accent underline-offset-2 hover:underline"
                    >
                      {job.businessName ?? "View customer"}
                    </Link>
                  </Row>
                )}
              </dl>
            </section>

            {job.lastError && (
              <section className="rounded-xl border border-danger-100 bg-danger-50 p-4">
                <div className="flex items-start gap-2.5">
                  <IconTile icon={AlertTriangle} tone="danger" />
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-danger-700">
                      Failure reason
                    </h3>
                    <p className="mt-1 text-[12.5px] break-words text-danger-700/90">
                      {job.lastError}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/*
              The safety check is shown before the operator can reach the Retry
              button, not beside it. It is the whole reason retrying a job in
              this product is a considered action rather than a shortcut.
            */}
            <section className="rounded-xl border border-line bg-surface-sunken p-4">
              <div className="flex items-start gap-2.5">
                <IconTile icon={ShieldCheck} tone="success" />
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-content">Safety check</h3>
                  <p className="mt-1 text-[12.5px] text-content-secondary">
                    {job.safetyNote}
                  </p>
                  {job.retryBlockedReason && (
                    <p className="mt-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
                      {job.retryBlockedReason}
                    </p>
                  )}
                  {job.requiresUnverifiableConfirmation && !job.retryBlockedReason && (
                    <label className="mt-2.5 flex items-start gap-2 text-[12.5px] text-content-secondary">
                      <Checkbox
                        checked={acceptedRepeat}
                        onChange={(event) => setAcceptedRepeat(event.target.checked)}
                      />
                      <span>
                        I accept that retrying may repeat this side effect, and that
                        the platform cannot confirm the original attempt failed.
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </section>

            {job.attemptHistory.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-line bg-surface">
                <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-content">
                  Recent attempts
                </h3>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-surface-sunken/60">
                      {["#", "Status", "Started", "Error"].map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {job.attemptHistory.map((attempt) => (
                      <tr key={attempt.index}>
                        <td className="lr-tabular px-4 py-2 text-[12.5px] text-content-muted">
                          {attempt.index}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            tone={
                              attempt.status === "Failed"
                                ? "danger"
                                : attempt.status === "Completed"
                                  ? "success"
                                  : "info"
                            }
                            dot
                          >
                            {attempt.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                          {attempt.startedAt ? formatRelative(attempt.startedAt) : "—"}
                        </td>
                        <td className="px-4 py-2 text-[12px] text-content-secondary">
                          {attempt.error ?? "Not recorded for this attempt"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}

        {tab === "Logs" && (
          <ol className="space-y-2.5">
            {job.logLines.map((line, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    line.level === "error"
                      ? "bg-danger-500"
                      : line.level === "warn"
                        ? "bg-warning-500"
                        : "bg-content-subtle",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[12.5px] break-words text-content">{line.message}</p>
                  <p className="lr-tabular text-[11.5px] text-content-subtle">
                    {formatDateTime(line.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {tab === "Payload" && (
          <>
            <p className="text-[12px] text-content-muted">
              Credential-shaped keys are removed on the server before this payload
              leaves it, at every depth.
            </p>
            <pre className="max-h-[420px] overflow-auto rounded-xl border border-line bg-surface-sunken p-3 text-[12px] whitespace-pre-wrap text-content-secondary">
              {job.payloadJson}
            </pre>
          </>
        )}

        {tab === "Related" && (
          <ul className="space-y-2">
            {job.related.map((resource) => (
              <li key={`${resource.kind}-${resource.href}`}>
                <Link
                  href={resource.href}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-content transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 truncate">{resource.label}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {tab === "Actions" && (
          <div className="space-y-3 text-[12.5px] text-content-secondary">
            <p>
              <strong className="text-content">Retry</strong> inserts a new job carrying
              this one&rsquo;s payload and a key derived from its ID, so two operators
              retrying at once produce one run. The original row is never rewritten.
            </p>
            <p>
              <strong className="text-content">Cancel</strong> removes a job that has not
              started. A running job cannot be recalled from the provider &mdash; the
              request is recorded and the worker stops at its next safe point.
            </p>
            <p>
              <strong className="text-content">Move to DLQ</strong> files a failed job out
              of the active queue. It does not undo anything the job already did.
            </p>
            <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
              Every one of these requires a password step-up and is written to the audit
              log against your operator account.
            </p>
          </div>
        )}
      </DrawerBody>
    </Drawer>
  );
}
