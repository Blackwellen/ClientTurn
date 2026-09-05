"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Copy,
  Eye,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Rocket,
  Trash2,
} from "lucide-react";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  cancelCampaign,
  deleteDraftCampaign,
  duplicateCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
} from "@/lib/campaigns/actions";
import {
  canPerform,
  type CampaignAction,
} from "@/lib/campaigns/reactivation-types";
import type { CampaignStatus } from "@/lib/campaigns/types";
import { useReactivationParams } from "./use-reactivation-params";

type Confirmable = Extract<
  CampaignAction,
  "launch" | "pause" | "resume" | "cancel" | "delete"
>;

const CONFIRM: Record<
  Confirmable,
  {
    title: string;
    scope: string;
    consequence: string;
    confirm: string;
    danger?: boolean;
  }
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
      "Messages already sent are unaffected, results are kept, and replies still arrive as normal.",
    confirm: "Pause campaign",
  },
  resume: {
    title: "Resume this campaign?",
    scope: "Sending continues from where it stopped, inside the send window.",
    consequence:
      "Anyone who has opted out, replied or booked since the pause is dropped automatically, so nobody is messaged twice.",
    confirm: "Resume campaign",
  },
  cancel: {
    title: "Cancel this campaign?",
    scope: "Every contact still waiting is stopped permanently.",
    consequence:
      "This cannot be undone. Results already collected are kept, and messages already sent stay in each conversation.",
    confirm: "Cancel campaign",
    danger: true,
  },
  delete: {
    title: "Delete this draft?",
    scope: "The draft and its settings are removed.",
    consequence:
      "This cannot be undone. Only drafts can be deleted — a campaign that has sent anything must be cancelled instead, so its results survive.",
    confirm: "Delete draft",
    danger: true,
  },
};

const SUCCESS_TITLE: Record<CampaignAction, string> = {
  launch: "Campaign launched",
  pause: "Campaign paused",
  resume: "Campaign resumed",
  cancel: "Campaign cancelled",
  duplicate: "Campaign duplicated",
  delete: "Draft deleted",
  edit: "Campaign updated",
};

/**
 * Runs a campaign lifecycle action and reports the outcome. The server
 * re-checks the transition table before doing anything, so a stale menu can
 * request something impossible and simply be refused with a message.
 */
export function useCampaignAction(campaignId: string) {
  const router = useRouter();
  const { toast } = useToast();
  const { openCampaign } = useReactivationParams();
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async (action: CampaignAction) => {
      setBusy(true);
      try {
        const result =
          action === "launch"
            ? await launchCampaign(campaignId)
            : action === "pause"
              ? await pauseCampaign(campaignId)
              : action === "resume"
                ? await resumeCampaign(campaignId)
                : action === "cancel"
                  ? await cancelCampaign(campaignId)
                  : action === "duplicate"
                    ? await duplicateCampaign(campaignId)
                    : await deleteDraftCampaign(campaignId);

        if (!result.ok) {
          toast({
            variant: "error",
            title: "Unable to update campaign",
            description: result.error,
          });
          return false;
        }

        toast({
          variant: "success",
          title: SUCCESS_TITLE[action],
          description:
            action === "duplicate" && "name" in result.data
              ? "Saved as “" + result.data.name + "” in Draft."
              : undefined,
        });

        router.refresh();

        if (action === "duplicate" && "id" in result.data) {
          openCampaign(result.data.id);
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [campaignId, openCampaign, router, toast],
  );

  return { run, busy };
}

/**
 * `CampaignOverflowMenu` — the kebab on a card or table row. Which items
 * appear is derived from the status transition table, so a completed campaign
 * is never offered Resume and a running one is never offered Delete.
 */
export function CampaignOverflowMenu({
  campaignId,
  campaignName,
  status,
  canManage,
  onOpenDetails,
  onEdit,
  label,
}: {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  canManage: boolean;
  onOpenDetails: () => void;
  onEdit?: () => void;
  label?: string;
}) {
  const { run, busy } = useCampaignAction(campaignId);
  const [pending, setPending] = React.useState<Confirmable | null>(null);

  const allow = (action: CampaignAction) =>
    canManage && canPerform(status, action);

  return (
    <>
      <DropdownMenu
        trigger={
          <button
            type="button"
            aria-label={label ?? "Actions for " + campaignName}
            onClick={(event) => event.stopPropagation()}
            className="-mr-1 shrink-0 rounded-md p-1 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
          >
            <MoreVertical className="size-4" aria-hidden />
          </button>
        }
      >
        <DropdownItem icon={Eye} onSelect={onOpenDetails}>
          View details
        </DropdownItem>

        {allow("edit") && onEdit && (
          <DropdownItem icon={Pencil} onSelect={onEdit}>
            Edit
          </DropdownItem>
        )}

        {allow("launch") && (
          <DropdownItem icon={Rocket} onSelect={() => setPending("launch")}>
            Launch
          </DropdownItem>
        )}

        {allow("pause") && (
          <DropdownItem icon={Pause} onSelect={() => setPending("pause")}>
            Pause
          </DropdownItem>
        )}

        {allow("resume") && (
          <DropdownItem icon={Play} onSelect={() => setPending("resume")}>
            Resume
          </DropdownItem>
        )}

        {canManage && (
          <DropdownItem icon={Copy} onSelect={() => void run("duplicate")}>
            Duplicate
          </DropdownItem>
        )}

        {(allow("cancel") || allow("delete")) && <DropdownSeparator />}

        {allow("cancel") && (
          <DropdownItem
            icon={Ban}
            destructive
            onSelect={() => setPending("cancel")}
          >
            Cancel campaign
          </DropdownItem>
        )}

        {allow("delete") && (
          <DropdownItem
            icon={Trash2}
            destructive
            onSelect={() => setPending("delete")}
          >
            Delete draft
          </DropdownItem>
        )}
      </DropdownMenu>

      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await run(pending);
            setPending(null);
          }}
          title={CONFIRM[pending].title}
          scope={CONFIRM[pending].scope}
          consequence={CONFIRM[pending].consequence}
          confirmLabel={CONFIRM[pending].confirm}
          variant={CONFIRM[pending].danger ? "danger" : "default"}
          loading={busy}
        />
      )}
    </>
  );
}

export { CONFIRM as CAMPAIGN_CONFIRM_COPY };
