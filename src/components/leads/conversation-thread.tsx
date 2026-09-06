import * as React from "react";
import { AlertCircle, Bot, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { dayGroupLabel, formatDateTime } from "@/lib/dates";
import type { ConversationMessage } from "@/lib/leads/types";

const DELIVERY_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  SENDING: "Sending",
  SENT: "Sent",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  UNDELIVERED: "Not delivered",
  RECEIVED: "Received",
};

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
              const failed =
                message.status === "FAILED" || message.status === "UNDELIVERED";

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
                      <span>{DELIVERY_LABEL[message.status] ?? message.status}</span>
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

                    {failed && message.error_message && (
                      <p
                        className={cn(
                          "mt-1.5 flex items-start gap-1 rounded-md px-1.5 py-1 text-[11px]",
                          "bg-danger-50 text-danger-700",
                        )}
                      >
                        <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
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
