import * as React from "react";
import { AlertCircle, Bot, ShieldOff, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { dayGroupLabel, formatDateTime } from "@/lib/dates";
import type { ConversationMessage } from "@/lib/leads/types";
import { MESSAGE_STATUS } from "@/components/ui/badge";

/**
 * Provider-reported statuses that never reach `messages.status`.
 *
 * The workspace statuses live in `MESSAGE_STATUS` and are not restated here:
 * one status map, per the project rules, and this thread previously carried a
 * second copy that had already drifted -- it knew about `UNDELIVERED` and
 * `SENDING`, which the badge map does not, and would not have known about
 * `BLOCKED`, which it now does.
 */
const PROVIDER_LABEL: Record<string, string> = {
  SENDING: "Sending",
  UNDELIVERED: "Not delivered",
};

function deliveryLabel(status: string): string {
  return (
    MESSAGE_STATUS[status as keyof typeof MESSAGE_STATUS]?.label ??
    PROVIDER_LABEL[status] ??
    status
  );
}

function groupByDay(messages: ConversationMessage[]) {
  const groups: { day: string; items: ConversationMessage[] }[] = [];
  for (const message of messages) {
    const day = dayGroupLabel(message.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(message);
    else groups.push({ day, items: [message] });
  }
  return groups;
}

export function ConversationThread({
  messages,
}: {
  messages: ConversationMessage[];
}) {
  if (messages.length === 0) {
    return (
      <p className="text-content-muted px-1 py-8 text-center text-[13px]">
        No messages yet. The first follow-up is sent as soon as the automation
        runs.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groupByDay(messages).map((group) => (
        <section key={group.day} aria-label={group.day}>
          <div className="mb-2 flex items-center gap-2">
            <span className="bg-line h-px flex-1" aria-hidden />
            <span className="text-content-subtle text-[11px] font-medium">
              {group.day}
            </span>
            <span className="bg-line h-px flex-1" aria-hidden />
          </div>

          <ol className="space-y-2">
            {group.items.map((message) => {
              const outbound = message.direction === "outbound";
              // A send the provider refused, which is a fault to investigate.
              const failed =
                message.status === "FAILED" || message.status === "UNDELIVERED";
              // A send *we* refused. Nothing is broken -- usually the recipient
              // opted out -- so the reason is shown plainly rather than in the
              // red used for a delivery fault.
              const blocked = message.status === "BLOCKED";

              return (
                <li
                  key={message.id}
                  className={cn("flex", outbound ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] min-w-0 rounded-xl px-3 py-2 text-[13px]",
                      outbound
                        ? "border border-accent-200 bg-accent-50 text-content"
                        : "border border-line bg-surface-sunken text-content",
                    )}
                  >
                    <p className="break-words whitespace-pre-wrap">{message.body}</p>

                    <div
                      className={cn(
                        "mt-1 flex flex-wrap items-center gap-1.5 text-[11px]",
                        "text-content-subtle",
                      )}
                    >
                      <span>{formatDateTime(message.created_at)}</span>
                      <span aria-hidden>·</span>
                      <span className="uppercase">{message.channel}</span>
                      <span aria-hidden>·</span>
                      <span>{deliveryLabel(message.status)}</span>
                      {outbound && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-0.5">
                            {message.origin === "manual" ? (
                              <>
                                <User className="size-3" aria-hidden />
                                Sent by a person
                              </>
                            ) : (
                              <>
                                <Bot className="size-3" aria-hidden />
                                Automated
                              </>
                            )}
                          </span>
                        </>
                      )}
                    </div>

                    {(failed || blocked) && message.error_message && (
                      <p
                        className={cn(
                          "mt-1.5 flex items-start gap-1 rounded-md px-1.5 py-1 text-[11px]",
                          blocked
                            ? "bg-surface-sunken text-content-subtle"
                            : "bg-danger-50 text-danger-700",
                        )}
                      >
                        {blocked ? (
                          <ShieldOff className="mt-px size-3 shrink-0" aria-hidden />
                        ) : (
                          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
                        )}
                        {message.error_message}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
