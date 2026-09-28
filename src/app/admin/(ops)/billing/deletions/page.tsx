import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { listScheduledDeletions } from "@/lib/admin/workspace-deletions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeletionHoldToggle } from "@/components/admin/billing/deletion-hold-toggle";

export const metadata: Metadata = { title: "Scheduled deletions" };
export const dynamic = "force-dynamic";

function day(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Admin -> Billing -> Scheduled deletions (docs/BILLING.md §3).
 *
 * Every cancelled workspace on the day-90 schedule: when it ended, the two
 * notices, the deletion date, what the daily job will do today (the same rule
 * the job runs, so this is its dry run) and the hold for disputes and legal
 * holds. The (ops) layout already requires a platform admin; the hold action
 * is guarded with step-up and audited.
 */
export default async function ScheduledDeletionsPage() {
  const { available, enabled, rows } = await listScheduledDeletions();
  const upcoming = rows.filter((row) => !row.deletedAt);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <p className="text-[12.5px] text-content-muted">
          <Link href="/admin/billing" className="hover:underline">Billing</Link> / Scheduled deletions
        </p>
        <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
          Scheduled deletions
        </h1>
        <p className="mt-1 max-w-3xl text-[14px] text-content-muted">
          A cancelled workspace is read-only for 90 days, then deleted through the data-rights path. The owner is told on
          day 60 and day 83, and deletion never runs sooner than 7 days after the final notice. Billing, tax and minimal
          opt-out records are kept. Hold a workspace for a dispute or a legal hold: a held workspace gets no notice and is
          never deleted.
        </p>
        {!enabled && (
          <p className="mt-3 rounded-md bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
            Dry run: WORKSPACE_DELETION_ENABLED is not set, so the daily job only reports this plan. No notice is sent and
            nothing is deleted until it is switched on.
          </p>
        )}
      </div>

      {!available ? (
        <EmptyState
          icon={CalendarClock}
          title="Scheduled deletion is not set up yet"
          description="Migration 0170 is not applied. Until it is, nothing is scheduled and nothing is deleted."
        />
      ) : upcoming.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No deletions scheduled"
          description="No cancelled workspace is waiting for deletion. The daily job adds one here the day after a subscription ends."
        />
      ) : (
        <div className="-mx-1 overflow-x-auto rounded-xl border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Workspace</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Day-60 notice</TableHead>
                <TableHead>Day-83 notice</TableHead>
                <TableHead>Deletes on</TableHead>
                <TableHead>Today</TableHead>
                <TableHead>
                  <span className="sr-only">Hold</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.map((row) => (
                <TableRow key={row.businessId}>
                  <TableCell className="min-w-[180px] font-medium">
                    <Link href={`/admin/customers?customer=${row.businessId}`} className="hover:underline">
                      {row.businessName}
                    </Link>
                    {row.hold && row.holdReason && (
                      <p className="mt-0.5 text-[12px] font-normal text-content-muted">Held: {row.holdReason}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{day(row.endedAt)}</TableCell>
                  <TableCell className="tabular-nums">{row.day}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(row.noticeDay60At)}</TableCell>
                  <TableCell className="whitespace-nowrap">{day(row.noticeDay83At)}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.hold ? "On hold" : day(row.deleteOn)}</TableCell>
                  <TableCell>
                    <Badge
                      tone={row.hold ? "warning" : row.today === "Delete" ? "danger" : row.today.startsWith("Day-") ? "info" : "neutral"}
                      dense
                    >
                      {row.deletionStartedAt && !row.hold ? "Deleting" : row.today}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DeletionHoldToggle businessId={row.businessId} businessName={row.businessName} held={row.hold} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
