"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Ban, Copy, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import {
  cancelCampaign,
  duplicateCampaign,
  pauseCampaign,
  resumeCampaign,
} from "@/lib/campaigns/actions";
import { canPerform } from "@/lib/campaigns/reactivation-types";
import type { ReactivationCampaignRow } from "@/lib/campaigns/reactivation-types";
import type { ReactivationSort } from "@/lib/campaigns/reactivation-filters";
import { useRouter } from "next/navigation";
import { CampaignIcon, CampaignStatusBadge } from "./campaign-icon";
import { CampaignOverflowMenu } from "./campaign-overflow-menu";
import { useReactivationParams } from "./use-reactivation-params";

/** Columns whose header toggles a sort, and the sort keys they cycle. */
const SORTABLE: Partial<
  Record<string, { asc: ReactivationSort; desc: ReactivationSort }>
> = {
  campaign: { asc: "name_asc", desc: "name_desc" },
  created: { asc: "created_asc", desc: "created_desc" },
};

const SORT_BY_METRIC: Record<string, ReactivationSort> = {
  sent: "sent",
  replies: "replies",
  qualified: "qualified",
  booked: "booked",
};

function SortableHead({
  id,
  label,
  sort,
  onSort,
  className,
}: {
  id: string;
  label: string;
  sort: ReactivationSort;
  onSort: (next: ReactivationSort) => void;
  className?: string;
}) {
  const pair = SORTABLE[id];
  const metric = SORT_BY_METRIC[id];
  const active = pair
    ? sort === pair.asc || sort === pair.desc
    : sort === metric;

  const next = pair
    ? sort === pair.desc
      ? pair.asc
      : pair.desc
    : metric;

  const direction = pair && sort === pair.asc ? "asc" : "desc";
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;

  if (!pair && !metric) {
    return <TableHead className={className}>{label}</TableHead>;
  }

  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        className={cn(
          "inline-flex items-center gap-1 rounded-xs font-medium",
          "transition-colors hover:text-content",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          active && "text-content",
        )}
      >
        {label}
        {active && <Icon className="size-3" aria-hidden />}
      </button>
    </TableHead>
  );
}

/* ----------------------------------------------------------- bulk bar --- */

type BulkAction = "pause" | "resume" | "cancel" | "duplicate";

const BULK_CONFIRM: Record<
  "cancel",
  { title: string; scope: string; consequence: string }
> = {
  cancel: {
    title: "Cancel the selected campaigns?",
    scope: "Every contact still waiting in these campaigns is stopped permanently.",
    consequence:
      "This cannot be undone. Results already collected are kept, and messages already sent stay in each conversation.",
  },
};

function BulkToolbar({
  selected,
  rows,
  onClear,
}: {
  selected: string[];
  rows: ReactivationCampaignRow[];
  onClear: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const chosen = rows.filter((row) => selected.includes(row.id));

  // An action is offered only when it is valid for every selected campaign,
  // so a bulk action never silently half-applies.
  const enabled = (action: BulkAction) =>
    chosen.length > 0 &&
    chosen.every((row) =>
      action === "duplicate" ? true : canPerform(row.status, action),
    );

  async function run(action: BulkAction) {
    setBusy(true);
    try {
      const results = await Promise.all(
        chosen.map((row) =>
          action === "pause"
            ? pauseCampaign(row.id)
            : action === "resume"
              ? resumeCampaign(row.id)
              : action === "cancel"
                ? cancelCampaign(row.id)
                : duplicateCampaign(row.id),
        ),
      );

      const failed = results.filter((result) => !result.ok).length;
      if (failed === 0) {
        toast({
          variant: "success",
          title: chosen.length + " campaigns updated",
        });
      } else {
        toast({
          variant: failed === results.length ? "error" : "warning",
          title: "Unable to update campaign",
          description:
            failed + " of " + results.length + " could not be updated.",
        });
      }
      onClear();
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-50 px-3 py-2"
    >
      <p className="text-[13px] font-medium text-content">
        {selected.length} selected
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !enabled("pause")}
          onClick={() => void run("pause")}
        >
          <Pause className="size-3.5" aria-hidden />
          Pause
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !enabled("resume")}
          onClick={() => void run("resume")}
        >
          <Play className="size-3.5" aria-hidden />
          Resume
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !enabled("duplicate")}
          onClick={() => void run("duplicate")}
        >
          <Copy className="size-3.5" aria-hidden />
          Duplicate
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !enabled("cancel")}
          onClick={() => setConfirming(true)}
          className="text-danger-600"
        >
          <Ban className="size-3.5" aria-hidden />
          Cancel
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          onConfirm={() => run("cancel")}
          title={BULK_CONFIRM.cancel.title}
          scope={BULK_CONFIRM.cancel.scope}
          consequence={BULK_CONFIRM.cancel.consequence}
          confirmLabel={"Cancel " + chosen.length + " campaigns"}
          variant="danger"
          loading={busy}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- table --- */

const NUM = "hidden lr-tabular sm:table-cell";

/**
 * `CampaignTable` — the List view. A real table, not stretched cards:
 * selection, sortable headers and one row per campaign. Clicking the row
 * opens the drawer; the checkbox and the overflow menu deliberately do not.
 */
export function CampaignTable({
  campaigns,
  canManage,
  sort,
  openCampaignId,
  onOpen,
}: {
  campaigns: ReactivationCampaignRow[];
  canManage: boolean;
  sort: ReactivationSort;
  openCampaignId?: string;
  onOpen: (id: string) => void;
}) {
  const { setFilter } = useReactivationParams();
  const [selected, setSelected] = React.useState<string[]>([]);

  const visibleIds = React.useMemo(
    () => campaigns.map((campaign) => campaign.id),
    [campaigns],
  );

  // Selecting a row then filtering it away must not leave it selected: a bulk
  // action would then touch something the user can no longer see.
  const active = selected.filter((id) => visibleIds.includes(id));
  const allSelected = active.length > 0 && active.length === visibleIds.length;

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  const onSort = (next: ReactivationSort) => setFilter({ sort: next });

  return (
    <div>
      {canManage && active.length > 0 && (
        <BulkToolbar
          selected={active}
          rows={campaigns}
          onClear={() => setSelected([])}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow className="h-10 hover:bg-transparent">
            <TableHead className="w-10 pr-0">
              {canManage ? (
                <Checkbox
                  aria-label="Select all campaigns on this page"
                  checked={allSelected}
                  ref={(node) => {
                    if (node) {
                      node.indeterminate = active.length > 0 && !allSelected;
                    }
                  }}
                  onChange={() =>
                    setSelected(allSelected ? [] : visibleIds)
                  }
                />
              ) : (
                <span className="sr-only">Select</span>
              )}
            </TableHead>
            <SortableHead
              id="campaign"
              label="Campaign"
              sort={sort}
              onSort={onSort}
            />
            <TableHead className="hidden md:table-cell">Audience</TableHead>
            <SortableHead id="sent" label="Sent" sort={sort} onSort={onSort} className={NUM} />
            <SortableHead
              id="replies"
              label="Replies"
              sort={sort}
              onSort={onSort}
              className={NUM}
            />
            <SortableHead
              id="qualified"
              label="Qualified"
              sort={sort}
              onSort={onSort}
              className={cn(NUM, "hidden lg:table-cell")}
            />
            <SortableHead
              id="booked"
              label="Booked"
              sort={sort}
              onSort={onSort}
              className={cn(NUM, "hidden lg:table-cell")}
            />
            <TableHead>Status</TableHead>
            <SortableHead
              id="created"
              label="Created"
              sort={sort}
              onSort={onSort}
              className="hidden md:table-cell"
            />
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {campaigns.map((campaign) => {
            const isSelected = active.includes(campaign.id);
            return (
              <TableRow
                key={campaign.id}
                selected={isSelected || campaign.id === openCampaignId}
                onClick={() => onOpen(campaign.id)}
                className="h-[72px] cursor-pointer"
              >
                <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                  {canManage ? (
                    <Checkbox
                      aria-label={"Select " + campaign.name}
                      checked={isSelected}
                      onChange={() => toggle(campaign.id)}
                    />
                  ) : null}
                </TableCell>

                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <CampaignIcon icon={campaign.icon} size="sm" />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(campaign.id);
                        }}
                        className="block max-w-[240px] truncate rounded-xs text-left text-[13.5px] font-semibold text-content hover:text-content-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                      >
                        {campaign.name}
                      </button>
                      {campaign.description && (
                        <p className="mt-0.5 line-clamp-2 max-w-[240px] text-[11.5px] leading-[16px] text-content-muted">
                          {campaign.description}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                <TableCell className="hidden md:table-cell">
                  <span className="block max-w-[160px] truncate text-content-secondary">
                    {campaign.audienceLabel}
                  </span>
                </TableCell>

                <TableCell className={NUM}>
                  {campaign.sent.toLocaleString("en-GB")}
                </TableCell>
                <TableCell className={NUM}>
                  {campaign.replies.toLocaleString("en-GB")}
                </TableCell>
                <TableCell className={cn(NUM, "hidden lg:table-cell")}>
                  {campaign.qualified.toLocaleString("en-GB")}
                </TableCell>
                <TableCell className={cn(NUM, "hidden lg:table-cell")}>
                  {campaign.booked.toLocaleString("en-GB")}
                </TableCell>

                <TableCell>
                  <CampaignStatusBadge status={campaign.status} />
                </TableCell>

                <TableCell className="hidden whitespace-nowrap text-content-secondary md:table-cell">
                  {formatDate(campaign.createdAt)}
                </TableCell>

                <TableCell onClick={(e) => e.stopPropagation()}>
                  <CampaignOverflowMenu
                    campaignId={campaign.id}
                    campaignName={campaign.name}
                    status={campaign.status}
                    canManage={canManage}
                    onOpenDetails={() => onOpen(campaign.id)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
