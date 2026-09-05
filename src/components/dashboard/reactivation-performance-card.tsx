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
          action={
            <Link
              href="/app/reactivation"
              className="text-content-accent hover:text-accent-700 focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              View all
            </Link>
          }
        />
      </CardHeader>
      <CardContent className="flex-1 pt-0">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead align="right" numeric>
                  Leads
                </TableHead>
                <TableHead align="right" numeric>
                  Replies
                </TableHead>
                <TableHead align="right" numeric>
                  Bookings
                </TableHead>
                <TableHead align="right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} className="group relative h-10">
                  <TableCell className="max-w-[10rem]">
                    <Link
                      href={`/app/reactivation?campaign=${campaign.id}`}
                      className="text-content group-hover:text-content-accent block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      {campaign.name}
                    </Link>
                  </TableCell>
                  <TableCell align="right" numeric>
                    {campaign.audience}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {campaign.replied}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {campaign.booked}
                  </TableCell>
                  <TableCell align="right">
                    <StatusBadge
                      kind="campaign"
                      value={campaign.status}
                      dot={false}
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
