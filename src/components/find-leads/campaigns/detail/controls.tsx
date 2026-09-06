"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, Pause, Play, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  CAMPAIGN_PRIORITIES,
  campaignStatusLabel,
  campaignStatusTone,
  priorityFor,
  type CampaignPriority,
} from "@/lib/outreach/types";
import { allowedTransitions } from "@/lib/outreach/campaign-state";
import {
  archiveCampaignAction,
  duplicateCampaignAction,
  setCampaignPriorityAction,
  setCampaignStateAction,
} from "@/lib/outreach/campaign-actions";
import type { CampaignHeader } from "@/lib/outreach/campaigns/detail";

/**
 * The Campaign controls panel on Overview.
 *
 * The same actions as the header, in the place someone looks when they are
 * reading results rather than arriving at the page. Availability comes from
 * the state machine in both places, so the two can never disagree about what
 * is possible.
 */
export function CampaignControls({
  campaign,
  canManage,
}: {
  campaign: CampaignHeader;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const allowed = allowedTransitions(campaign.status);
  const canPause = allowed.includes("PAUSED");
  const canResume = allowed.includes("ACTIVE");

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: success });
      router.refresh();
    });
  };

  const tone = campaignStatusTone(campaign.status);

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <header className="mb-3 flex items-start gap-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600"
        >
          <Settings2 className="size-4" />
        </span>
        <h2 className="text-[13.5px] font-semibold leading-tight text-content">
          Campaign controls
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-content-muted">Campaign status</p>
          <div className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                tone === "success"
                  ? "bg-success-500"
                  : tone === "warning"
                    ? "bg-warning-500"
                    : tone === "danger"
                      ? "bg-danger-500"
                      : "bg-content-subtle",
              )}
            />
            <span className="truncate text-[13px] font-medium text-content">
              {campaignStatusLabel(campaign.status)}
            </span>
          </div>
          {campaign.pauseReason && (
            <p className="mt-1 text-[11.5px] leading-snug text-warning-700">
              Paused automatically: {campaign.pauseReason.toLowerCase().replace(/_/g, " ")}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-content-muted">Priority</p>
          <Select
            aria-label="Campaign priority"
            value={priorityFor(campaign.priority)}
            disabled={!canManage || pending}
            className="h-9 text-[13px]"
            onChange={(event) =>
              run(
                () =>
                  setCampaignPriorityAction({
                    campaignId: campaign.id,
                    priority: event.target.value as CampaignPriority,
                  }),
                "Priority updated. This changes scheduling order only.",
              )
            }
          >
            {CAMPAIGN_PRIORITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage || !canPause || pending}
          onClick={() =>
            run(
              () => setCampaignStateAction({ campaignId: campaign.id, status: "PAUSED" }),
              "Campaign paused. Nothing further will be sent.",
            )
          }
        >
          <Pause className="size-3.5" aria-hidden />
          Pause
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage || !canResume || pending}
          onClick={() =>
            run(
              () => setCampaignStateAction({ campaignId: campaign.id, status: "ACTIVE" }),
              "Campaign resumed.",
            )
          }
        >
          <Play className="size-3.5" aria-hidden />
          Resume
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await duplicateCampaignAction(campaign.id);
              if (!result.ok) {
                toast({ variant: "error", title: result.error });
                return;
              }
              router.push(`/app/find-leads/campaigns/new?draft=${result.data.id}`);
            })
          }
        >
          <Copy className="size-3.5" aria-hidden />
          Duplicate
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage || pending}
          onClick={() =>
            run(
              () =>
                archiveCampaignAction({
                  campaignId: campaign.id,
                  archived: !campaign.archivedAt,
                }),
              campaign.archivedAt ? "Campaign restored." : "Campaign archived.",
            )
          }
        >
          <Archive className="size-3.5" aria-hidden />
          {campaign.archivedAt ? "Restore" : "Archive"}
        </Button>
      </div>

      {!canManage && (
        <p className="mt-3 text-[11.5px] text-content-subtle">
          You have view-only access to this workspace.
        </p>
      )}
    </section>
  );
}
