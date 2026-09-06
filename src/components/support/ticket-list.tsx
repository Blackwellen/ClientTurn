"use client";

import * as React from "react";
import { ChevronRight, Plus, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { listMyTickets } from "@/lib/support/actions";
import {
  categoryLabel,
  statusLabel,
  statusTone,
  type TicketSummary,
} from "@/lib/support/types";

/**
 * My Tickets (V4 §23.5).
 *
 * Only the caller's own tickets. A support thread routinely carries billing
 * detail and screenshots the author would not post in a team channel, so
 * workspace membership alone does not grant access — the server filters on the
 * requesting user as well as the workspace.
 */
export function TicketList({
  onOpen,
  onNewTicket,
}: {
  onOpen: (id: string) => void;
  onNewTicket: () => void;
}) {
  const [tickets, setTickets] = React.useState<TicketSummary[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let active = true;
    listMyTickets()
      .then((rows) => {
        if (!active) return;
        setTickets(rows);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold leading-tight text-content">
            My tickets
          </h2>
          <p className="mt-1 text-[13.5px] text-content-muted">
            Your support conversations and their current status.
          </p>
        </div>
      </div>

      <Button fullWidth onClick={onNewTicket}>
        <Plus className="size-4" aria-hidden />
        New support ticket
      </Button>

      {state === "loading" && (
        <ul className="space-y-2.5" aria-hidden>
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="h-[76px] animate-pulse rounded-xl border border-line bg-surface-sunken/60"
            />
          ))}
        </ul>
      )}

      {state === "error" && (
        <p role="alert" className="text-[13px] text-danger-600">
          Your support conversations could not be loaded. Please try again.
        </p>
      )}

      {state === "ready" && tickets.length === 0 && (
        <div className="rounded-xl border border-line bg-surface-sunken/50 px-4 py-10 text-center">
          <Ticket
            aria-hidden
            className="mx-auto size-6 text-content-subtle"
          />
          <p className="mt-2 text-[13.5px] font-medium text-content">
            No tickets yet
          </p>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            When you raise a ticket it appears here, along with our replies.
          </p>
        </div>
      )}

      {state === "ready" && tickets.length > 0 && (
        <ul className="space-y-2.5">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onOpen(ticket.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left",
                  "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {/* Not colour-only: the dot is accompanied by text in the
                        accessible name below. */}
                    {ticket.unread && (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full bg-accent-600"
                      />
                    )}
                    <span className="min-w-0 truncate text-[13.5px] font-semibold text-content">
                      {ticket.subject}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={statusTone(ticket.status)} dense>
                      {statusLabel(ticket.status)}
                    </Badge>
                    <span className="text-[11.5px] text-content-muted">
                      {categoryLabel(ticket.category)} · {ticket.reference} ·{" "}
                      {relative(ticket.updatedAt)}
                    </span>
                  </span>
                  {ticket.unread && (
                    <span className="sr-only">Has a new reply from support.</span>
                  )}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-content-subtle"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "2 hours ago" reads better than a timestamp in a list of conversations. */
export function relative(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}
