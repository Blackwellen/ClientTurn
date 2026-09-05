import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { leadDisplayName, sourceLabel } from "@/lib/leads/types";
import type { LeadListRow } from "@/lib/leads/types";
import { formatRelativeShort } from "@/lib/dates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badge";
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
 * The ten newest leads regardless of the selected date range — this card
 * answers "what just came in?", which a 90-day filter would only obscure.
 * Every other card on the page follows the range.
 */
export function RecentLeadsCard({ leads }: { leads: LeadListRow[] }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Recent leads"
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
      <CardContent className="@container flex-1 pt-0">
        {leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="When a lead arrives from a connected source it appears here within seconds."
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
          // Fixed layout: the name column absorbs the slack and truncates, so
          // a long service or campaign name can never push Time out of the card.
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2">Name</TableHead>
                <TableHead className="hidden w-28 px-2 @md:table-cell">
                  Service
                </TableHead>
                <TableHead className="hidden w-28 px-2 @lg:table-cell">
                  Source
                </TableHead>
                <TableHead className="w-24 px-2">Status</TableHead>
                <TableHead align="right" className="w-18 px-2">
                  Time
                </TableHead>
                <TableHead className="w-7 px-0">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} className="group relative h-10">
                  <TableCell className="px-2">
                    {/* One stretched link per row: the whole row is clickable
                        while screen readers and keyboards get a single target. */}
                    <Link
                      href={`/app/leads?lead=${lead.id}`}
                      className="text-content group-hover:text-content-accent block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      {leadDisplayName(lead)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-content-secondary hidden truncate px-2 @md:table-cell">
                    {lead.services?.name ?? "—"}
                  </TableCell>
                  <TableCell className="hidden px-2 @lg:table-cell">
                    <span className="flex items-center gap-1.5">
                      <SourceIcon
                        provider={lead.lead_sources?.provider}
                        className="size-3.5 shrink-0"
                      />
                      <span className="text-content-secondary min-w-0 truncate">
                        {sourceLabel(lead.lead_sources)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="px-2">
                    <StatusBadge kind="lead" value={lead.status} dot={false} />
                  </TableCell>
                  <TableCell
                    align="right"
                    className="text-content-muted px-2 text-[12px] whitespace-nowrap"
                  >
                    {formatRelativeShort(lead.last_contact_at ?? lead.created_at)}
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
