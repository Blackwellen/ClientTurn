import * as React from "react";
import Link from "next/link";
import type { SourceSnapshotRow } from "@/lib/dashboard/types";
import { formatPercent } from "@/lib/dates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "@/components/app/page-header";
import { SourceIcon } from "./source-icon";

/**
 * The only place source attribution appears — this replaced the standalone
 * Analytics page. Top five sources by lead count for the selected period.
 */
export function SourcePerformanceCard({ rows }: { rows: SourceSnapshotRow[] }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Source performance"
          action={
            <Link
              href="/app/leads"
              className="text-content-accent hover:text-accent-700 focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              View all
            </Link>
          }
        />
      </CardHeader>
      {/* Container query, not a viewport breakpoint: this card is one of three
          in a row on wide screens and full width on a phone, so what fits
          depends on the card, not the window. */}
      <CardContent className="@container flex-1 pt-0">
        {rows.length === 0 ? (
          <EmptyState
            title="No source data yet"
            description="Source performance appears once leads arrive from a connected source."
            action={
              <Link
                href="/app/settings/connections"
                className="text-content-accent text-[13px] font-medium"
              >
                Check lead connections
              </Link>
            }
          />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-auto px-2">Source</TableHead>
                <TableHead align="right" numeric className="w-14 px-2">
                  Leads
                </TableHead>
                <TableHead align="right" numeric className="w-16 px-2">
                  Replies
                </TableHead>
                <TableHead align="right" numeric className="w-14 px-2">
                  Qual.
                </TableHead>
                <TableHead align="right" numeric className="w-16 px-2">
                  Booked
                </TableHead>
                <TableHead
                  align="right"
                  numeric
                  className="hidden w-16 px-2 @md:table-cell"
                >
                  Conv.
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="h-10">
                  <TableCell className="px-2">
                    <span className="flex items-center gap-2">
                      <SourceIcon provider={row.provider} className="shrink-0" />
                      <span className="min-w-0 truncate font-medium">
                        {row.label}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {row.leads}
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {row.replies}
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {row.qualified}
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {row.booked}
                  </TableCell>
                  <TableCell
                    align="right"
                    numeric
                    className="text-content-secondary hidden px-2 @md:table-cell"
                  >
                    {formatPercent(row.conversionRate, 1)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
