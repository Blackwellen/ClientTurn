"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Download, Flag, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SUPPRESSION_REASON_OPTIONS } from "@/lib/prospects/types";
import {
  approveProspectsAction,
  markProspectsForReviewAction,
  removeProspectsFromCampaignAction,
  suppressProspectsAction,
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
  exportHref,
  onClear,
}: {
  selected: string[];
  campaigns: { id: string; name: string }[];
  /** The current filter set, as a CSV download URL. */
  exportHref: string;
  onClear: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [suppressOpen, setSuppressOpen] = React.useState(false);

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

        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => setSuppressOpen(true)}
        >
          <Ban className="size-3.5" aria-hidden />
          Suppress
        </Button>

        {/* A link, not an action: the browser streams the file straight from the
            route, so a 5,000-row export never passes through React state. */}
        <Button size="sm" variant="secondary" asChild>
          <a href={exportHref} download>
            <Download className="size-3.5" aria-hidden />
            Export
          </a>
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={pending}>
          <X className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>

      <BulkSuppressDialog
        open={suppressOpen}
        onClose={() => setSuppressOpen(false)}
        count={selected.length}
        onConfirm={(reason, note) =>
          run(
            () => suppressProspectsAction({ prospectIds: selected, reason, note }),
            (result) => {
              const data = (result as { data?: { suppressed: number; failed: number } }).data;
              if (!data) return "Suppressed.";
              return data.failed > 0
                ? `${data.suppressed} suppressed. ${data.failed} could not be written and were left contactable.`
                : `${data.suppressed} suppressed. They will not be contacted again.`;
            },
          )
        }
      />
    </div>
  );
}

/**
 * Bulk suppression asks for a reason, and says out loud that it cannot be
 * undone for the reasons that matter.
 *
 * An OPT_OUT or COMPLAINT entry is the recipient's decision, not the
 * workspace's, so it is not reversible from the product. Confirming that
 * before the click is the only place it can usefully be said.
 */
function BulkSuppressDialog({
  open,
  onClose,
  count,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  onConfirm: (reason: string, note: string | undefined) => void;
}) {
  const [reason, setReason] = React.useState<string>(SUPPRESSION_REASON_OPTIONS[0].value);
  const [note, setNote] = React.useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Suppress ${count} prospect${count === 1 ? "" : "s"}?`}
      description="They will be excluded from every campaign, on every channel, from now on."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onConfirm(reason, note || undefined);
              onClose();
            }}
          >
            Suppress {count}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="bulk-suppress-reason">Reason</Label>
          <Select
            id="bulk-suppress-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {SUPPRESSION_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="bulk-suppress-note">Note (optional)</Label>
          <Textarea
            id="bulk-suppress-note"
            rows={3}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything a colleague would need to know later."
          />
        </div>

        <p className="text-[12px] text-content-muted">
          An opt-out or a complaint is the recipient&rsquo;s decision and cannot be lifted
          from here. The records are kept, not deleted — deleting them would let the next
          search find and contact these people again.
        </p>
      </div>
    </Modal>
  );
}
