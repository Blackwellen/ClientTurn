"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  MapPin,
  Radar,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { SearchMessageView } from "@/lib/find-leads/types";
import { ChatComposer } from "../chat-composer";
import { sendSearchMessageAction } from "@/lib/find-leads/actions";

/**
 * The search conversation.
 *
 * The assistant's structured interpretation renders inline, inside its own
 * message, and that placement is a hard requirement rather than a flourish:
 * V4 §10.5 says the customer must be able to see how their words were read
 * *before* any spend, and burying that in a side panel they might not scroll
 * to would fail the requirement while looking like it met it.
 */

const SUGGESTIONS: { icon: React.ComponentType<{ className?: string }>; label: string; message: string }[] = [
  {
    icon: Sparkles,
    label: "Add intent signals",
    message:
      "Add buying-intent signals for roof repair, maintenance and building works from the last 90 days.",
  },
  {
    icon: Ban,
    label: "Exclude existing customers",
    message: "Exclude any companies that are already customers or existing leads.",
  },
  {
    icon: Users,
    label: "Target facilities managers",
    message: "Also target facilities managers and operations directors, not just property managers.",
  },
  {
    icon: MapPin,
    label: "Expand radius",
    message: "Expand the search radius to 60 miles.",
  },
  {
    icon: ShieldCheck,
    label: "Only verified contacts",
    message: "Only include prospects with a verified, deliverable email address.",
  },
];

export function SearchConversation({
  sessionId,
  messages,
}: {
  sessionId: string;
  messages: SearchMessageView[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const send = (message: string) => {
    startTransition(async () => {
      const result = await sendSearchMessageAction(sessionId, message);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      router.refresh();
    });
  };

  return (
    <section
      aria-label="Search conversation"
      className="flex min-h-[620px] flex-col rounded-xl border border-line bg-surface shadow-xs"
    >
      <header className="px-5 py-4">
        <h2 className="text-[15px] font-semibold text-content">Search conversation</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-content-muted">
          Tell ClientTurn what you&rsquo;re looking for, and we&rsquo;ll turn it into a
          structured search plan.
        </p>
      </header>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && (
          <p className="py-10 text-center text-[13px] text-content-muted">
            Describe the businesses or people you want to find to get started.
          </p>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {pending && (
          <div className="flex items-center gap-2 text-[12.5px] text-content-muted">
            <Sparkles className="size-3.5 animate-pulse text-content-accent" aria-hidden />
            ClientTurn AI is thinking…
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-line-subtle px-5 py-4">
        <p className="mb-2 text-[11.5px] font-medium text-content-muted">
          Try these suggestions
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={pending}
              // A chip sends an instruction to the agent. It never edits the
              // plan directly, and it never starts a run — a suggestion the
              // customer taps by accident must not be able to spend money.
              onClick={() => send(suggestion.message)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2",
                "text-[12.5px] font-medium text-content transition-colors",
                "hover:border-accent-200 hover:bg-accent-50/50",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <suggestion.icon className="size-3.5 text-content-subtle" aria-hidden />
              {suggestion.label}
            </button>
          ))}
        </div>

        <ChatComposer
          onSend={send}
          pending={pending}
          placeholder="Tell me what businesses you want to find..."
        />
      </div>
    </section>
  );
}

function Message({ message }: { message: SearchMessageView }) {
  const time = new Date(message.createdAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (message.role === "USER") {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-accent-50 px-3.5 py-2.5">
          <p className="sr-only">You said:</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-content">
            {message.content}
          </p>
          <p className="mt-1 text-right text-[10.5px] tabular-nums text-content-subtle">
            {time}
          </p>
        </div>
      </div>
    );
  }

  if (message.role === "SYSTEM_EVENT") {
    return (
      <p className="text-center text-[11.5px] text-content-subtle">
        <Radar className="mr-1 inline size-3" aria-hidden />
        {message.content}
      </p>
    );
  }

  return (
    <div className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
      >
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-content">ClientTurn AI</span>
          <span className="text-[10.5px] tabular-nums text-content-subtle">{time}</span>
        </div>
        <p className="sr-only">ClientTurn AI said:</p>
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-content-secondary">
          {message.content}
        </p>

        {message.planSummary && message.planSummary.length > 0 && (
          <dl className="mt-2.5 rounded-lg bg-accent-50/50 px-3.5 py-3">
            {message.planSummary.map((line) => (
              <div key={line.label} className="flex gap-3 py-0.5">
                <dt className="w-[104px] shrink-0 text-[12px] font-medium text-content-secondary">
                  {line.label}
                </dt>
                <dd className="min-w-0 flex-1 text-[12px] text-content">{line.value}</dd>
              </div>
            ))}
            <p className="mt-2 border-t border-accent-200/50 pt-2 text-[11.5px] text-content-muted">
              Review the plan on the right before we start sourcing. Nothing is spent
              until you do.
            </p>
          </dl>
        )}
      </div>
    </div>
  );
}
