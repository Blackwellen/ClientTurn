"use client";

import { ArrowRight, Clock, Eye, GitBranch, Inbox, ListChecks, MessagesSquare, ScrollText, ShieldCheck, UserCheck } from "lucide-react";
import { LcpCta } from "../lcp-cta";
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

/** The lime thread that reads left to right across the three stages. */
function Rail() {
  return (
    <div className="lcp-rail" aria-hidden>
      <svg viewBox="0 0 1200 40" preserveAspectRatio="none">
        {[0, 408].map((shift) => (
          <path
            key={shift}
            d={`M${42 + shift} 30 C ${112 + shift} 30 ${132 + shift} 6 ${204 + shift} 6 L ${340 + shift} 6 C ${390 + shift} 6 ${386 + shift} 30 ${404 + shift} 30`}
            fill="none"
            stroke="#b7f34a"
            strokeOpacity="0.42"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
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
        <div className="lcp-band-head">
          <div>
            <span className="lcp-eyebrow">The core engine</span>
            <h2 id="lcp-core-title">
              From capture to qualification,{" "}
              <span className="lcp-accent">in one flow.</span>
            </h2>
          </div>
          <p>
            Capture leads, run personalised follow-up and qualify each enquiry
            automatically — so your team can focus on the opportunities that are
            ready to move forward.
          </p>
          <LcpCta
            placement="lead_conversion_core"
            className="lcp-btn lcp-btn-sm lcp-btn-ghost"
          >
            See it in action <ArrowRight size={15} aria-hidden />
          </LcpCta>
        </div>

        <Rail />

        <div className="lcp-columns">
          {COLUMNS.map((column, i) => (
            <div key={column.eyebrow} className="lcp-col">
              <div className="lcp-col-head">
                <span className="lcp-step-no" aria-hidden>
                  {i + 1}
                </span>
                <span className="lcp-eyebrow">{column.eyebrow}</span>
              </div>
              <h3>{column.title}</h3>
              <p>{column.lead}</p>
              <div className="lcp-col-panel">{column.panel}</div>
              <BenefitStrip items={column.benefits} />
            </div>
          ))}
        </div>

        <div className="lcp-trust">
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
        </div>
      </div>
    </section>
  );
}
