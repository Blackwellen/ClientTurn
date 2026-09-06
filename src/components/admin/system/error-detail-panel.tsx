"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { IconTile, SeverityBadge } from "@/components/admin/ui";
import { formatDateTime, formatRelative, formatNumber } from "@/lib/admin/format";
import {
  ERROR_SEVERITY_TONE,
  ERROR_STATUSES,
  ERROR_STATUS_LABEL,
  type ErrorTriageStatus,
  type PlatformErrorRow,
} from "@/lib/admin/types";

const HEADER_TONE = {
  CRITICAL: "border-danger-100 bg-danger-50",
  HIGH: "border-warning-100 bg-warning-50",
  MEDIUM: "border-warning-100 bg-warning-50/60",
  LOW: "border-line bg-surface-sunken",
} as const;

const STATUS_DOT: Record<ErrorTriageStatus, string> = {
  OPEN: "bg-danger-500",
  INVESTIGATING: "bg-warning-500",
  RESOLVED: "bg-success-500",
  IGNORED: "bg-content-subtle",
};

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
 * Renders beside the table on wide screens and stacks below it otherwise —
 * error triage is a read-then-decide task, so keeping the list visible beats
 * covering it with an overlay.
 */
export function ErrorDetailPanel({
  error,
  pending,
  onClose,
  onStatusChange,
}: {
  error: PlatformErrorRow;
  pending: boolean;
  onClose: () => void;
  onStatusChange: (status: ErrorTriageStatus) => void;
}) {
  const resolved = error.status === "RESOLVED";

  return (
    <section
      aria-label={`Error detail for ${error.reference}`}
      className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-xs"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={FileText} tone="info" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-content">Error details</h2>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Details and next steps for the selected error.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close error details"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        className={cn(
          "mx-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 sm:mx-5",
          HEADER_TONE[error.severity],
        )}
      >
        <div className="min-w-0">
          <p className="flex items-start gap-2 text-[13.5px] font-semibold text-content">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                ERROR_SEVERITY_TONE[error.severity] === "danger"
                  ? "bg-danger-500"
                  : ERROR_SEVERITY_TONE[error.severity] === "warning"
                    ? "bg-warning-500"
                    : "bg-content-subtle",
              )}
            />
            <span className="min-w-0 break-words">{error.message}</span>
          </p>
          <p className="mt-0.5 pl-3.5 text-[12px] text-content-muted">
            {error.businessId ? (
              <Link
                href={`/admin/customers?customer=${error.businessId}`}
                className="hover:text-content-accent hover:underline"
              >
                {error.businessName}
              </Link>
            ) : (
              error.businessName
            )}
          </p>
        </div>
        <SeverityBadge severity={error.severity} />
      </div>

      <div className="px-4 py-3 sm:px-5">
        <dl>
          <Row label="Reference">
            <span className="lr-tabular">{error.reference}</span>
          </Row>
          <Row label="Area">{error.area}</Row>
          <Row label="First seen">
            {formatDateTime(error.firstSeen)}
            <span className="block text-[11.5px] text-content-muted">
              ({formatRelative(error.firstSeen)})
            </span>
          </Row>
          <Row label="Latest seen">
            {formatDateTime(error.lastSeen)}
            <span className="block text-[11.5px] text-content-muted">
              ({formatRelative(error.lastSeen)})
            </span>
          </Row>
          <Row label="Occurrences">
            {formatNumber(error.occurrences)}{" "}
            {error.occurrences === 1 ? "time" : "times"}
          </Row>
          <Row label="Status">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", STATUS_DOT[error.status])}
              />
              {ERROR_STATUS_LABEL[error.status]}
              {error.resolvedAt && (
                <span className="text-content-muted">
                  · {formatRelative(error.resolvedAt)}
                </span>
              )}
            </span>
          </Row>
        </dl>

        <div className="mt-3">
          <h3 className="mb-1.5 text-[12.5px] font-semibold text-content">
            Message
          </h3>
          <p className="rounded-lg border border-line bg-surface-sunken/60 px-3 py-2 text-[12.5px] break-words text-content-secondary">
            {error.message}
          </p>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-content-muted">
            Triage status
          </span>
          <Select
            value={error.status}
            disabled={pending}
            onChange={(event) =>
              onStatusChange(event.target.value as ErrorTriageStatus)
            }
          >
            {ERROR_STATUSES.map((option) => (
              <option key={option} value={option}>
                {ERROR_STATUS_LABEL[option]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-subtle px-4 py-3 sm:px-5">
        {/* Only ever rendered when a Sentry integration actually supplied an
            issue URL. No link is ever constructed from a guess. */}
        {error.sentryIssueUrl ? (
          <a
            href={error.sentryIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            Open in Sentry
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="text-[11.5px] text-content-subtle">
            No Sentry issue is linked to this error.
          </p>
        )}

        <Button
          size="sm"
          className="ml-auto"
          loading={pending}
          disabled={resolved}
          onClick={() => onStatusChange("RESOLVED")}
        >
          <CheckCircle2 className="size-3.5" aria-hidden />
          {resolved ? "Resolved" : "Mark resolved"}
        </Button>
      </div>
    </section>
  );
}
