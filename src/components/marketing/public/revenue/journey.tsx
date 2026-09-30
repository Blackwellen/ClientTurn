"use client";

import * as React from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
} from "motion/react";
import { useReducedMotion } from "@/components/marketing/use-reduced-motion";
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
    body: "From your Meta form, website, Google Ads or CRM.",
    ui: <Mini k="Meta lead form" v={`${EXAMPLE.lead}, ${EXAMPLE.company}`} />,
  },
  {
    id: "intent",
    icon: ScanSearch,
    title: "It understands the intent",
    body: "What they want, and what they agreed to.",
    ui: <Mini k="Intent" v="Quote · wants a call" />,
  },
  {
    id: "calls",
    icon: PhoneCall,
    title: "The AI Sales Agent calls",
    body: "Only if they asked, within their calling hours.",
    ui: <Mini k="Opens with" v="“This is an AI assistant…”" />,
  },
  {
    id: "qualifies",
    icon: SquareCheckBig,
    title: "It qualifies",
    body: "Your questions. Your rules give the verdict.",
    ui: <Mini k="Verdict" v="Qualified" pill />,
  },
  {
    id: "objections",
    icon: ShieldQuestion,
    title: "It handles objections",
    body: "Honest answers, no discount you have not allowed.",
    ui: <Mini k="Objection" v="Price" amber />,
  },
  {
    id: "quotes",
    icon: FileText,
    title: "It quotes",
    body: "Priced by your catalogue and rules, never the model.",
    ui: <Mini k={`Quote ${EXAMPLE.quoteNumber}`} v={`${money(QUOTE_NET_PENCE, true)} + VAT`} />,
  },
  {
    id: "closes",
    icon: CalendarCheck,
    title: "It books or closes",
    body: "A meeting in your calendar, or a signed quote.",
    ui: <Mini k="Signed" v="Kick-off Tue 10:00" />,
  },
  {
    id: "payment",
    icon: CreditCard,
    title: "Payment is collected",
    body: "Deposit or balance, through your own Stripe.",
    ui: <Mini k="Deposit" v={`${money(QUOTE_DEPOSIT_PENCE)} paid`} />,
  },
  {
    id: "follows",
    icon: MessagesSquare,
    title: "It follows up everywhere",
    body: "Call, email, SMS and WhatsApp in one thread.",
    ui: <Mini k="Channels" v="4 in one thread" />,
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Analytics update",
    body: "Revenue attributed to the source that earned it.",
    ui: <Mini k="Attributed to" v="Meta lead form" />,
  },
];

/** One line of product UI: a muted key and a value. */
function Mini({ k, v, pill, amber }: { k: string; v: string; pill?: boolean; amber?: boolean }) {
  return (
    <div className="rv-mini">
      <span className="rv-mini-k">{k}</span>
      {pill || amber ? (
        <span className="rv-pill" data-tone={amber ? "amber" : undefined}>
          {v}
        </span>
      ) : (
        <b>{v}</b>
      )}
    </div>
  );
}

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
