"use client";

import * as React from "react";
import { CalendarPlus, Hand, Play, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import type { LeadCapabilities, LeadDetail } from "@/lib/leads/types";
import type { LeadDrawerActions, RunAction } from "./lead-drawer-actions";
import { ConversationThread } from "./conversation-thread";

/**
 * One lead, one thread, one composer. There is deliberately no way to send
 * from here to more than the lead in front of you — bulk messaging is not a
 * capability this product exposes from the inbox.
 */
export function LeadConversationSection({
  detail,
  actions,
  capabilities,
  canWrite,
  pending,
  run,
  channel,
  onChannelChange,
  composerRef,
}: {
  detail: LeadDetail;
  actions: LeadDrawerActions;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  pending: string | null;
  run: RunAction;
  channel: "sms" | "whatsapp";
  onChannelChange: (channel: "sms" | "whatsapp") => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { lead, messages } = detail;
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  // Land on the newest message, the way any conversation view should open.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const blocked = !canWrite
    ? "You do not have permission to send messages."
    : lead.opted_out
      ? "This lead has opted out. No further messages can be sent to them."
      : !lead.phone
        ? "This lead has no phone number, so there is nowhere to send a message."
        : channel === "whatsapp" && !capabilities.whatsapp
          ? "WhatsApp is not connected for this workspace."
          : channel === "sms" && !capabilities.sms
            ? "SMS is not connected for this workspace."
            : null;

  const send = async () => {
    const ok = await run(
      "send",
      () =>
        actions.sendManualMessage({ leadId: lead.id, channel, body: draft }),
      "Message queued.",
    );
    if (ok) setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <ConversationThread messages={messages} />
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-5">
        {lead.human_takeover ? (
          <p className="mb-2.5 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-[12px] font-medium text-warning-700">
            <Hand className="size-3.5 shrink-0" aria-hidden />
            You have taken over — automated follow-up is paused for this lead.
            {canWrite && !lead.opted_out && (
              <button
                type="button"
                disabled={pending === "resume"}
                onClick={() =>
                  run(
                    "resume",
                    () => actions.resumeAutomation(lead.id),
                    "Automated follow-up resumed.",
                  )
                }
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent disabled:opacity-50"
              >
                <Play className="size-3" aria-hidden />
                Resume
              </button>
            )}
          </p>
        ) : null}

        {blocked ? (
          <p className="rounded-lg bg-surface-sunken px-3 py-2.5 text-[12px] text-content-muted">
            {blocked}
          </p>
        ) : (
          <div className="space-y-2">
            <Textarea
              ref={composerRef}
              rows={3}
              maxLength={1200}
              aria-label="Message"
              placeholder={`Write a ${channel === "sms" ? "text" : "WhatsApp"} message…`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter alone inserts a newline; the deliberate gesture sends.
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (draft.trim()) void send();
                }
              }}
              className="text-[13px]"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Channel"
                value={channel}
                onChange={(event) =>
                  onChannelChange(event.target.value as "sms" | "whatsapp")
                }
                className="h-9 w-auto text-[13px]"
              >
                <option value="sms" disabled={!capabilities.sms}>
                  SMS
                </option>
                <option value="whatsapp" disabled={!capabilities.whatsapp}>
                  WhatsApp
                </option>
              </Select>

              <Button
                variant="secondary"
                size="sm"
                className="h-9"
                disabled={!capabilities.booking || pending === "booking"}
                title={
                  capabilities.booking
                    ? undefined
                    : "No booking destination is configured. Connect a calendar first."
                }
                onClick={() =>
                  run(
                    "booking",
                    () => actions.sendBookingLink({ leadId: lead.id }),
                    "Booking link sent.",
                  )
                }
              >
                <CalendarPlus className="size-3.5" />
                Booking link
              </Button>

              <Button
                size="sm"
                className={cn("ml-auto h-9")}
                loading={pending === "send"}
                disabled={draft.trim().length === 0}
                onClick={send}
              >
                <Send className="size-3.5" />
                Send
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
