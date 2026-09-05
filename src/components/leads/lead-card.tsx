"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, Mail, MoreVertical, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatRelative } from "@/lib/dates";
import {
  attentionReasonLabel,
  lastActivity,
  leadDisplayName,
  type LeadListRow,
} from "@/lib/leads/types";
import { LeadSourceBadge } from "./lead-source-badge";
import { LeadRowActions } from "./lead-row-actions";

/**
 * A card carries exactly what a table row carries — identity, status,
 * attention, service, source, contact, owner, created and last activity — laid
 * out for scanning a grid. It is a shortcut into the drawer, not a profile
 * page, so nothing here is editable.
 */
export function LeadCard({
  row,
  assigneeName,
  onOpen,
  className,
}: {
  row: LeadListRow;
  assigneeName: string | null;
  onOpen: () => void;
  className?: string;
}) {
  const name = leadDisplayName(row);
  const activity = lastActivity(row);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open lead ${name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-4",
        "shadow-xs transition-[border-color,box-shadow,transform] duration-[var(--lr-duration-fast)]",
        "hover:-translate-y-px hover:border-line-strong hover:shadow-md",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        row.opted_out && "opacity-75",
        className,
      )}
    >
      {/* identity + status */}
      <div className="flex items-start gap-2">
        {row.needs_attention && (
          <AlertCircle
            className="mt-px size-4 shrink-0 text-danger-500"
            aria-label="Needs attention"
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-6 text-content">
          {name}
        </h3>
        {/* Uppercased here rather than in the status map: the mapping stays the
            single source of truth for label and colour, this is presentation. */}
        <StatusBadge
          kind="lead"
          value={row.status}
          dot={false}
          className="shrink-0 uppercase tracking-[0.02em]"
        />
        <LeadRowActions
          leadId={row.id}
          leadName={name}
          onOpen={onOpen}
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${name}`}
              onClick={(event) => event.stopPropagation()}
              className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
            >
              <MoreVertical className="size-4" aria-hidden />
            </button>
          }
        />
      </div>

      {/* service */}
      <p className="mt-1 truncate text-[13px] text-content-muted">
        {row.services?.name ?? "No service recorded"}
      </p>

      {/* source */}
      <div className="mt-2.5">
        <LeadSourceBadge source={row.lead_sources} />
      </div>

      {/* contact */}
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Phone</dt>
          <Phone className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
          <dd className="truncate text-content-secondary">
            {row.phone ?? <span className="text-content-subtle">Not provided</span>}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <dt className="sr-only">Email</dt>
          <Mail className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
          <dd className="truncate text-content-secondary" title={row.email ?? undefined}>
            {row.email ?? <span className="text-content-subtle">Not provided</span>}
          </dd>
        </div>
      </dl>

      {/* assignee */}
      <div className="mt-3 flex min-w-0 items-center gap-2">
        {assigneeName ? (
          <>
            <Avatar name={assigneeName} size="sm" />
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] text-content-subtle">Assigned to</p>
              <p className="truncate text-[12px] font-medium text-content-secondary">
                {assigneeName}
              </p>
            </div>
          </>
        ) : (
          <p className="text-[12px] text-content-subtle">Unassigned</p>
        )}
      </div>

      {/* timings — pinned to the bottom so cards in a row line up */}
      <div className="mt-auto pt-3">
        <div className="flex items-center gap-2 border-t border-line-subtle pt-2.5 text-[11px] text-content-subtle">
          <span className="truncate">Created {formatRelative(row.created_at)}</span>
          <span aria-hidden className="text-line-strong">
            |
          </span>
          <span className="truncate" title={activity.label}>
            Last activity {formatRelative(activity.at)}
          </span>
        </div>

        {row.needs_attention && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger-50 px-2 py-1.5 text-[11px] font-medium text-danger-700">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              Needs attention — {attentionReasonLabel(row.attention_reason)}
            </span>
          </p>
        )}

        {row.opted_out && (
          <p className="mt-2 text-[11px] font-medium text-danger-600">
            Opted out — no further messages can be sent
          </p>
        )}
      </div>
    </div>
  );
}
