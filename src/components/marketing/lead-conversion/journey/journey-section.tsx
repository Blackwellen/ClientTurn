"use client";

import Image from "next/image";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Filter,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
} from "lucide-react";
import { LcpCta } from "../lcp-cta";
import {
  Reveal,
  RevealGroup,
  RevealItem,
  panelEnter,
  softFade,
} from "../motion";
import { BenefitStrip } from "../primitives";
import { AnalyticsPanel } from "./analytics-panel";
import { BookingPanel } from "./booking-panel";
import { ReactivationPanel } from "./reactivation-panel";

const ICON = { size: 15, strokeWidth: 2 } as const;

const COLUMNS = [
  {
    icon: CalendarCheck,
    eyebrow: "Booking",
    title: "Route the right lead to the right next step.",
    lead: "Automatically book appointments or hand over qualified leads to your team, based on your rules.",
    panel: <BookingPanel />,
    benefits: [
      { icon: <CalendarDays {...ICON} />, label: <>Calendly or your own booking system</> },
      { icon: <ClipboardCheck {...ICON} />, label: <>Automatic confirmation</> },
      { icon: <FileText {...ICON} />, label: <>Full lead context included</> },
    ],
  },
  {
    icon: RefreshCw,
    eyebrow: "Reactivation",
    title: "Give older eligible enquiries another chance to convert.",
    lead: "Find and re-engage past enquiries with built-in suppression, so you only contact the right people.",
    panel: <ReactivationPanel />,
    benefits: [
      { icon: <ShieldCheck {...ICON} />, label: <>Built-in suppression and unsubscribe handling</> },
      { icon: <FileText {...ICON} />, label: <>Flexible message templates</> },
      { icon: <BarChart3 {...ICON} />, label: <>Track results and replies</> },
    ],
  },
  {
    icon: BarChart3,
    eyebrow: "Analytics",
    title: "See where opportunities move — and where they stall.",
    lead: "Track the entire conversion journey, from new lead to won business, with clear performance insights.",
    panel: <AnalyticsPanel />,
    benefits: [
      { icon: <Filter {...ICON} />, label: <>Full funnel visibility</> },
      { icon: <TrendingDown {...ICON} />, label: <>Identify drop-off points</> },
      { icon: <Target {...ICON} />, label: <>Make data-driven improvements</> },
    ],
  },
];

export function JourneySection() {
  return (
    <section
      id="lcp-journey"
      className="lcp-section lcp-band lcp-journey"
      aria-labelledby="lcp-journey-title"
    >
      <span className="lcp-texture" aria-hidden />
      <div className="lcp-shell">
        <RevealGroup className="lcp-band-head" step={0.1}>
          <RevealItem>
            <span className="lcp-eyebrow">Complete the journey</span>
            <h2 id="lcp-journey-title">
              From response to revenue,{" "}
              <span className="lcp-accent">without the manual work.</span>
            </h2>
          </RevealItem>
          <RevealItem as="p">
            Book appointments, re-engage past enquiries and track performance
            across the full conversion journey.
          </RevealItem>
          <RevealItem>
          <LcpCta
            placement="lead_conversion_journey"
            className="lcp-btn lcp-btn-sm lcp-btn-ghost"
          >
            See the full platform <ArrowRight size={15} aria-hidden />
          </LcpCta>
          </RevealItem>
        </RevealGroup>

        <div className="lcp-columns">
          {COLUMNS.map((column, i) => {
            const Icon = column.icon;
            return (
              <RevealGroup
                key={column.eyebrow}
                className="lcp-col lcp-journey-col"
                step={0.08}
                delay={i * 0.08}
              >
                <RevealItem as="span" className="lcp-journey-icon" aria-hidden>
                  <Icon size={24} strokeWidth={2} />
                </RevealItem>
                <RevealItem as="span" className="lcp-eyebrow">
                  {column.eyebrow}
                </RevealItem>
                <RevealItem as="div">
                  <h3>{column.title}</h3>
                </RevealItem>
                <RevealItem as="p">{column.lead}</RevealItem>
                <RevealItem className="lcp-col-panel" variants={panelEnter}>
                  {column.panel}
                </RevealItem>
                <RevealItem as="div" className="lcp-benefits-slot">
                  <BenefitStrip items={column.benefits} />
                </RevealItem>
              </RevealGroup>
            );
          })}
        </div>

        <Reveal className="lcp-strip" variants={softFade}>
          <span className="lcp-strip-mark" aria-hidden>
            <Image src="/Favicon.png" alt="" width={64} height={64} />
          </span>
          <p>
            More booked appointments. More revenue opportunities. A more
            efficient team.
          </p>
          <LcpCta
            placement="lead_conversion_strip"
            className="lcp-btn lcp-btn-primary"
          >
            Start Free <ArrowRight size={17} aria-hidden />
          </LcpCta>
        </Reveal>
      </div>
    </section>
  );
}
