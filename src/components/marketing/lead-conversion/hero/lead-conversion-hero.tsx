"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  CheckCircle2,
  Inbox,
  ListChecks,
  MessageSquareText,
  Play,
} from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { LcpCta } from "../lcp-cta";
import { useStageLoop } from "../use-stage";
import { LeadConversionAppFrame } from "./lead-conversion-app-frame";

/**
 * The four beats of the journey, in the order the loop plays them: a lead
 * arrives, it gets a reply, it is qualified, it reaches a booking. Each is a
 * step the product actually performs, so none of them promises an outcome.
 */
const SIGNALS = [
  {
    icon: Inbox,
    fill: "#16260d",
    colour: "#a7dd52",
    title: "New lead",
    detail: "Website form",
    time: "1m ago",
    tick: false,
  },
  {
    icon: MessageSquareText,
    fill: "#14243d",
    colour: "#7db0ff",
    title: "First response",
    detail: "Personalised reply sent",
    tick: true,
  },
  {
    icon: ListChecks,
    fill: "#1c2438",
    colour: "#b4c4dd",
    title: "Qualification",
    detail: "3 of 4 criteria met",
    tick: true,
  },
  {
    icon: CalendarCheck,
    fill: "#16260d",
    colour: "#a7dd52",
    title: "Book appointment",
    detail: "Synced to calendar",
    tick: true,
  },
] as const;

const ASSURANCES = [
  `${TRIAL_DAYS}-day free trial`,
  "No card required",
  "Quick setup",
] as const;

export function LeadConversionHero() {
  const stageRef = React.useRef<HTMLDivElement>(null);
  // Five beats at ~1.5s, then a pause on the finished state: an 8.4s loop.
  const stage = useStageLoop(stageRef, 5, 1500, 2400);

  return (
    <section className="lcp-section lcp-hero" aria-labelledby="lcp-hero-title">
      <span className="lcp-texture" aria-hidden />
      <span className="lcp-bloom" aria-hidden />

      <div className="lcp-shell lcp-hero-inner">
        <div className="lcp-hero-copy">
          <span className="lcp-eyebrow">Lead conversion</span>
          <h1 id="lcp-hero-title">
            Turn more inbound enquiries into{" "}
            <span className="lcp-accent">booked business.</span>
          </h1>
          <p className="lcp-hero-body">
            ClientTurn responds, follows up, qualifies and routes warm leads so
            fewer good opportunities depend on manual timing.
          </p>

          <div className="lcp-hero-actions">
            <LcpCta
              placement="lead_conversion_hero"
              className="lcp-btn lcp-btn-primary"
            >
              Start Free <ArrowRight size={17} aria-hidden />
            </LcpCta>
            <Link href="#core-engine" className="lcp-btn lcp-btn-ghost">
              <span className="lcp-play" aria-hidden>
                <Play size={11} fill="currentColor" />
              </span>
              See the workflow
            </Link>
          </div>

          <ul className="lcp-assurances">
            {ASSURANCES.map((item) => (
              <li key={item} className="lcp-assurance">
                <CheckCircle2 size={17} aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="lcp-hero-visual">
          <div className="lcp-hero-stage" ref={stageRef}>
            <LeadConversionAppFrame litRow={stage <= 1 ? 0 : -1} />

            <div className="lcp-signals">
              <span className="lcp-wire" data-lit={stage >= 1} aria-hidden />
              {SIGNALS.map((signal, i) => {
                const Icon = signal.icon;
                const lit = stage >= i;
                return (
                  <div
                    key={signal.title}
                    className="lcp-signal"
                    data-lit={lit ? "true" : undefined}
                    aria-hidden
                  >
                    <span
                      className="lcp-signal-icon"
                      style={{ background: signal.fill, color: signal.colour }}
                    >
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="lcp-signal-text">
                      <strong>{signal.title}</strong>
                      <small>{signal.detail}</small>
                    </span>
                    {"time" in signal && signal.time ? (
                      <span className="lcp-signal-time">{signal.time}</span>
                    ) : null}
                    {signal.tick && (
                      <Check size={15} className="lcp-signal-tick" />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="lcp-hero-outcome" aria-hidden>
              <span className="lcp-hero-outcome-icon">
                <BarChart3 size={19} strokeWidth={2} />
              </span>
              <p>
                More enquiries.
                <br />
                More bookings.
                <br />
                A more efficient business.
              </p>
            </div>

            <p className="lcp-hero-script" aria-hidden>
              From enquiry to booked.
              <svg width="52" height="20" viewBox="0 0 52 20" fill="none">
                <path
                  d="M50 2C36 2 18 5 4 15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M4 15L12 13M4 15L7 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
