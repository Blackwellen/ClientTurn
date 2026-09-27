"use client";

import * as React from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
} from "motion/react";
import {
  BarChart3,
  CalendarCheck,
  CreditCard,
  FileText,
  Inbox,
  MessagesSquare,
  PhoneCall,
  ScanSearch,
  ShieldQuestion,
  SquareCheckBig,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { EXAMPLE, QUOTE_DEPOSIT_PENCE, QUOTE_NET_PENCE, money } from "./data";

/**
 * The revenue journey, scroll-driven.
 *
 * One AI sales agent across the whole journey, as ten real-looking product
 * cards on a rail. As the visitor scrolls, the rail fills and the card in the
 * reading position becomes active. Scroll position only changes emphasis
 * (border, glow, the rail fill); every card is fully readable in every state,
 * so nothing depends on the animation having run.
 *
 * Reduced motion: the rail is drawn full and every step shows as done. The
 * DOM is identical either way; only the `data-state` values differ, and they
 * are applied after hydration.
 */

type Step = {
  id: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  ui: React.ReactNode;
};

const STEPS: Step[] = [
  {
    id: "arrives",
    icon: Inbox,
    title: "A high-intent lead arrives",
    body: "From your Meta lead form, website, Google Ads or CRM, the moment it is submitted.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">New lead · Meta lead form</span>
        <b>
          {EXAMPLE.lead}, {EXAMPLE.company}
        </b>
        <span className="rv-mini-row">
          <span className="rv-pill">Asked for a call</span>
          <span className="rv-pill" data-tone="muted">
            {EXAMPLE.enquiry}
          </span>
        </span>
      </div>
    ),
  },
  {
    id: "intent",
    icon: ScanSearch,
    title: "It understands the intent",
    body: "What they asked for, how they want to be contacted and what they have agreed to, before anyone replies.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Intent</span>
        <b>Quote request · wants a call</b>
        <span className="rv-mini-row">
          <span className="rv-pill">Consent to call: on the form</span>
        </span>
      </div>
    ),
  },
  {
    id: "calls",
    icon: PhoneCall,
    title: "The AI Sales Agent calls",
    body: "Only leads who asked for a call or agreed on your form, inside calling hours in their own time zone.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Call · 10:14 their time</span>
        <b>&ldquo;This is an AI assistant calling from {EXAMPLE.business}&hellip;&rdquo;</b>
      </div>
    ),
  },
  {
    id: "qualifies",
    icon: SquareCheckBig,
    title: "It qualifies",
    body: "Your questions, asked naturally. Your deterministic rules give the verdict.",
    ui: (
      <ul className="rv-mini rv-checks">
        <li>Project scope captured</li>
        <li>Timeline: before spring</li>
        <li>Decision maker on the call</li>
      </ul>
    ),
  },
  {
    id: "objections",
    icon: ShieldQuestion,
    title: "It handles objections",
    body: "Honest answers from your sales library. No pressure tactics, and no discount you have not allowed.",
    ui: (
      <div className="rv-mini">
        <span className="rv-chip" data-tone="amber">
          Objection: price
        </span>
        <span className="rv-mini-k mt-2">Answered with the itemised quote</span>
      </div>
    ),
  },
  {
    id: "quotes",
    icon: FileText,
    title: "It quotes",
    body: "Priced by your catalogue and rules, never by the model. Branded, versioned, sent in minutes.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Quote {EXAMPLE.quoteNumber}</span>
        <b>{money(QUOTE_NET_PENCE, true)} + VAT</b>
        <span className="rv-mini-row">
          <span className="rv-pill">Sent</span>
          <span className="rv-pill" data-tone="muted">
            Viewed
          </span>
        </span>
      </div>
    ),
  },
  {
    id: "closes",
    icon: CalendarCheck,
    title: "It books or closes",
    body: "A meeting in your calendar, or a signed quote. Whichever your route says is the next step.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Signed · simple electronic signature</span>
        <b>Kick-off booked, Thu 10:30</b>
      </div>
    ),
  },
  {
    id: "payment",
    icon: CreditCard,
    title: "Payment is collected",
    body: "Deposit, balance or instalments, through your own Stripe account.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Deposit invoice</span>
        <b>{money(QUOTE_DEPOSIT_PENCE)} paid</b>
      </div>
    ),
  },
  {
    id: "follows",
    icon: MessagesSquare,
    title: "It follows up across channels",
    body: "Call, email, SMS and WhatsApp in one thread, with stop conditions and quiet hours checked before every send.",
    ui: (
      <div className="rv-mini rv-mini-row">
        <span className="rv-pill">Call</span>
        <span className="rv-pill">Email</span>
        <span className="rv-pill">SMS</span>
        <span className="rv-pill">WhatsApp</span>
      </div>
    ),
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Analytics update",
    body: "Revenue attributed to the source, campaign and conversation that produced it.",
    ui: (
      <div className="rv-mini">
        <span className="rv-mini-k">Attributed to</span>
        <b>Meta lead form · Studio rebuilds</b>
      </div>
    ),
  },
];

export function JourneyRail() {
  const ref = React.useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState<number | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 65%", "end 55%"],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 160, damping: 30, restDelta: 0.001 });

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    if (reduced) return;
    const next = Math.max(0, Math.min(STEPS.length - 1, Math.floor(value * STEPS.length)));
    setActive(next);
  });

  function stateFor(index: number): string | undefined {
    if (reduced) return "done";
    if (active === null) return undefined;
    if (index < active) return "done";
    if (index === active) return "active";
    return "upcoming";
  }

  return (
    <div className="rv-journey">
      <span className="rv-journey-track" aria-hidden>
        <motion.span
          className="rv-journey-fill"
          style={reduced ? { scaleY: 1 } : { scaleY: fill }}
        />
      </span>
      <ol ref={ref} className="rv-journey-steps">
        {STEPS.map((step, index) => (
          <li key={step.id} className="rv-journey-step" data-state={stateFor(index)}>
            <span className="rv-journey-node" aria-hidden>
              <step.icon className="size-4" strokeWidth={2.1} />
            </span>
            <div className={cn("rv-journey-card")}>
              <div className="min-w-0">
                <p className="rv-journey-num">Step {index + 1}</p>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <div className="rv-journey-ui" aria-hidden>
                {step.ui}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
