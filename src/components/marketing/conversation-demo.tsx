"use client";

import { cn } from "@/lib/cn";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Section, SectionHeading } from "./section";
import { useStagedReveal } from "./use-staged";

type Bubble = { from: "business" | "lead"; time: string; text: string };

const CONVERSATION: Bubble[] = [
  {
    from: "business",
    time: "10:32",
    text: "Hi Sarah, it's Dan at Coastline Roofing — thanks for your enquiry about a roof replacement. Are you still looking to get this sorted? Reply STOP to opt out.",
  },
  {
    from: "lead",
    time: "10:34",
    text: "Yes please. The whole back roof needs doing.",
  },
  {
    from: "business",
    time: "10:34",
    text: "Great. What's your postcode, and are you the homeowner?",
  },
  {
    from: "lead",
    time: "10:36",
    text: "BH14, and yes it's our house. Ideally done within the month.",
  },
  {
    from: "business",
    time: "10:40",
    text: "Perfect — we cover BH14. Here's my diary, pick any slot for a free survey: coastlineroofing.co.uk/book",
  },
];

const RECORD = [
  { label: "Lead", value: "Sarah Morgan" },
  { label: "Service", value: "Roof replacement" },
  { label: "Postcode", value: "BH14" },
  { label: "Timing", value: "Within 30 days" },
  { label: "Owner", value: "Yes" },
] as const;

export function ConversationDemo() {
  const { ref, revealed } = useStagedReveal(CONVERSATION.length, 900);

  return (
    <Section id="demo">
      <SectionHeading
        eyebrow="Product demo"
        title="What the customer sees, and what you see."
        description="One conversation, running to your script. Every answer lands on the lead record so nobody has to re-ask."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-8">
        <div
          ref={ref}
          className="rounded-2xl border border-line bg-surface-sunken/70 p-4 shadow-xs sm:p-6"
        >
          <div className="flex items-center justify-between gap-3 pb-5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full bg-accent-600 text-[12px] font-semibold text-white"
              >
                SM
              </span>
              <div>
                <p className="text-[13px] font-semibold text-content">
                  Sarah Morgan
                </p>
                <p className="text-[11px] text-content-muted">SMS · +44 7700 900xxx</p>
              </div>
            </div>
            <Badge tone="neutral">Illustrative</Badge>
          </div>

          <ul className="space-y-3" aria-label="Example conversation">
            {CONVERSATION.map((bubble, index) => {
              const shown = index < revealed;
              const fromBusiness = bubble.from === "business";
              return (
                <li
                  key={`${bubble.time}-${index}`}
                  className={cn(
                    "flex transition-opacity duration-[var(--lr-duration-slow)]",
                    fromBusiness ? "justify-start" : "justify-end",
                    shown ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden={!shown}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3.5 py-2.5 shadow-xs sm:max-w-[78%]",
                      fromBusiness
                        ? "rounded-bl-sm border border-line bg-surface text-content"
                        : "rounded-br-sm bg-accent-600 text-white",
                    )}
                  >
                    <p className="text-[13px] leading-relaxed">{bubble.text}</p>
                    <p
                      className={cn(
                        "lr-tabular mt-1.5 text-[11px]",
                        fromBusiness ? "text-content-muted" : "text-accent-100",
                      )}
                    >
                      {bubble.time}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h3 className="text-[15px] font-semibold text-content">Lead record</h3>
          <p className="mt-1 text-[12px] text-content-muted">
            Updated automatically as the conversation progresses.
          </p>

          <dl className="mt-6 divide-y divide-line-subtle">
            {RECORD.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <dt className="text-[13px] text-content-muted">{row.label}</dt>
                <dd className="text-[13px] font-medium text-content">
                  {row.value}
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[13px] text-content-muted">Status</dt>
              <dd>
                <StatusBadge kind="lead" value="QUALIFIED" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-[13px] text-content-muted">Next action</dt>
              <dd className="text-[13px] font-medium text-content">
                Booking link sent
              </dd>
            </div>
          </dl>

          <p className="mt-6 rounded-lg border border-line-subtle bg-surface-sunken px-3 py-2.5 text-[12px] leading-relaxed text-content-muted">
            Example data for demonstration. It is not a real customer or a real
            conversation.
          </p>
        </div>
      </div>
    </Section>
  );
}
