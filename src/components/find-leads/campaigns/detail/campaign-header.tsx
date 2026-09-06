"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  ArrowUp,
  Copy,
  EllipsisVertical,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  CAMPAIGN_PRIORITIES,
  campaignStatusLabel,
  campaignStatusTone,
  priorityFor,
  type CampaignPriority,
  type CampaignStatus,
} from "@/lib/outreach/types";
import { allowedTransitions } from "@/lib/outreach/campaign-state";
import {
  archiveCampaignAction,
  duplicateCampaignAction,
  setCampaignPriorityAction,
  setCampaignStateAction,
} from "@/lib/outreach/campaign-actions";
import type { CampaignHeader as HeaderData } from "@/lib/outreach/campaigns/detail";

/**
 * The campaign header and its controls.
 *
 * Which buttons exist is derived from the state machine rather than from a
 * hand-written list per status: `allowedTransitions` decides, so a control can
 * never be offered for a move the server would refuse. Stopping is behind a
 * confirmation because it is the one transition with no way back.
 */
export function CampaignDetailHeader({
  campaign,
  canManage,
}: {
  campaign: HeaderData;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmStop, setConfirmStop] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  const allowed = allowedTransitions(campaign.status);
  const canPause = allowed.includes("PAUSED");
  const canResume = allowed.includes("ACTIVE");
  const canStop = allowed.includes("STOPPED");

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

  return (
    <div className="space-y-3">
      <Link
        href="/app/find-leads?view=campaigns"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to Campaigns
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold leading-tight text-content">
              {campaign.name}
            </h1>
            <Badge tone={campaignStatusTone(campaign.status)} dot>
              {campaignStatusLabel(campaign.status)}
            </Badge>
            {campaign.archivedAt && <Badge tone="neutral">Archived</Badge>}
          </div>
          <p className="mt-1 max-w-3xl text-[14px] text-content-muted">
            {campaign.description ||
              describeObjective(campaign) ||
              "No objective recorded for this campaign."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PrioritySelect
            priority={priorityFor(campaign.priority)}
            disabled={!canManage || pending}
            onChange={(priority) =>
              run(
                () => setCampaignPriorityAction({ campaignId: campaign.id, priority }),
                "Priority updated. This changes scheduling order only.",
              )
            }
          />

          {canPause && (
            <Button
              variant="secondary"
              size="md"
              disabled={!canManage || pending}
              onClick={() =>
                run(
                  () =>
                    setCampaignStateAction({ campaignId: campaign.id, status: "PAUSED" }),
                  "Campaign paused. Nothing further will be sent.",
                )
              }
            >
              <Pause className="size-4" aria-hidden />
              Pause
            </Button>
          )}

          {canResume && campaign.status !== "DRAFT" && (
            <Button
              variant="secondary"
              size="md"
              disabled={!canManage || pending}
              onClick={() =>
                run(
                  () =>
                    setCampaignStateAction({ campaignId: campaign.id, status: "ACTIVE" }),
                  "Campaign resumed.",
                )
              }
            >
              <Play className="size-4" aria-hidden />
              {campaign.status === "READY" ? "Activate" : "Resume"}
            </Button>
          )}

          <Button
            variant="secondary"
            size="md"
            disabled={!canManage || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await duplicateCampaignAction(campaign.id);
                if (!result.ok) {
                  toast({ variant: "error", title: result.error });
                  return;
                }
                toast({
                  variant: "success",
                  title: "Campaign duplicated as a draft.",
                  description: "Its audience, results and spend stay with the original.",
                });
                router.push(`/app/find-leads/campaigns/new?draft=${result.data.id}`);
              })
            }
          >
            <Copy className="size-4" aria-hidden />
            Duplicate
          </Button>

          <Button
            variant="secondary"
            size="md"
            disabled={!canManage || pending}
            onClick={() => setConfirmArchive(true)}
          >
            <Archive className="size-4" aria-hidden />
            {campaign.archivedAt ? "Restore" : "Archive"}
          </Button>

          <DropdownMenu
            trigger={
              <Button
                variant="secondary"
                size="md"
                aria-label="More campaign actions"
                disabled={pending}
              >
                <EllipsisVertical className="size-4" aria-hidden />
              </Button>
            }
          >
            <DropdownItem
              onSelect={() => setConfirmStop(true)}
              disabled={!canManage || !canStop}
              destructive
            >
              <Square className="size-3.5" aria-hidden />
              Stop campaign
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-[12px] text-content-muted">
        Created {formatDate(campaign.createdAt)}
        {campaign.createdByName ? ` by ${campaign.createdByName}` : ""}
        {campaign.updatedAt && (
          <>
            {"  ·  "}
            Last updated {relative(campaign.updatedAt)}
          </>
        )}
      </p>

      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          run(
            () => setCampaignStateAction({ campaignId: campaign.id, status: "STOPPED" }),
            "Campaign stopped.",
          );
        }}
        title="Stop this campaign?"
        scope="No further messages will be sent from this campaign."
        consequence="Replies already received are kept, and so is its history. A stopped campaign cannot be restarted — duplicate it to send again."
        confirmLabel="Stop campaign"
        variant="danger"
        loading={pending}
      />

      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          run(
            () =>
              archiveCampaignAction({
                campaignId: campaign.id,
                archived: !campaign.archivedAt,
              }),
            campaign.archivedAt ? "Campaign restored." : "Campaign archived.",
          );
        }}
        title={campaign.archivedAt ? "Restore this campaign?" : "Archive this campaign?"}
        scope={
          campaign.archivedAt
            ? "It will appear in the Campaigns list again."
            : "It will be hidden from the Campaigns list. Its history and results are kept."
        }
        consequence="Archiving does not change what a campaign is doing — pause or stop it first if it is still sending."
        confirmLabel={campaign.archivedAt ? "Restore" : "Archive"}
        loading={pending}
      />
    </div>
  );
}

function PrioritySelect({
  priority,
  disabled,
  onChange,
}: {
  priority: CampaignPriority;
  disabled: boolean;
  onChange: (priority: CampaignPriority) => void;
}) {
  return (
    <div className="relative">
      <ArrowUp
        className={cn(
          "pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2",
          priority === "URGENT"
            ? "text-danger-600"
            : priority === "HIGH"
              ? "text-warning-600"
              : "text-content-muted",
        )}
        aria-hidden
      />
      <Select
        aria-label="Campaign priority"
        value={priority}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as CampaignPriority)}
        className="h-9 w-40 pl-7 text-[13px]"
      >
        {CAMPAIGN_PRIORITIES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} priority
          </option>
        ))}
      </Select>
    </div>
  );
}

function describeObjective(campaign: HeaderData): string | null {
  if (!campaign.conversionGoalLabel) return null;
  const where = campaign.serviceName ? ` for ${campaign.serviceName}` : "";
  return `Outreach${where} to generate ${campaign.conversionGoalLabel.toLowerCase()} outcomes.`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function relative(value: string): string {
  const diff = Date.now() - Date.parse(value);
  const hours = Math.round(diff / 3600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(value);
}

export type { CampaignStatus };
