"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Filter,
  Info,
  Link2,
  Mail,
  User,
} from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "../motion";

/**
 * Where the journey breaks today. Four cards, each showing the shape of the
 * failure rather than asserting a statistic about it — nothing here claims a
 * measured drop-off, because we have not measured one.
 */

type Step = { done: boolean; when?: string; label: string };

const FOLLOW_UP_STEPS: Step[] = [
  { done: true, when: "Day 1", label: "Initial response" },
  { done: false, when: "Day 3", label: "Follow-up email" },
  { done: false, when: "Day 7", label: "Second follow-up" },
  { done: false, when: "Day 14", label: "Final attempt" },
];

const HANDOVER_STEPS: Step[] = [
  { done: true, label: "Lead qualifies" },
  { done: false, label: "Notify the right person" },
  { done: false, label: "Create appointment" },
  { done: false, label: "Update CRM" },
];

const MISSING = ["Budget", "Timescale", "Project type", "Location"];

function Steps({ steps, dayColumn }: { steps: Step[]; dayColumn: boolean }) {
  return (
    <ul className={`lcp-leak-steps${dayColumn ? "" : " lcp-leak-nosteps"}`}>
      {steps.map((step) => (
        <li key={step.label} data-done={step.done ? "true" : undefined}>
          {step.done ? (
            <CheckCircle2 size={15} aria-hidden />
          ) : (
            <Circle size={15} aria-hidden />
          )}
          {dayColumn && <b>{step.when}</b>}
          <span>{step.label}</span>
        </li>
      ))}
    </ul>
  );
}

const CARDS = [
  {
    tone: "red" as const,
    icon: AlertCircle,
    title: "Slow reply",
    body: "Enquiries lose momentum when responses are delayed.",
    well: (
      <>
        <div className="lcp-leak-enquiry">
          <span className="lcp-leak-enquiry-avatar" aria-hidden>
            <User size={15} strokeWidth={2} />
          </span>
          <strong>New website enquiry</strong>
          <span>2h ago</span>
        </div>
        <p className="lcp-leak-quote">
          “Hi, I’d like a quote for a new roof…”
        </p>
      </>
    ),
    alert: ["Replied after 2 hours", "Momentum fades while the enquiry waits."],
  },
  {
    tone: "amber" as const,
    icon: Mail,
    title: "Missed follow-up",
    body: "Leads go cold without consistent, timely follow-up.",
    well: <Steps steps={FOLLOW_UP_STEPS} dayColumn />,
    alert: [
      "Follow-up stopped",
      "Many good leads never get a second touch.",
    ],
  },
  {
    tone: "amber" as const,
    icon: Filter,
    title: "Weak qualification",
    body: "Without clear criteria, unqualified leads waste time and resources.",
    well: (
      <>
        <p>Typical questions often missing:</p>
        <ul className="lcp-leak-missing">
          {MISSING.map((item) => (
            <li key={item}>
              <Info size={14} aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </>
    ),
    alert: ["Unclear fit", "Teams spend time on the wrong leads."],
  },
  {
    tone: "red" as const,
    icon: Link2,
    title: "Disconnected handover",
    body: "Qualified leads get lost between tools, people or manual processes.",
    well: <Steps steps={HANDOVER_STEPS} dayColumn={false} />,
    alert: ["Handover breaks down", "Leads fall through the cracks."],
  },
];

export function LeakSection() {
  return (
    <section className="lcp-section lcp-leak" aria-labelledby="lcp-leak-title">
      <span className="lcp-bloom" aria-hidden />
      <div className="lcp-shell">
        <Reveal className="lcp-leak-head">
          <h2 id="lcp-leak-title">
            The lead was interested.{" "}
            <span className="lcp-accent">The process broke.</span>
          </h2>
          <p>
            Good opportunities get lost when follow-up is slow, qualification is
            inconsistent or handover is manual.
          </p>
        </Reveal>

        <RevealGroup className="lcp-leak-grid" step={0.09} delay={0.05}>
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <RevealItem
                as="article"
                key={card.title}
                className="lcp-leak-card"
              >
                <span className="lcp-leak-icon" data-tone={card.tone} aria-hidden>
                  <Icon size={19} strokeWidth={2} />
                </span>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <div className="lcp-leak-well">{card.well}</div>
                <div className="lcp-leak-alert">
                  <AlertCircle size={15} aria-hidden />
                  <span>
                    <strong>{card.alert[0]}</strong>
                    <small>{card.alert[1]}</small>
                  </span>
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
