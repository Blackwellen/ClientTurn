"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import type { CallCard as CallCardView } from "@/lib/voice/call-view";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelVoiceCallAction } from "@/lib/voice/actions";

/**
 * One AI call, as the lead's conversation timeline and voice panel show it.
 *
 * Everything shown comes from the `CallCard` view model (lib/voice/call-view),
 * which has already dropped anything that looks like model reasoning. Call
 * cost is never shown to a customer (owner decision, 2026-09-30): minutes used
 * and the outcome only. The server boundary (lead-voice-card) nulls it too.
 */

const CANCELLABLE = new Set(["REQUESTED", "ELIGIBILITY_CHECKED", "QUEUED"]);

export function CallCard({
  card,
  leadId,
  canCancel = false,
  compact = false,
}: {
  card: CallCardView;
  leadId: string;
  /** A member or above, on a call that has not started. */
  canCancel?: boolean;
  /** The right rail: no transcript or recording, which live in the timeline. */
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const transcriptId = React.useId();
  const DirectionIcon = card.direction === "Inbound" ? PhoneIncoming : PhoneOutgoing;
  const cancellable = canCancel && CANCELLABLE.has(card.state);

  async function cancel() {
    setCancelling(true);
    try {
      const result = await cancelVoiceCallAction({ callId: card.id, leadId });
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        router.refresh();
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setCancelling(false);
    }
  }

  const details: { label: string; value: React.ReactNode }[] = [];
  if (card.qualificationChange) {
    details.push({
      label: "Qualification",
      value: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {card.qualificationChange.before ? <StatusBadge kind="qualification" value={card.qualificationChange.before} dense /> : <span>Not set</span>}
          <span className="text-content-muted">to</span>
          {card.qualificationChange.after ? <StatusBadge kind="qualification" value={card.qualificationChange.after} dense /> : <span>Not set</span>}
        </span>
      ),
    });
  }
  if (card.nextAction) details.push({ label: "Next action", value: card.nextAction });
  if (card.callbackRequestedFor) details.push({ label: "Callback requested", value: card.callbackRequestedFor });
  if (card.objections.length) {
    details.push({
      label: card.objections.length === 1 ? "Objection" : "Objections",
      value: (
        <ul className="space-y-0.5">
          {card.objections.map((o) => (
            <li key={o.key}>
              {o.label}
              {o.handledOutcome && <span className="text-content-muted"> ({o.handledOutcome.replace(/_/g, " ").toLowerCase()})</span>}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (!compact) for (const fact of card.facts) details.push({ label: fact.label, value: fact.value });
  if (card.billedMinutes !== null) details.push({ label: "Minutes used", value: String(card.billedMinutes) });

  return (
    <article className="min-w-0 rounded-xl border border-line bg-surface shadow-xs" aria-label={`${card.direction} call`}>
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken">
            <DirectionIcon className="size-4 text-content-muted" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-content">
              {card.direction} AI call
              <span className="font-normal text-content-muted"> · {card.routeLabel}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-content-muted">
              <time dateTime={card.at} suppressHydrationWarning>{formatDateTime(card.at)}</time>
              {card.durationLabel && <> · {card.durationLabel}</>}
              {card.number && <> · <span className="tabular-nums">{card.number}</span></>}
              {card.attemptNumber > 1 && <> · attempt {card.attemptNumber}</>}
            </p>
            {card.calledBy && (
              <p className="mt-0.5 text-[12px] text-content-muted">Called by {card.calledBy}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge kind="voice_call" value={card.state} dense />
          {card.disposition && <StatusBadge kind="voice_disposition" value={card.disposition} dense />}
        </div>
      </header>

      <div className="space-y-3 px-4 pt-2.5 pb-3.5">
        {card.summary ? (
          <p className="text-[13px] text-content-secondary">{card.summary}</p>
        ) : card.inProgress ? (
          <p className="text-[13px] text-content-muted">The call is in progress. A summary appears here when it ends.</p>
        ) : null}

        {details.length > 0 && (
          <dl className="grid gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-2">
            {details.map((d) => (
              <div key={d.label} className="min-w-0">
                <dt className="text-content-muted">{d.label}</dt>
                <dd className="mt-0.5 break-words text-content">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!compact && card.recordingUrl && (
          <div>
            <p className="mb-1 text-[12px] text-content-muted">Recording</p>
            {/* The URL is signed for five minutes; reload the page to play it later. */}
            <audio controls preload="none" src={card.recordingUrl} className="h-9 w-full max-w-md">
              Your browser cannot play this recording.
            </audio>
          </div>
        )}
        {!compact && card.recordingStatus === "PENDING" && (
          <p className="text-[12px] text-content-muted">The recording is being processed.</p>
        )}
        {!compact && card.recordingStatus === "FAILED" && (
          <p className="text-[12px] text-warning-700">The recording could not be stored for this call.</p>
        )}

        {!compact && card.transcript.length > 0 && (
          <div className="rounded-lg border border-line-subtle">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={transcriptId}
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-content hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              {open ? "Hide transcript" : `Show transcript (${card.transcript.length} ${card.transcript.length === 1 ? "turn" : "turns"})`}
              <ChevronDown className={cn("size-4 text-content-muted transition-transform", open && "rotate-180")} aria-hidden />
            </button>
            {open && (
              <ol id={transcriptId} className="max-h-96 space-y-2 overflow-y-auto border-t border-line-subtle px-3 py-2.5">
                {card.transcript.map((turn, i) => (
                  <li key={i} className="text-[12.5px]">
                    <span className={cn("font-semibold", turn.role === "agent" ? "text-content-accent" : "text-content")}>
                      {turn.role === "agent" ? "AI assistant" : "Lead"}:
                    </span>{" "}
                    <span className="text-content-secondary">{turn.content}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {cancellable && (
          <div>
            <Button variant="secondary" size="xs" loading={cancelling} onClick={cancel}>
              Cancel call
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
