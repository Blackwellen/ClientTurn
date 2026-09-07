"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BarChart3, CalendarDays, MessageSquareText, Search, Target, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, SectionHeading } from "../ui";
import { AcquisitionFrame, AnalyticsFrame, AppFrame, DashboardFrame } from "./app-frames";
import { Reveal } from "../reveal";

/**
 * "See the system working" — the product showcase.
 *
 * A real ARIA tab set: the tablist is keyboard-driven with arrow keys, Home
 * and End, each tab owns its panel, and the panels never auto-advance. A
 * carousel that changes under the visitor is the thing this section exists to
 * avoid — the point is that they can look at whichever surface they came for.
 *
 * The callouts describe capabilities, never outcomes.
 */

type Callout = { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; title: string; copy: string };

type Tab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  frame: React.ReactNode;
  frameLabel: string;
  left: Callout[];
  right: Callout[];
};

const TABS: Tab[] = [
  {
    id: "lead-conversion",
    label: "Lead Conversion",
    icon: Users,
    frame: <DashboardFrame />,
    frameLabel:
      "ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.",
    left: [
      {
        icon: Users,
        title: "Unified lead inbox",
        copy: "Keep every lead in one place, with its source, status and full history.",
      },
    ],
    right: [
      {
        icon: CalendarDays,
        title: "Booking and handover",
        copy: "Track qualified leads automatically and route them to your team.",
      },
      {
        icon: MessageSquareText,
        title: "Follow-up and qualification",
        copy: "Coordinate email, SMS and WhatsApp follow-up, and apply your qualification rules.",
      },
    ],
  },
  {
    id: "acquisition",
    label: "Acquisition",
    icon: Search,
    frame: <AcquisitionFrame />,
    frameLabel:
      "ClientTurn Find Leads screen showing a natural-language target, the filters derived from it and a list of verified prospects with scores.",
    left: [
      {
        icon: Target,
        title: "Natural-language targeting",
        copy: "Describe the customer you want. ClientTurn turns it into filters you can edit.",
      },
    ],
    right: [
      {
        icon: Search,
        title: "Structured search plan",
        copy: "Sources, filters, enrichment and verification, each shown as its own step.",
      },
      {
        icon: Users,
        title: "Verified prospect pipeline",
        copy: "Contacts reach your review queue only once their details are confirmed.",
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    frame: <AnalyticsFrame />,
    frameLabel:
      "ClientTurn analytics screen showing lead, qualified, appointment and converted counts with conversion and lead-source performance charts.",
    left: [
      {
        icon: BarChart3,
        title: "Acquisition performance",
        copy: "See which sources bring the enquiries that actually go somewhere.",
      },
    ],
    right: [
      {
        icon: MessageSquareText,
        title: "Outreach performance",
        copy: "Compare how each channel and sequence is performing over time.",
      },
      {
        icon: CalendarDays,
        title: "Conversion journey",
        copy: "Follow the whole path from first contact to a booked appointment.",
      },
    ],
  },
];

/* ---------------------------------------------------------- callouts --- */

function CalloutCard({
  callout,
  side,
}: {
  callout: Callout;
  side: "left" | "right";
}) {
  return (
    <div className="relative">
      <div className="pub-card flex items-start gap-3 p-4">
        <span className="pub-tile" style={{ width: 34, height: 34, borderRadius: 9 }}>
          <callout.icon className="size-4" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-[var(--pub-text)]">
            {callout.title}
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--pub-text-secondary)]">
            {callout.copy}
          </span>
        </span>
      </div>
      {/* The thin lime leader that ties the callout to the frame. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 hidden h-px w-[clamp(16px,2.5vw,44px)] bg-[linear-gradient(90deg,rgb(183_243_74/0.7),rgb(183_243_74/0.15))] xl:block",
          side === "left" ? "left-full" : "right-full rotate-180",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pub-node-dot absolute top-1/2 hidden -translate-y-1/2 xl:block",
          side === "left" ? "left-full -ml-1" : "right-full -mr-1",
        )}
      />
    </div>
  );
}

/* =========================================================== section === */

export function ProductProofSection() {
  const [activeId, setActiveId] = React.useState(TABS[0].id);
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const reduceMotion = useReducedMotion();

  const active = TABS.find((tab) => tab.id === activeId) ?? TABS[0];

  function select(id: string) {
    setActiveId(id);
    trackEngagement("product_showcase_tab_change", id);
  }

  /* Arrow keys move between tabs and activate as they go, which is the
     expected behaviour for an automatic-activation tablist. */
  function onKeyDown(event: React.KeyboardEvent) {
    const index = TABS.findIndex((tab) => tab.id === activeId);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next];
    select(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <PublicSection
      id="proof"
      labelledBy="proof-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Glow x="centre" y="middle" style={{ opacity: 0.9 }} />
        </>
      }
    >
      <PublicContainer>
        <Reveal>
        <SectionHeading
          id="proof-heading"
          align="centre"
          eyebrow="Real product proof"
          eyebrowPill
          title={
            <>
              See the system <span className="pub-accent">working.</span>
            </>
          }
          description="Explore the same workflows your team will use inside ClientTurn."
        />
        </Reveal>

        <div className="mt-10 flex justify-center">
          <div
            role="tablist"
            aria-label="Product areas"
            onKeyDown={onKeyDown}
            className="flex w-full flex-col gap-1 rounded-xl border border-[var(--pub-border)] bg-[rgb(255_255_255/0.02)] p-1 sm:w-auto sm:flex-row"
          >
            {TABS.map((tab) => {
              const selected = tab.id === activeId;
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabRefs.current[tab.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`showcase-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`showcase-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(tab.id)}
                  className={cn(
                    "inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-7 text-[15px] font-medium transition-colors",
                    selected
                      ? "border border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] font-semibold text-[var(--pub-text)] shadow-[0_0_28px_-10px_rgb(183_243_74/0.6)]"
                      : "border border-transparent text-[var(--pub-text-secondary)] hover:text-[var(--pub-text)]",
                  )}
                >
                  <tab.icon
                    aria-hidden
                    className={cn("size-4", selected && "text-[var(--pub-lime)]")}
                    strokeWidth={2.1}
                  />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {TABS.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`showcase-panel-${tab.id}`}
            aria-labelledby={`showcase-tab-${tab.id}`}
            hidden={tab.id !== activeId}
            className="mt-12"
          >
            {tab.id === activeId ? (
              <div className="grid items-center gap-8 xl:grid-cols-[minmax(0,0.62fr)_minmax(0,2.5fr)_minmax(0,0.62fr)] xl:gap-6">
                <div className="order-2 space-y-5 xl:order-1">
                  {active.left.map((callout) => (
                    <CalloutCard key={callout.title} callout={callout} side="left" />
                  ))}
                  {/* On narrow screens the right-hand callouts join this list
                      so nothing is lost when the three columns collapse. */}
                  <div className="space-y-5 xl:hidden">
                    {active.right.map((callout) => (
                      <CalloutCard key={callout.title} callout={callout} side="left" />
                    ))}
                  </div>
                </div>

                <div className="order-1 xl:order-2">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={active.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                      transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.32, 0.72, 0, 1] }}
                    >
                      <AppFrame label={active.frameLabel}>{active.frame}</AppFrame>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="order-3 hidden space-y-5 xl:block">
                  {active.right.map((callout) => (
                    <CalloutCard key={callout.title} callout={callout} side="right" />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        <p className="pub-small mt-10 text-center">
          Screens shown with sample data. No customer information is displayed.
        </p>
      </PublicContainer>
    </PublicSection>
  );
}
