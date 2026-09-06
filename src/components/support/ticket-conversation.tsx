"use client";

import * as React from "react";
import { Paperclip, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  getAttachmentUrl,
  getMyTicket,
  replyToTicket,
} from "@/lib/support/actions";
import {
  categoryLabel,
  statusLabel,
  statusTone,
  type TicketDetail,
} from "@/lib/support/types";
import { BackLink } from "./help-view";
import { relative } from "./ticket-list";

/**
 * One ticket, as a conversation (V4 §23.10).
 *
 * Presented as an asynchronous thread, not a chat: there is no typing
 * indicator, no presence, and the footer says when to expect a reply. Support
 * here is a queue worked by people, and implying otherwise sets an expectation
 * the product cannot keep.
 */
export function TicketConversation({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [ticket, setTicket] = React.useState<TicketDetail | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const row = await getMyTicket(ticketId);
      setTicket(row);
      setState(row ? "ready" : "error");
    } catch {
      setState("error");
    }
  }, [ticketId]);

  React.useEffect(() => {
    let active = true;
    getMyTicket(ticketId).then((row) => {
      if (!active) return;
      setTicket(row);
      setState(row ? "ready" : "error");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [ticketId]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ticket?.messages.length]);

  async function send() {
    setPending(true);
    setError(null);
    try {
      const result = await replyToTicket({ ticketId, body, attachmentKeys: [] });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      await load();
    } catch {
      setError("Your reply could not be sent. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function openAttachment(id: string) {
    const result = await getAttachmentUrl(id);
    if (!result.ok) {
      toast({ variant: "error", title: result.error });
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  if (state === "loading") {
    return (
      <div className="space-y-3 p-5" aria-hidden>
        <div className="h-4 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-6 w-2/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-20 w-full animate-pulse rounded-xl bg-surface-sunken" />
        <div className="h-20 w-5/6 animate-pulse rounded-xl bg-surface-sunken" />
      </div>
    );
  }

  if (state === "error" || !ticket) {
    return (
      <div className="space-y-3 p-5">
        <BackLink label="My tickets" onClick={onBack} />
        <p role="alert" className="text-[13px] text-danger-600">
          That conversation could not be loaded.
        </p>
      </div>
    );
  }

  const closed = ticket.status === "CLOSED";

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-5 pb-4">
        <BackLink label="My tickets" onClick={onBack} />
        <div>
          <h2 className="text-[18px] font-bold leading-snug text-content">
            {ticket.subject}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={statusTone(ticket.status)} dense>
              {statusLabel(ticket.status)}
            </Badge>
            <span className="text-[11.5px] text-content-muted">
              {categoryLabel(ticket.category)} · {ticket.reference}
            </span>
          </div>
        </div>
      </div>

      <ol className="flex-1 space-y-3 p-5">
        {ticket.messages.map((message) => {
          const mine = message.direction === "INBOUND";
          return (
            <li
              key={message.id}
              className={cn(
                "rounded-xl px-3.5 py-3",
                mine
                  ? "ml-6 bg-surface-sunken"
                  : "mr-6 border border-line bg-surface",
              )}
            >
              <p className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-content-muted">
                <span className="font-medium">
                  {mine ? "You" : (message.authorName ?? "ClientTurn support")}
                </span>
                <span>{relative(message.createdAt)}</span>
              </p>
              <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-content-secondary">
                {message.body}
              </p>

              {message.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {message.attachments.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => void openAttachment(file.id)}
                        className={cn(
                          "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1",
                          "text-[12px] text-content-accent hover:underline",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                        )}
                      >
                        <Paperclip className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{file.filename}</span>
                        <span className="shrink-0 text-content-subtle">
                          {formatSize(file.sizeBytes)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      <div className="sticky bottom-0 space-y-2 border-t border-line bg-white p-4">
        {closed ? (
          <p className="text-center text-[12.5px] text-content-muted">
            This conversation is closed. Raise a new ticket if you need more
            help.
          </p>
        ) : (
          <>
            <label className="sr-only" htmlFor="ticket-reply">
              Your reply
            </label>
            <Textarea
              id="ticket-reply"
              rows={3}
              value={body}
              maxLength={5000}
              placeholder="Write a reply…"
              onChange={(event) => setBody(event.target.value)}
            />

            {error && (
              <p role="alert" className="text-[12.5px] text-danger-600">
                {error}
              </p>
            )}

            <Button
              fullWidth
              loading={pending}
              disabled={body.trim().length < 2}
              onClick={send}
            >
              <Send className="size-4" aria-hidden />
              Send reply
            </Button>
            <p className="text-center text-[11.5px] text-content-muted">
              Replies arrive here and by email, usually within one working day.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
