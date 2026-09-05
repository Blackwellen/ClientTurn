"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { formatDateTime } from "@/lib/dates";
import {
  CONTACT_STATES,
  CONTACT_STATE_LABELS,
  suppressionLabel,
  type CampaignContactRow,
  type CampaignContactsParams,
  type ContactState,
} from "@/lib/campaigns/types";

const STATE_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "accent" | "info"> =
  {
    pending: "neutral",
    scheduled: "info",
    sent: "accent",
    delivered: "success",
    replied: "success",
    failed: "danger",
    suppressed: "warning",
    stopped: "warning",
  };

export function CampaignContactsTable({
  rows,
  total,
  params,
}: {
  rows: CampaignContactRow[];
  total: number;
  params: CampaignContactsParams;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const columns: Column<CampaignContactRow>[] = [
    {
      key: "name",
      header: "Lead",
      render: (row) => (
        <Link
          href={`/app/leads?lead=${row.leadId}`}
          className="text-content hover:text-content-accent focus-visible:outline-content-accent rounded-xs font-medium focus-visible:outline-2"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "phone",
      header: "Number",
      render: (row) => (
        <span className="lr-tabular text-content-muted">{row.phone ?? "—"}</span>
      ),
    },
    {
      key: "state",
      header: "State",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={STATE_TONE[row.state] ?? "neutral"} dot>
            {CONTACT_STATE_LABELS[row.state as ContactState] ?? row.state}
          </Badge>
          {row.stoppedReason && (
            <span className="text-content-subtle text-[12px]">
              {suppressionLabel(row.stoppedReason)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "sentAt",
      header: "Sent",
      align: "right",
      render: (row) => formatDateTime(row.sentAt),
    },
    {
      key: "repliedAt",
      header: "Replied",
      align: "right",
      render: (row) => formatDateTime(row.repliedAt),
    },
    {
      key: "booked",
      header: "Booked",
      align: "right",
      render: (row) =>
        row.booked ? (
          <Badge tone="success">Booked</Badge>
        ) : (
          <span className="text-content-subtle">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by contact state"
          value={params.state}
          onChange={(event) =>
            setParams({
              state: event.target.value === "all" ? null : event.target.value,
              page: null,
            })
          }
          className="h-9 w-auto text-[13px]"
        >
          <option value="all">All states</option>
          {CONTACT_STATES.map((state) => (
            <option key={state} value={state}>
              {CONTACT_STATE_LABELS[state]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        onPageChange={(page) => setParams({ page: String(page) })}
        onPageSizeChange={(pageSize) =>
          setParams({ pageSize: String(pageSize), page: null })
        }
        empty={
          <EmptyState
            icon={Users}
            title="No contacts to show"
            description="Contacts appear once the campaign has been launched and the audience has been expanded."
          />
        }
      />
    </div>
  );
}
