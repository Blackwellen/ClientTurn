"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Flag, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import {
  approveProspectsAction,
  markProspectsForReviewAction,
  removeProspectsFromCampaignAction,
} from "@/lib/find-leads/prospect-actions";
import { addProspectsToCampaignAction } from "@/lib/find-leads/actions";

/**
 * The bulk action bar (V4 §12.7).
 *
 * What is deliberately absent: bulk promotion to Lead. Promotion is a statement
 * that a relationship has changed, and §11.19 makes it a per-record decision
 * taken after reading the conversation — a button that turned 200 cold records
 * into 200 leads would make the Prospect/Lead boundary meaningless.
 *
 * Every action reports what actually happened rather than what was asked for.
 * A selection of 40 that approves 12 says so, because the other 28 were skipped
 * for a reason the person needs to know about.
 */
export function ProspectBulkBar({
  selected,
  campaigns,
  onClear,
}: {
  selected: string[];
  campaigns: { id: string; name: string }[];
  onClear: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  if (selected.length === 0) return null;

  const run = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: (result: unknown) => string,
  ) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: success(result) });
      onClear();
      router.refresh();
    });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-accent-200/60 bg-accent-50/50 px-3.5 py-2.5"
    >
      <p className="text-[12.5px] font-medium text-content">
        {selected.length.toLocaleString("en-GB")} selected
      </p>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={pending}
          onClick={() =>
            run(
              () => approveProspectsAction(selected),
              (result) => {
                const data = (result as { data?: { approved: number; skipped: number } })
                  .data;
                if (!data) return "Approved for outreach.";
                return data.skipped > 0
                  ? `${data.approved} approved. ${data.skipped} skipped — not eligible or not ready.`
                  : `${data.approved} approved for outreach.`;
              },
            )
          }
        >
          <CheckCircle2 className="size-3.5" aria-hidden />
          Approve for outreach
        </Button>

        {campaigns.length > 0 && (
          <DropdownMenu
            trigger={
              <Button size="sm" variant="secondary" disabled={pending}>
                <Send className="size-3.5" aria-hidden />
                Add to campaign
              </Button>
            }
          >
            {campaigns.map((campaign) => (
              <DropdownItem
                key={campaign.id}
                onSelect={() =>
                  run(
                    () => addProspectsToCampaignAction(campaign.id, selected),
                    (result) => {
                      const data = (result as { data?: { added: number } }).data;
                      return `${data?.added ?? 0} added to ${campaign.name}.`;
                    },
                  )
                }
              >
                {campaign.name}
              </DropdownItem>
            ))}
          </DropdownMenu>
        )}

        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(
              () => removeProspectsFromCampaignAction(selected),
              (result) => {
                const data = (result as { data?: { removed: number } }).data;
                return `${data?.removed ?? 0} removed from their campaign.`;
              },
            )
          }
        >
          Remove from campaign
        </Button>

        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(
              () => markProspectsForReviewAction(selected),
              (result) => {
                const data = (result as { data?: { updated: number } }).data;
                return `${data?.updated ?? 0} sent for review.`;
              },
            )
          }
        >
          <Flag className="size-3.5" aria-hidden />
          Mark for review
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={pending}>
          <X className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>
    </div>
  );
}
