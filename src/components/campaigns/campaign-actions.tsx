"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Pause, Play, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  cancelCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
} from "@/lib/campaigns/actions";

type Action = "launch" | "pause" | "resume" | "cancel";

const COPY: Record<
  Action,
  { title: string; scope: string; consequence: string; confirm: string }
> = {
  launch: {
    title: "Launch this campaign?",
    scope: "Everyone still eligible in the audience will be contacted.",
    consequence:
      "Sending starts in the next permitted window. Opt-outs, suppressions and quiet hours are re-checked before every message.",
    confirm: "Launch campaign",
  },
  pause: {
    title: "Pause this campaign?",
    scope: "No further messages go out until you resume.",
    consequence:
      "Messages already sent are unaffected, and replies still arrive as normal.",
    confirm: "Pause campaign",
  },
  resume: {
    title: "Resume this campaign?",
    scope: "Sending continues from where it stopped.",
    consequence:
      "Anyone who has opted out, booked or replied since the pause is dropped automatically.",
    confirm: "Resume campaign",
  },
  cancel: {
    title: "Cancel this campaign?",
    scope: "Every contact still waiting is stopped permanently.",
    consequence:
      "This cannot be undone. Messages already sent stay in each conversation.",
    confirm: "Cancel campaign",
  },
};

export function CampaignActions({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<Action | null>(null);
  const [busy, setBusy] = React.useState(false);

  const finished = status === "COMPLETED" || status === "CANCELLED";

  async function run(action: Action) {
    setBusy(true);
    try {
      const result =
        action === "launch"
          ? await launchCampaign(campaignId)
          : action === "pause"
            ? await pauseCampaign(campaignId)
            : action === "resume"
              ? await resumeCampaign(campaignId)
              : await cancelCampaign(campaignId);

      if (!result.ok) {
        toast({ variant: "error", title: "That did not work", description: result.error });
        return;
      }
      toast({
        variant: "success",
        title:
          action === "launch"
            ? "Campaign launched"
            : action === "pause"
              ? "Campaign paused"
              : action === "resume"
                ? "Campaign resumed"
                : "Campaign cancelled",
      });
      router.refresh();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (finished) {
    return (
      <p className="text-content-muted text-[13px]">
        This campaign has finished. Results below are final.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <Button size="sm" onClick={() => setPending("launch")}>
          <Rocket className="size-3.5" aria-hidden />
          Launch
        </Button>
      )}

      {(status === "RUNNING" || status === "SCHEDULED") && (
        <Button variant="secondary" size="sm" onClick={() => setPending("pause")}>
          <Pause className="size-3.5" aria-hidden />
          Pause
        </Button>
      )}

      {status === "PAUSED" && (
        <Button size="sm" onClick={() => setPending("resume")}>
          <Play className="size-3.5" aria-hidden />
          Resume
        </Button>
      )}

      <Button variant="ghost" size="sm" onClick={() => setPending("cancel")}>
        <Ban className="size-3.5" aria-hidden />
        Cancel
      </Button>

      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={() => run(pending)}
          title={COPY[pending].title}
          scope={COPY[pending].scope}
          consequence={COPY[pending].consequence}
          confirmLabel={COPY[pending].confirm}
          variant={pending === "cancel" ? "danger" : "default"}
          loading={busy}
        />
      )}
    </div>
  );
}
