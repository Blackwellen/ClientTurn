"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { CampaignRow } from "@/lib/outreach/types";
import {
  launchCampaignAction,
  setCampaignStatusAction,
} from "@/lib/outreach/actions";

/**
 * Launch, pause and stop for one campaign.
 *
 * Launch is the moment a workspace starts emailing strangers, so it confirms
 * and says plainly what will happen. Every precondition is re-checked
 * server-side; this dialog is the human one.
 */
export function CampaignControls({
  campaign,
  canManage,
}: {
  campaign: CampaignRow;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmLaunch, setConfirmLaunch] = React.useState(false);
  const [confirmStop, setConfirmStop] = React.useState(false);

  const run = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
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

  const launchable = ["DRAFT", "READY", "PAUSED"].includes(campaign.status);
  const running = campaign.status === "ACTIVE";
  const finished = ["COMPLETED", "STOPPED"].includes(campaign.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {launchable && (
        <Button
          size="sm"
          disabled={!canManage || pending}
          onClick={() => setConfirmLaunch(true)}
        >
          <Play className="size-3.5" aria-hidden />
          {campaign.status === "PAUSED" ? "Resume" : "Launch"}
        </Button>
      )}

      {running && (
        <Button
          variant="secondary"
          size="sm"
          disabled={!canManage || pending}
          onClick={() =>
            run(
              () => setCampaignStatusAction(campaign.id, "PAUSED"),
              "Campaign paused. Nothing further will be sent.",
            )
          }
        >
          <Pause className="size-3.5" aria-hidden />
          Pause
        </Button>
      )}

      {!finished && (
        <Button
          variant="ghost"
          size="sm"
          disabled={!canManage || pending}
          onClick={() => setConfirmStop(true)}
        >
          <Square className="size-3.5" aria-hidden />
          Stop
        </Button>
      )}

      <ConfirmDialog
        open={confirmLaunch}
        onClose={() => setConfirmLaunch(false)}
        onConfirm={() => {
          setConfirmLaunch(false);
          run(
            () => launchCampaignAction(campaign.id),
            campaign.reviewBeforeOutreach
              ? "Campaign is live. Prospects wait for your approval before anything sends."
              : "Campaign is live. Sending starts shortly.",
          );
        }}
        title={campaign.status === "PAUSED" ? "Resume this campaign?" : "Launch this campaign?"}
        scope={
          campaign.reviewBeforeOutreach
            ? "This campaign is set to review before outreach, so nothing sends until you approve each prospect."
            : `Approved prospects in this campaign will be emailed, up to ${campaign.dailyContactCap} a day.`
        }
        consequence="Every recipient is re-checked for contactability immediately before their message is sent, and anyone who has opted out is skipped."
        confirmLabel={campaign.status === "PAUSED" ? "Resume" : "Launch campaign"}
        loading={pending}
      />

      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          run(
            () => setCampaignStatusAction(campaign.id, "STOPPED"),
            "Campaign stopped.",
          );
        }}
        title="Stop this campaign?"
        scope="No further messages will be sent from this campaign."
        consequence="Replies already received are kept, and so is its history. A stopped campaign cannot be restarted — create a new one to send again."
        confirmLabel="Stop campaign"
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
