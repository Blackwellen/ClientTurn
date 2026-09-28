"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { formatRelative } from "@/lib/dates";
import { formatNumber } from "@/lib/admin/format";
import {
  pauseWorkspaceLinkedInAssist,
  resumeWorkspaceLinkedInAssist,
} from "@/lib/admin/support-signals-actions";
import type { SignalLoad, SupportSignals } from "@/lib/admin/support-signals-types";

/**
 * The support drawer's read-only signals for the 2026-09-28 features. The
 * only write is pausing / resuming LinkedIn Assist, which is step-up guarded
 * and audited server-side (support-signals-actions.ts). Everything else is
 * for support to read, never to change on the customer's behalf.
 */
export function CustomerSupportSignals({ businessId, signals }: { businessId: string; signals: SupportSignals }) {
  return (
    <>
      <Block title="Team permissions (read only)">
        <Load load={signals.members}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No members on this workspace.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {rows.map((row) => (
                  <li key={row.memberId} className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-content">
                      {row.name} <span className="font-normal text-content-subtle">· {row.role}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {row.capabilities.map((capability) => (
                        <span
                          key={capability.key}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px]",
                            capability.allowed
                              ? "border-success-100 bg-success-50 text-success-700"
                              : "border-line bg-surface-sunken text-content-secondary",
                          )}
                        >
                          {capability.label}: {capability.allowed ? "yes" : "no"}
                          {capability.overridden ? " (set for this person)" : ""}
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            )
          }
        </Load>
        <Note>Change permissions only from the customer&apos;s own Settings, Team. Support cannot edit them here.</Note>
      </Block>

      <LinkedInBlock businessId={businessId} load={signals.linkedIn} />

      <Block title="Invoice payments to review">
        <Load load={signals.paymentReviews}>
          {(data) =>
            data.total === 0 ? (
              <Empty>No invoice payment is waiting for review.</Empty>
            ) : (
              <dl>
                <Row label="Waiting">{formatNumber(data.total)}</Row>
                {data.byKind.map((entry) => (
                  <Row key={entry.kind} label={entry.label}>
                    {formatNumber(entry.count)}
                  </Row>
                ))}
              </dl>
            )
          }
        </Load>
        <Note>The workspace resolves these in Settings, Quotes &amp; invoices. Money is in their own Stripe; support never moves it.</Note>
      </Block>

      <Block title="Commercial rules (read only)">
        <Load load={signals.commercial}>
          {(data) => (
            <dl>
              <Row label="Competitors">
                {formatNumber(data.enabledCompetitors)} on · {formatNumber(data.competitors)} total
              </Row>
              <Row label="Agents selling selected offers">
                {formatNumber(data.agentsWithSelectedOffers)} of {formatNumber(data.agents)}
              </Row>
            </dl>
          )}
        </Load>
      </Block>
    </>
  );
}

function LinkedInBlock({ businessId, load }: { businessId: string; load: SupportSignals["linkedIn"] }) {
  const router = useRouter();
  const { run, pending, stepUpDialog } = useAdminAction();
  const [reason, setReason] = React.useState("");

  return (
    <Block title="LinkedIn Assist">
      <Load load={load}>
        {(data) => (
          <>
            {data.hold && (
              <p role="status" className="mb-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
                Paused by support {formatRelative(data.hold.heldAt, { style: "ago" })}: {data.hold.reason}
              </p>
            )}
            <dl>
              <Row label="People using it">
                {formatNumber(data.people)}
                {data.pausedPeople > 0 ? ` (${formatNumber(data.pausedPeople)} paused their own list)` : ""}
              </Row>
              <Row label="Contacts in progress">{formatNumber(data.activeContacts)}</Row>
              <Row label="Open tasks">{formatNumber(data.openTasks)}</Row>
              <Row label="Marked sent, 7 days">
                {formatNumber(data.sent7d)} ({formatNumber(data.connectionNotes7d)} connection requests)
              </Row>
              <Row label="Marked sent, 30 days">{formatNumber(data.sent30d)}</Row>
            </dl>
            {!data.holdAvailable ? (
              <Note>Pausing needs migration 0175, which is not applied on this database yet.</Note>
            ) : data.hold ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === "li-resume"}
                  onClick={async () => {
                    await run("li-resume", () => resumeWorkspaceLinkedInAssist({ businessId }), "LinkedIn Assist resumed.");
                    router.refresh();
                  }}
                >
                  Resume LinkedIn Assist
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Label htmlFor={`li-hold-${businessId}`}>Reason for pausing (the workspace is told support paused it)</Label>
                <Textarea
                  id={`li-hold-${businessId}`}
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  loading={pending === "li-pause"}
                  onClick={async () => {
                    await run("li-pause", () => pauseWorkspaceLinkedInAssist({ businessId, reason }), "LinkedIn Assist paused.");
                    setReason("");
                    router.refresh();
                  }}
                >
                  Pause LinkedIn Assist
                </Button>
              </div>
            )}
            <Note>Pausing shows each person replies only, stops new contacts and AI drafts, and deletes nothing. Needs step-up; audited.</Note>
          </>
        )}
      </Load>
      {stepUpDialog}
    </Block>
  );
}

/* ------------------------------------------------------------ primitives */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line-subtle px-5 py-4" aria-label={title}>
      <h3 className="mb-3 text-[13.5px] font-semibold text-content">{title}</h3>
      {children}
    </section>
  );
}

function Load<T>({ load, children }: { load: SignalLoad<T>; children: (data: T) => React.ReactNode }) {
  if (load.state === "not_installed") return <p className="text-[12.5px] text-content-muted">{load.note}</p>;
  if (load.state === "error") {
    return (
      <p role="alert" className="text-[12.5px] text-danger-700">
        This could not be loaded right now.
      </p>
    );
  }
  return <>{children(load.data)}</>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[3px]">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-words text-content">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-content-muted">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11.5px] text-content-subtle">{children}</p>;
}
