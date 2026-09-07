"use client";

import * as React from "react";
import { gradeForScore } from "@/lib/prospects/scoring";
import { trackEngagement } from "@/lib/marketing/track";
import {
  DEMO_FACTORS,
  DEMO_SCORE,
  EVIDENCE_ROWS,
  SCORE_CONCERNS,
  SCORE_POSITIVES,
  SCORE_SUBJECT,
} from "../data";
import {
  AppSurface,
  Badge,
  Bolt,
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  External,
  Globe,
  Minus,
  Pin,
  Plus,
  Sparkle,
  Target,
  Users,
  Wrench,
} from "../pieces";

/**
 * Explainable scoring.
 *
 * The headline number is a *sum of the rows beneath it* — `DEMO_FACTORS`
 * carries each factor's real weight from `DEFAULT_WEIGHTS`, and the total is
 * added up rather than typed in. That is the whole claim of §14: AI produces
 * evidence and features, deterministic code produces the number. A page that
 * showed a decorative "91" would be arguing against its own trust line.
 *
 * Each factor is a disclosure button, and the evidence beneath it names its
 * source, freshness and confidence.
 */

const FACTOR_ICONS = [Target, Users, Pin, Wrench, Bolt, Check];

const GRADE_CAPTION: Record<string, string> = {
  "A+": "Exceptional fit",
  A: "Excellent fit",
  B: "Good fit",
  C: "Marginal fit",
  D: "Poor fit",
};

const TABS = [
  "Why this score",
  "Company details",
  "Contact details",
  "Intent signals",
];

const RING_RADIUS = 33;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ScoringPanel() {
  const [expanded, setExpanded] = React.useState<string | null>(
    DEMO_FACTORS[0]?.factor ?? null,
  );
  const grade = gradeForScore(DEMO_SCORE);

  return (
    <AppSurface
      footer={
        <div className="fl-app-foot" style={{ gap: 8 }}>
          <span className="fl-mini-btn">
            <External size={11} />
            Open prospect
          </span>
          <span
            className="fl-mini-btn"
            style={{
              borderColor: "rgb(183 243 74 / 0.45)",
              color: "var(--fl-lime-soft)",
            }}
          >
            Approve for outreach
            <ChevronRight size={11} />
          </span>
        </div>
      }
    >
      {/* --------------------------------------------------- score header */}
      <div className="fl-score-head" style={{ padding: 0, borderBottom: 0, paddingBottom: 16 }}>
        <span aria-hidden className="fl-logo" style={{ width: 38, height: 38 }}>
          {SCORE_SUBJECT.initials}
        </span>
        <div>
          <strong>{SCORE_SUBJECT.company}</strong>
          <small>{SCORE_SUBJECT.meta}</small>
          <small>
            {SCORE_SUBJECT.contact} · {SCORE_SUBJECT.role} ·{" "}
            {SCORE_SUBJECT.location}
          </small>
        </div>
        <div>
          <div className="fl-ring">
            <svg viewBox="0 0 74 74" aria-hidden>
              <circle className="fl-ring-track" cx="37" cy="37" r={RING_RADIUS} />
              <circle
                className="fl-ring-arc"
                cx="37"
                cy="37"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={
                  RING_CIRCUMFERENCE * (1 - DEMO_SCORE / 100)
                }
              />
            </svg>
            <span className="fl-ring-value">{DEMO_SCORE}</span>
          </div>
          <p className="fl-ring-caption">
            Grade {grade} · {GRADE_CAPTION[grade] ?? "Scored"}
          </p>
        </div>
      </div>

      {/* Tabs mirror the real prospect drawer. Only the first has content in a
          marketing demo, so the rest are marked disabled rather than pretending. */}
      <div className="fl-tabs" role="tablist" aria-label="Prospect detail">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className="fl-tab"
            aria-selected={index === 0}
            aria-disabled={index !== 0}
            tabIndex={index === 0 ? 0 : -1}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="pt-4">
        <ul className="fl-factors">
          {DEMO_FACTORS.map((factor, index) => {
            const FactorIcon = FACTOR_ICONS[index] ?? Target;
            const open = expanded === factor.factor;
            return (
              <li className="fl-factor" key={factor.factor}>
                <button
                  type="button"
                  className="fl-factor-btn"
                  aria-expanded={open}
                  aria-controls={`fl-ev-${factor.factor}`}
                  onClick={() => {
                    setExpanded(open ? null : factor.factor);
                    trackEngagement("find_leads_score_expand", factor.factor);
                  }}
                >
                  <span aria-hidden className="fl-factor-icon">
                    <FactorIcon size={13} />
                  </span>
                  <div>
                    <strong>
                      {factor.label}{" "}
                      <span className="font-normal text-[#6c778a]">
                        · {factor.weightPercent}% weight
                      </span>
                    </strong>
                    <small>{factor.sentence}</small>
                  </div>
                  <span className="fl-factor-points">
                    {factor.earned} <span>/ {factor.max}</span>
                  </span>
                  <ChevronRight size={13} className="fl-factor-chevron" />
                </button>

                <div
                  className="fl-collapse"
                  data-open={open}
                  id={`fl-ev-${factor.factor}`}
                >
                  <div>
                    <dl className="fl-evidence">
                      <div>
                        <dt>Evidence</dt>
                        <dd>{factor.evidence}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{factor.source}</dd>
                      </div>
                      <div>
                        <dt>Freshness</dt>
                        <dd>{factor.freshness}</dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd>{factor.confidence}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* ------------------------------------------ positives / concerns */}
        <div className="fl-block" style={{ marginTop: 18 }}>
          <p className="fl-sublabel">What lifted this score</p>
          <ul className="fl-signs">
            {SCORE_POSITIVES.map((item) => (
              <li key={item} data-dir="up">
                <Plus size={12} />
                {item}
              </li>
            ))}
            {SCORE_CONCERNS.map((item) => (
              <li key={item} data-dir="down">
                <Minus size={12} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* ------------------------------------------------------ evidence */}
        <div className="fl-block">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="fl-sublabel" style={{ margin: 0 }}>
              Evidence
            </p>
            <Badge tone="neutral">Provenance recorded</Badge>
          </div>
          <ul className="fl-rowlist">
            {EVIDENCE_ROWS.map((row, index) => (
              <li key={row.label}>
                <span className="fl-rowlist-label">
                  {index === 0 ? (
                    <Globe size={13} />
                  ) : index === 1 ? (
                    <Briefcase size={13} />
                  ) : index === 2 ? (
                    <Sparkle size={13} />
                  ) : (
                    <Clock size={13} />
                  )}
                  {row.label}
                </span>
                <span className="fl-rowlist-value">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="fl-note-line">
          AI produces the evidence and features; deterministic code computes the
          canonical numeric score. The six weights above are the product&apos;s
          configured defaults.
        </p>
      </div>
    </AppSurface>
  );
}
