"use client";

import * as React from "react";
import {
  Building2,
  CircleAlert,
  LifeBuoy,
  Lock,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { cn } from "@/lib/cn";
import { formatRelative, titleise } from "@/lib/admin/format";
import {
  QUEUE_LABELS,
  SUPPORT_QUEUES,
  type SupportData,
  type SupportQueue,
  type TicketRow,
} from "@/lib/admin/support-types";
import {
  addInternalNote,
  assignTicketToMe,
  replyToTicket,
  setTicketStatus,
} from "@/lib/admin/support-actions";

/**
 * Admin → Support (V4 §39).
 *
 * A queue and a thread, side by side. The selected ticket lives in the URL so a
 * thread can be handed to another operator by pasting a link, and so the server
 * — not the browser — decides what that operator is allowed to read.
 *
 * The one rule the composer enforces visually: a note and a reply never look
 * alike. Sending an internal note to a customer by mistake is the failure mode
 * a support desk cannot recover from.
 */

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const STATUS_TONE: Record<
  string,
  "neutral" | "accent" | "success" | "warning" | "info"
> = {
  OPEN: "warning",
  WAITING_CUSTOMER: "info",
  WAITING_INTERNAL: "accent",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export function SupportView({ data }: { data: SupportData }) {
  const { setParams, pending: navPending } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();

  const select = (ticketId: string | null) =>
    setParams({ ticket: ticketId });

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- queue tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SUPPORT_QUEUES.map((queue) => (
          <QueueTab
            key={queue}
            queue={queue}
            active={data.queue === queue}
            count={data.counts[queue]}
            onSelect={() => setParams({ queue, ticket: null })}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ---------------------------------------------------- the queue */}
        <Panel
          icon={LifeBuoy}
          title={QUEUE_LABELS[data.queue]}
          description={
            data.queue === "resolved"
              ? "Recently closed, newest work last."
              : "Longest waiting first."
          }
          className={cn(navPending && "opacity-60 transition-opacity")}
        >
          {data.tickets.length === 0 ? (
            <PanelEmpty>
              {data.queue === "inbox"
                ? "Nothing is waiting. The queue is clear."
                : `No tickets in ${QUEUE_LABELS[data.queue].toLowerCase()}.`}
            </PanelEmpty>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {data.tickets.map((ticket) => (
                <TicketListItem
                  key={ticket.id}
                  ticket={ticket}
                  selected={data.detail?.ticket.id === ticket.id}
                  onSelect={() => select(ticket.id)}
                />
              ))}
            </ul>
          )}
        </Panel>

        {/* --------------------------------------------------- the thread */}
        {data.detail ? (
          <TicketThread
            detail={data.detail}
            pending={pending}
            onReply={(body) =>
              run(
                "reply",
                () => replyToTicket({ ticketId: data.detail!.ticket.id, body }),
                "Reply sent.",
              )
            }
            onNote={(body) =>
              run(
                "note",
                () => addInternalNote({ ticketId: data.detail!.ticket.id, body }),
                "Note added.",
              )
            }
            onStatus={(status) =>
              run(
                `status:${status}`,
                () => setTicketStatus({ ticketId: data.detail!.ticket.id, status }),
                "Ticket updated.",
              )
            }
            onAssign={() =>
              run(
                "assign",
                () => assignTicketToMe({ ticketId: data.detail!.ticket.id }),
                "Assigned to you.",
              )
            }
          />
        ) : (
          <Panel
            icon={MessageSquare}
            title="No ticket open"
            description="Choose a ticket from the queue to read the thread."
          >
            <PanelEmpty>
              Opening a ticket shows the customer&rsquo;s messages, their plan and
              any integration problems on their workspace. Every thread you open
              is recorded in the audit log.
            </PanelEmpty>
          </Panel>
        )}
      </div>

      {stepUpDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function QueueTab({
  queue,
  active,
  count,
  onSelect,
}: {
  queue: SupportQueue;
  active: boolean;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-line-strong bg-surface text-content shadow-xs"
          : "border-transparent text-content-secondary hover:bg-surface-hover hover:text-content",
      )}
    >
      {QUEUE_LABELS[queue]}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
          active ? "bg-surface-sunken text-content-secondary" : "text-content-subtle",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function TicketListItem({
  ticket,
  selected,
  onSelect,
}: {
  ticket: TicketRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full px-4 py-3 text-left transition-colors sm:px-5",
          selected ? "bg-accent-50/60" : "hover:bg-surface-hover",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] font-medium text-content">
            {ticket.subject}
          </p>
          {ticket.awaitingUs && (
            <Badge tone="warning" dense>
              Needs reply
            </Badge>
          )}
        </div>

        <p className="mt-0.5 truncate text-[12px] text-content-muted">
          {ticket.businessName ?? ticket.requesterEmail ?? "Unknown sender"}
          {ticket.reference && (
            <span className="text-content-subtle"> · {ticket.reference}</span>
          )}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"} dense>
            {titleise(ticket.status)}
          </Badge>
          {ticket.priority !== "NORMAL" && (
            <Badge tone={PRIORITY_TONE[ticket.priority] ?? "neutral"} dense>
              {titleise(ticket.priority)}
            </Badge>
          )}
          <span className="text-[11.5px] text-content-subtle">
            {titleise(ticket.category)} · {formatRelative(ticket.updatedAt)}
          </span>
        </div>
      </button>
    </li>
  );
}

function TicketThread({
  detail,
  pending,
  onReply,
  onNote,
  onStatus,
  onAssign,
}: {
  detail: NonNullable<SupportData["detail"]>;
  pending: string | null;
  onReply: (body: string) => void;
  onNote: (body: string) => void;
  onStatus: (status: string) => void;
  onAssign: () => void;
}) {
  const { ticket, messages, notes, customer } = detail;
  const [mode, setMode] = React.useState<"reply" | "note">("reply");
  const [body, setBody] = React.useState("");

  // A new ticket gets a fresh composer: carrying a half-written reply across
  // to a different customer's thread is how the wrong person gets an answer.
  const [composerTicketId, setComposerTicketId] = React.useState(ticket.id);
  if (composerTicketId !== ticket.id) {
    setComposerTicketId(ticket.id);
    setBody("");
    setMode("reply");
  }

  const busy = pending === "reply" || pending === "note";
  const canSubmit = body.trim().length >= 2 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "reply") onReply(body.trim());
    else onNote(body.trim());
    setBody("");
  };

  return (
    <div className="space-y-4">
      <Panel
        icon={MessageSquare}
        title={ticket.subject}
        description={`${ticket.reference ?? "No reference"} · ${titleise(ticket.category)} · opened ${formatRelative(ticket.createdAt)}`}
        action={
          <div className="flex items-center gap-1.5">
            {!ticket.assignedAdminId && (
              <Button
                size="xs"
                variant="secondary"
                loading={pending === "assign"}
                onClick={onAssign}
              >
                <UserCheck className="size-3.5" aria-hidden />
                Take
              </Button>
            )}
            {ticket.status !== "RESOLVED" && ticket.status !== "CLOSED" ? (
              <Button
                size="xs"
                variant="secondary"
                loading={pending === "status:RESOLVED"}
                onClick={() => onStatus("RESOLVED")}
              >
                Resolve
              </Button>
            ) : (
              <Button
                size="xs"
                variant="secondary"
                loading={pending === "status:OPEN"}
                onClick={() => onStatus("OPEN")}
              >
                Reopen
              </Button>
            )}
          </div>
        }
      >
        {customer && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line-subtle px-4 py-2.5 text-[12px] text-content-muted sm:px-5">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" aria-hidden />
              {ticket.businessName ?? "Unknown workspace"}
            </span>
            {customer.plan && (
              <span>
                {titleise(customer.plan)}
                {customer.status && customer.status !== "active"
                  ? ` · ${titleise(customer.status)}`
                  : ""}
              </span>
            )}
            <span>
              {customer.memberCount} member{customer.memberCount === 1 ? "" : "s"}
            </span>
            {customer.integrationProblems.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-warning-700">
                <CircleAlert className="size-3.5" aria-hidden />
                {customer.integrationProblems.map(titleise).join(", ")} needs
                attention
              </span>
            )}
            {customer.openJobFailures > 0 && (
              <span className="text-danger-600">
                {customer.openJobFailures} failed background job
                {customer.openJobFailures === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {messages.length === 0 ? (
          <PanelEmpty>This ticket has no messages yet.</PanelEmpty>
        ) : (
          <ol className="space-y-3 px-4 py-4 sm:px-5">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-lg border px-3.5 py-2.5",
                  message.direction === "INBOUND"
                    ? "border-line bg-surface-sunken"
                    : "ml-auto border-accent-200/60 bg-accent-50",
                )}
              >
                <p className="text-[11.5px] text-content-subtle">
                  {message.direction === "INBOUND"
                    ? (message.authorName ?? "Customer")
                    : (message.authorName ?? "ClientTurn support")}
                  {" · "}
                  {formatRelative(message.createdAt)}
                  {message.channel === "EMAIL" && " · by email"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-content">
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
        )}

        {/* ------------------------------------------------------ composer */}
        <div className="border-t border-line-subtle px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-1.5">
            <ModeTab
              active={mode === "reply"}
              tone="reply"
              label="Reply to customer"
              onSelect={() => setMode("reply")}
            />
            <ModeTab
              active={mode === "note"}
              tone="note"
              label="Internal note"
              onSelect={() => setMode("note")}
            />
          </div>

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            maxLength={5000}
            placeholder={
              mode === "reply"
                ? "Write the reply the customer will read…"
                : "Only other operators will see this."
            }
            className={cn(
              "mt-2 w-full resize-y rounded-lg border px-3 py-2.5 text-[13px] text-content outline-none transition-colors placeholder:text-content-subtle focus:border-line-strong",
              mode === "reply"
                ? "border-line bg-surface"
                : "border-warning-100 bg-warning-50/50",
            )}
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11.5px] text-content-subtle">
              {mode === "reply" ? (
                "Stored on the ticket and delivered by the mail worker."
              ) : (
                <span className="inline-flex items-center gap-1.5 text-warning-700">
                  <Lock className="size-3.5" aria-hidden />
                  Never shown to the customer.
                </span>
              )}
            </p>
            <Button
              size="sm"
              variant={mode === "reply" ? "primary" : "secondary"}
              loading={busy}
              disabled={!canSubmit}
              onClick={submit}
            >
              {mode === "reply" ? "Send reply" : "Save note"}
            </Button>
          </div>
        </div>
      </Panel>

      {notes.length > 0 && (
        <Panel
          icon={Lock}
          tone="warning"
          title="Internal notes"
          description="Operators only. Not part of the customer conversation."
        >
          <ul className="divide-y divide-line-subtle">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-content-subtle">
                    {formatRelative(note.createdAt)}
                  </span>
                  {note.isAiDraft && (
                    <Badge tone="purple" dense>
                      Copilot draft
                    </Badge>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-content">
                  {note.body}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ModeTab({
  active,
  tone,
  label,
  onSelect,
}: {
  active: boolean;
  tone: "reply" | "note";
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
        !active && "text-content-muted hover:bg-surface-hover hover:text-content",
        active && tone === "reply" && "bg-accent-50 text-content-accent",
        active && tone === "note" && "bg-warning-50 text-warning-700",
      )}
    >
      {label}
    </button>
  );
}
