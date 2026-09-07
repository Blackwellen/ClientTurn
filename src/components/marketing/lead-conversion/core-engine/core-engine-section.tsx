"use client";

import { ArrowRight, Clock, Eye, GitBranch, Inbox, ListChecks, MessagesSquare, ScrollText, ShieldCheck, UserCheck } from "lucide-react";
import { motion } from "motion/react";
import { LcpCta } from "../lcp-cta";
import {
  Reveal,
  RevealGroup,
  RevealItem,
  panelEnter,
  pathDraw,
  softFade,
} from "../motion";
import { BenefitStrip } from "../primitives";
import { CapturePanel } from "./capture-panel";
import { FollowUpPanel } from "./follow-up-panel";
import { QualificationPanel } from "./qualification-panel";

const ICON = { size: 15, strokeWidth: 2 } as const;

const COLUMNS = [
  {
    eyebrow: "Capture",
    title: "Every lead starts with context.",
    lead: "All your enquiries come into one place with source, full details and history, so nothing gets lost.",
    panel: <CapturePanel />,
    benefits: [
      { icon: <Inbox {...ICON} />, label: <>All lead sources in one inbox</> },
      { icon: <ScrollText {...ICON} />, label: <>Full enquiry history</> },
      { icon: <UserCheck {...ICON} />, label: <>Automatic assignment</> },
    ],
  },
  {
    eyebrow: "Follow-up",
    title: "Consistent follow-up without a workflow maze.",
    lead: "Automated, multi-channel follow-up with the right message, at the right time, until you get a response.",
    panel: <FollowUpPanel />,
    benefits: [
      { icon: <MessagesSquare {...ICON} />, label: <>Email, SMS &amp; WhatsApp from one workflow</> },
      { icon: <Clock {...ICON} />, label: <>Smart sending times and reminders</> },
      { icon: <ShieldCheck {...ICON} />, label: <>Stop conditions keep it compliant</> },
    ],
  },
  {
    eyebrow: "Qualification",
    title: "Define what a good opportunity actually looks like.",
    lead: "Use your own questions, rules and scoring to qualify each enquiry and route it to the right next step.",
    panel: <QualificationPanel />,
    benefits: [
      { icon: <ListChecks {...ICON} />, label: <>Your questions and criteria</> },
      { icon: <Eye {...ICON} />, label: <>Explainable outcomes</> },
      { icon: <GitBranch {...ICON} />, label: <>Automatic routing</> },
    ],
  },
];

/**
 * The lime thread that reads left to right across the three stages. It leaves
 * each circle and climbs clear of the eyebrow beside it before running across,
 * so the line never crosses a label.
 */
function Rail() {
  return (
    <div className="lcp-rail" aria-hidden>
      <svg viewBox="0 0 1200 40" preserveAspectRatio="none">
        {[0, 408].map((shift, i) => (
          <motion.path
            key={shift}
            d={`M${40 + shift} 24 C ${52 + shift} 24 ${54 + shift} 4 ${68 + shift} 4 L ${376 + shift} 4 C ${390 + shift} 4 ${392 + shift} 24 ${404 + shift} 24`}
            fill="none"
            stroke="#b7f34a"
            strokeOpacity="0.42"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            variants={pathDraw}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.6 }}
            transition={{ delay: 0.15 + i * 0.25 }}
          />
        ))}
      </svg>
    </div>
  );
}

export function CoreEngineSection() {
  return (
    <section
      id="core-engine"
      className="lcp-section lcp-band"
      aria-labelledby="lcp-core-title"
    >
      <span className="lcp-texture" aria-hidden />
      <div className="lcp-shell">
        <RevealGroup className="lcp-band-head" step={0.1}>
          <RevealItem>
            <span className="lcp-eyebrow">The core engine</span>
            <h2 id="lcp-core-title">
              From capture to qualification,{" "}
              <span className="lcp-accent">in one flow.</span>
            </h2>
          </RevealItem>
          <RevealItem as="p">
            Capture leads, run personalised follow-up and qualify each enquiry
            automatically — so your team can focus on the opportunities that are
            ready to move forward.
          </RevealItem>
          <RevealItem>
          <LcpCta
            placement="lead_conversion_core"
            className="lcp-btn lcp-btn-sm lcp-btn-ghost"
          >
            See it in action <ArrowRight size={15} aria-hidden />
          </LcpCta>
          </RevealItem>
        </RevealGroup>

        <Rail />

        <div className="lcp-columns">
          {COLUMNS.map((column, i) => (
            <RevealGroup
              key={column.eyebrow}
              className="lcp-col"
              step={0.08}
              delay={i * 0.08}
            >
              <RevealItem className="lcp-col-head">
                <span className="lcp-step-no" aria-hidden>
                  {i + 1}
                </span>
                <span className="lcp-eyebrow">{column.eyebrow}</span>
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
          ))}
        </div>

        <Reveal className="lcp-trust" variants={softFade}>
          <span className="lcp-trust-icon" aria-hidden>
            <ShieldCheck size={22} strokeWidth={2} />
          </span>
          <p>
            Configured rules determine canonical qualification outcomes; AI can
            assist but does not invent your business criteria.
          </p>
          <a href="#lcp-integrations">
            Learn more about qualification
            <ArrowRight size={14} aria-hidden />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
