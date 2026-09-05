"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatRelative } from "@/lib/dates";
import {
  progressTone,
  type ReactivationCampaignRow,
} from "@/lib/campaigns/reactivation-types";
import { CampaignIcon, CampaignStatusBadge } from "./campaign-icon";
import { CampaignOverflowMenu } from "./campaign-overflow-menu";

function Metric({
  label,
  value,
  first,
}: {
  label: string;
  value: number;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 px-2 first:pl-0 last:pr-0",
        !first && "border-l border-line-subtle",
      )}
    >
      <p className="lr-tabular truncate text-[15px] font-semibold leading-none text-content">
        {value.toLocaleString("en-GB")}
      </p>
      <p className="mt-1 truncate text-[11px] text-content-muted">{label}</p>
    </div>
  );
}

/**
 * `CampaignCard` — one campaign in the grid. It is a shortcut into the
 * drawer, not an editor: the only interactive things inside it are the
 * overflow menu and the card itself.
 */
export function CampaignCard({
  campaign,
  canManage,
  selected,
  onOpen,
  onEdit,
}: {
  campaign: ReactivationCampaignRow;
  canManage: boolean;
  selected?: boolean;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={"Open campaign " + campaign.name}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex h-full cursor-pointer flex-col rounded-xl border bg-surface p-3.5",
        "shadow-xs transition-[border-color,box-shadow,transform] duration-[var(--lr-duration-fast)]",
        "hover:-translate-y-px hover:shadow-md",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        selected
          ? "border-accent-500 ring-1 ring-accent-400"
          : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <CampaignIcon icon={campaign.icon} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-content">
            {campaign.name}
          </h3>
          <div className="mt-1.5">
            <CampaignStatusBadge status={campaign.status} />
          </div>
          {campaign.description && (
            <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-[18px] text-content-muted">
              {campaign.description}
            </p>
          )}
        </div>

        <div onClick={(event) => event.stopPropagation()}>
          <CampaignOverflowMenu
            campaignId={campaign.id}
            campaignName={campaign.name}
            status={campaign.status}
            canManage={canManage}
            onOpenDetails={onOpen}
            onEdit={onEdit}
          />
        </div>
      </div>

      {/* metrics — pushed to the bottom so cards in a row line up */}
      <div className="mt-auto pt-3.5">
        <dl className="flex items-stretch">
          <Metric first label="Sent" value={campaign.sent} />
          <Metric label="Replies" value={campaign.replies} />
          <Metric label="Qualified" value={campaign.qualified} />
          <Metric label="Booked" value={campaign.booked} />
        </dl>

        <div className="mt-3 flex items-center gap-2.5">
          <Progress
            value={campaign.progress}
            tone={progressTone(campaign.status)}
            label={campaign.name + " progress"}
            className="h-2 flex-1"
          />
          <span className="lr-tabular shrink-0 text-[11px] font-medium text-content-secondary">
            {campaign.progress}%
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-line-subtle pt-2.5 text-[11px] text-content-subtle">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <span className="shrink-0">Created {formatDate(campaign.createdAt)}</span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5">
            {campaign.createdByName && (
              <Avatar name={campaign.createdByName} size="sm" />
            )}
            <span className="truncate">
              Last updated {formatRelative(campaign.updatedAt)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
