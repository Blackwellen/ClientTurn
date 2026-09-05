import { ChevronRight } from "lucide-react";
import { Section, ScrollArea } from "./section";
import { CtaLink } from "./cta";

const FLOW = [
  { step: "Old leads", detail: "Import or select past enquiries" },
  { step: "Filter eligible contacts", detail: "Exclude opt-outs and won work" },
  { step: "Send reactivation message", detail: "Your wording, your number" },
  { step: "Lead responds", detail: "Conversation opens again" },
  { step: "Qualification", detail: "The same questions, in order" },
  { step: "Booking", detail: "Link sent or handed to a person" },
] as const;

export function Reactivation() {
  return (
    <Section id="reactivation" tone="sunken">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-16">
        <div className="max-w-xl">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-content-accent">
            Reactivation
          </p>
          <h2 className="mt-3 text-balance text-[26px] font-semibold leading-tight tracking-tight text-content sm:text-[34px]">
            You already paid for the old leads.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-content-secondary sm:text-base">
            Every business running Meta ads has a list of enquiries that went
            quiet. Reactivation campaigns re-contact the ones still eligible,
            put them through the same qualification, and book the ones that are
            still interested — with no new ad spend.
          </p>
          <ul className="mt-6 space-y-2.5">
            {[
              "Opt-outs and do-not-contact records are excluded before a single message is queued.",
              "Quiet hours and per-contact attempt limits apply exactly as they do to new leads.",
              "Every reactivated booking is attributed back to the campaign it came from.",
            ].map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13px] leading-relaxed text-content-secondary"
              >
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-500"
                />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <CtaLink placement="reactivation" size="lg">
              Start Free
            </CtaLink>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <ScrollArea>
            <ol className="flex min-w-max flex-col gap-0 lg:min-w-0">
              {FLOW.map((node, index) => (
                <li key={node.step}>
                  <div className="rounded-lg border border-line-subtle bg-surface-sunken/70 px-4 py-3">
                    <p className="text-[13px] font-semibold text-content">
                      {node.step}
                    </p>
                    <p className="mt-0.5 text-[12px] text-content-muted">
                      {node.detail}
                    </p>
                  </div>
                  {index < FLOW.length - 1 && (
                    <div className="flex justify-center py-1.5" aria-hidden>
                      <ChevronRight className="size-4 rotate-90 text-content-subtle" />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        </div>
      </div>
    </Section>
  );
}
