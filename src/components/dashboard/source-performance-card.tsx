import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { SourceSnapshotRow } from "@/lib/dashboard/types";
import { leadsHrefForSource } from "@/lib/leads/filters";
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
import { CardActionLink } from "./card-action-link";
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
          action={<CardActionLink href="/app/leads" />}
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
                href="/app/settings?section=connections"
                className="text-content-accent text-[13px] font-medium"
              >
                Check lead connections
              </Link>
            }
          />
        ) : (
          <Table className="table-fixed [&_td]:py-1 [&_th]:h-8">
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
                <TableHead className="w-6 px-0">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="group relative h-8 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-content-accent">
                  <TableCell className="px-2">
                    <span className="flex items-center gap-2">
                      <SourceIcon provider={row.provider} className="shrink-0" />
                      {/* The row opens Leads filtered to this source, which is
                          what the chevron in the design promises. */}
                      <Link
                        href={leadsHrefForSource(row.key)}
                        className="text-content group-hover:text-content-accent min-w-0 truncate font-medium after:absolute after:inset-0 focus-visible:outline-none!"
                      >
                        {row.label}
                      </Link>
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
                  <TableCell align="right" className="px-0">
                    <ChevronRight
                      aria-hidden
                      className="text-content-subtle group-hover:text-content-muted size-4 transition-colors"
                    />
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
