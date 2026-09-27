import * as React from "react";
import Link from "next/link";
import type { CampaignListRow } from "@/lib/campaigns/types";
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
import { CardActionLink } from "./card-action-link";

/**
 * Recent campaigns only — a mini-table, not a rebuild of the Reactivation
 * module. Full campaign detail (audience, suppression, contacts) lives there.
 */
export function ReactivationPerformanceCard({
  campaigns,
}: {
  campaigns: CampaignListRow[];
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Reactivation performance"
          action={<CardActionLink href="/app/reactivation" />}
        />
      </CardHeader>
      {/* Fixed columns, as in Source performance: the auto layout pushed
          Bookings and Status past the card edge at 1440px (8.7). */}
      <CardContent className="@container flex-1 pt-0">
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            description="Launch a reactivation campaign to win back leads who went quiet."
            action={
              <Link
                href="/app/reactivation/new"
                className="text-content-accent text-[13px] font-medium"
              >
                Create a reactivation campaign
              </Link>
            }
          />
        ) : (
          <Table className="table-fixed [&_td]:py-1 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className="w-auto px-2">Campaign</TableHead>
                <TableHead align="right" numeric className="w-14 px-2">
                  Leads
                </TableHead>
                <TableHead align="right" numeric className="w-16 px-2">
                  Replies
                </TableHead>
                <TableHead align="right" numeric className="w-16 px-2">
                  Booked
                </TableHead>
                <TableHead align="right" className="hidden w-24 px-2 @md:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} className="group relative h-8 has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-content-accent">
                  <TableCell className="px-2">
                    <Link
                      href={`/app/reactivation?campaign=${campaign.id}`}
                      className="text-content group-hover:text-content-accent block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none!"
                    >
                      {campaign.name}
                    </Link>
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {campaign.audience}
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {campaign.replied}
                  </TableCell>
                  <TableCell align="right" numeric className="px-2">
                    {campaign.booked}
                  </TableCell>
                  <TableCell align="right" className="hidden px-2 @md:table-cell">
                    <StatusBadge
                      kind="campaign"
                      value={campaign.status}
                      dot={false}
                      dense
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
