"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { Container } from "./section";
import { MarketingSection, SectionIntro } from "./sections/shell";

const FAQS = [
  {
    q: "Do I need to change my Facebook ads?",
    a: "No. Keep your campaigns, creatives and lead forms exactly as they are. You connect the Facebook account that owns them, choose which pages and forms ClientTurn should watch, and everything else stays untouched.",
  },
  {
    q: "Can I use my current CRM?",
    a: "Yes. ClientTurn is not trying to replace your CRM — it handles the gap between the lead form and the booked appointment. Qualified leads and their full conversation can be exported, and you can keep working the way you already do once a job is booked.",
  },
  {
    q: "Can ClientTurn use my existing phone number?",
    a: "In most cases, yes. You can send from a number you already control through a supported messaging provider, or use a new dedicated number. Which options are available depends on your provider and on UK numbering rules, so we confirm this during setup.",
  },
  {
    q: "Does it support WhatsApp?",
    a: "Yes, on the Growth plan and above. WhatsApp requires an approved business sender and approved message templates for the first contact, which is part of setup. SMS is available on every plan.",
  },
  {
    q: "What happens when someone replies?",
    a: "The follow-up sequence stops immediately and the conversation moves into qualification. Their answers are recorded against the lead, and anything the rules cannot match confidently is flagged for a person rather than guessed at.",
  },
  {
    q: "How does qualification work?",
    a: "You configure the questions — service, postcode, timing, ownership, budget, whatever matters to you — and the rules that decide what a good answer looks like. The questions are asked in order and the rules make the decision every time. It is deterministic, so the same answers always produce the same outcome.",
  },
  {
    q: "Can someone opt out?",
    a: "Yes, and it is enforced. Every outbound message carries an opt-out instruction, opt-out replies are honoured immediately, and the opt-out is re-checked right before every send — including reactivation campaigns. Quiet hours and per-contact attempt limits apply as well.",
  },
  {
    q: "Can I reactivate old leads?",
    a: "Yes, on the Growth plan and above. You can import or select past enquiries, filter out opt-outs and closed work, and run them through the same follow-up and qualification as new leads. You are responsible for having a lawful basis to contact them.",
  },
  {
    q: "Does it replace my sales team?",
    a: "No. It removes the delay and the admin so your team spends its time on people who are actually ready to talk. ClientTurn never quotes, never promises availability and never commits you to anything — anything outside the configured questions goes to a human.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Self-serve plans are cancelled from your billing settings and run to the end of the period you have paid for. There is no cancellation fee and no minimum term.",
  },
  {
    q: "Is there a free trial?",
    a: `Yes — ${TRIAL_DAYS} days, no card required. You can connect Meta, configure your messages and questions and see the whole flow run before you pay anything.`,
  },
] as const;

export function Faq() {
  const [open, setOpen] = React.useState<number | null>(0);
  const buttonRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = FAQS.length - 1;
    let next: number | null = null;

    if (event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;

    if (next !== null) {
      event.preventDefault();
      buttonRefs.current[next]?.focus();
    }
  }

  return (
    <MarketingSection id="faq" depth={3} labelledBy="faq-heading">
      <SectionIntro
        id="faq-heading"
        align="centre"
        eyebrow="FAQ"
        title="The questions we get asked first."
        lead="Everything below describes how the product actually behaves today."
      />
      <Container>
        <div className="ct-faq">
        {FAQS.map((faq, index) => {
          const expanded = open === index;
          return (
            <div key={faq.q} className="ct-faq-row">
              <h3>
                <button
                  type="button"
                  ref={(node) => {
                    buttonRefs.current[index] = node;
                  }}
                  id={`faq-button-${index}`}
                  aria-expanded={expanded}
                  aria-controls={`faq-panel-${index}`}
                  onClick={() => setOpen(expanded ? null : index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className="ct-faq-trigger"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn("ct-faq-chevron", expanded && "ct-faq-chevron-open")}
                  />
                </button>
              </h3>
              <div
                id={`faq-panel-${index}`}
                role="region"
                aria-labelledby={`faq-button-${index}`}
                hidden={!expanded}
                className="ct-faq-panel"
              >
                <p>{faq.a}</p>
              </div>
            </div>
          );
        })}
        </div>
      </Container>
    </MarketingSection>
  );
}
