"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/ui/modal";
import { FormField, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { closeReasonProblem } from "@/lib/leads/detail-page";
import {
  CLOSE_REASON_CATEGORIES_FOR,
  CLOSE_REASON_PREFILL,
  composeCloseReason,
  type CloseReasonCategory,
} from "@/lib/leads/close-reasons";

/**
 * Closing a lead won or lost, with the reason (decision Q3).
 *
 * One dialog for the drawer and the lead page, so the rule is the same
 * wherever a lead is closed: no reason, no close. The reason is recorded on
 * the opportunity, feeds the won/lost reports and is sent to the connected
 * CRM, which is why the consequence line says so.
 */
type Props = {
  /** Null when closed. */
  outcome: "WON" | "LOST" | null;
  onClose: () => void;
  /** Resolves true when the close succeeded and the dialog may shut. */
  onSubmit: (outcome: "WON" | "LOST", reason: string) => Promise<boolean>;
};

export function CloseOutcomeDialog(props: Props) {
  // Keyed by the outcome, so every opening starts blank: a reason typed for
  // one close must never be submitted for the next.
  return <ReasonDialog key={props.outcome ?? "closed"} {...props} />;
}

function ReasonDialog({ outcome, onClose, onSubmit }: Props) {
  const [reason, setReason] = React.useState("");
  const [category, setCategory] = React.useState<CloseReasonCategory | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const won = outcome === "WON";
  const categories = CLOSE_REASON_CATEGORIES_FOR[won ? "WON" : "LOST"];
  // The category is stored as a "[Category] " tag in front of the text, and the
  // whole reason is capped at 500, so the box gives up the tag's length.
  const maxText = 500 - (category ? category.length + 3 : 0);

  const pick = (next: CloseReasonCategory) => {
    const same = next === category;
    setCategory(same ? null : next);
    // Prefill only an empty box: never overwrite what somebody typed.
    if (!same && !reason.trim()) setReason(CLOSE_REASON_PREFILL[next]);
    if (error) setError(null);
  };

  return (
    <ConfirmDialog
      open={outcome !== null}
      variant={won ? "default" : "warning"}
      title={won ? "Mark this lead as won?" : "Mark this lead as lost?"}
      scope={
        won
          ? "The lead and its opportunity are closed as won."
          : "The lead and its opportunity are closed as lost."
      }
      consequence="Automated follow-up stops, and the outcome and your reason are recorded on the opportunity and sent to your connected CRM."
      confirmLabel={won ? "Mark as won" : "Mark as lost"}
      onClose={onClose}
      onConfirm={async () => {
        if (!outcome) return;
        const composed = composeCloseReason(category, reason);
        const problem = closeReasonProblem(reason) ?? closeReasonProblem(composed);
        if (problem) {
          setError(problem);
          return;
        }
        const ok = await onSubmit(outcome, composed);
        if (ok) onClose();
      }}
    >
      <div className="mb-3">
        <p id="close-outcome-category" className="text-content-muted mb-1.5 text-[12px] font-medium">
          Reason type <span className="text-content-subtle font-normal">(optional)</span>
        </p>
        <div role="group" aria-labelledby="close-outcome-category" className="flex flex-wrap gap-1.5">
          {categories.map((option) => {
            const active = option === category;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => pick(option)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
                  active
                    ? "border-accent-200 bg-accent-50 text-content-accent"
                    : "border-line text-content-muted hover:bg-surface-hover hover:text-content",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <FormField
        label={won ? "Why was it won?" : "Why was it lost?"}
        htmlFor="close-outcome-reason"
        required
        error={error ?? undefined}
        hint={won ? "For example: signed the retainer after the discovery call." : "For example: chose a cheaper supplier."}
      >
        <Textarea
          id="close-outcome-reason"
          rows={3}
          maxLength={maxText}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (error) setError(null);
          }}
          className="text-[13px]"
        />
      </FormField>
    </ConfirmDialog>
  );
}
