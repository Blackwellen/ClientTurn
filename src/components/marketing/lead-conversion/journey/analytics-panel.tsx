"use client";

import * as React from "react";
import { ArrowRight, CalendarDays, Clock, Info } from "lucide-react";
import { motion } from "motion/react";
import { FUNNEL, LEAD_SOURCES } from "../data";
import { Panel } from "../primitives";
import { useRevealed } from "../use-stage";

const DONUT_R = 38;
const DONUT_C = 2 * Math.PI * DONUT_R;

/**
 * Each arc needs the total of the arcs before it. Accumulate once here rather
 * than mutating a counter inside the render pass.
 */
const DONUT_SEGMENTS = LEAD_SOURCES.reduce<
  { label: string; pct: number; colour: string; before: number }[]
>((acc, source) => {
  const before = acc.length ? acc[acc.length - 1].before + acc[acc.length - 1].pct : 0;
  acc.push({ ...source, before });
  return acc;
}, []);

/** A 30-point line, drawn once, standing in for a response-time trend. */
const SPARK =
  "M0 30 L14 22 L28 27 L42 16 L56 21 L70 12 L84 18 L98 9 L112 15 L126 7 L140 13 L154 5 L168 11 L182 4 L196 9 L210 3";

export function AnalyticsPanel() {
  const ref = React.useRef<HTMLDivElement>(null);
  const revealed = useRevealed(ref);

  return (
    <div ref={ref}>
      <Panel
        title="Conversion performance"
        actions={
          <span className="lcp-btn-quiet">
            <CalendarDays size={12} strokeWidth={2} aria-hidden />
            Last 30 days
          </span>
        }
      >
        <div className="lcp-funnel">
          {FUNNEL.map((stage, i) => (
            <div key={stage.label} className="lcp-funnel-col">
              <b>{stage.value.toLocaleString("en-GB")}</b>
              <small>{stage.label}</small>
              <motion.span
                className="lcp-funnel-bar"
                style={{ background: stage.colour, height: `${stage.pct}%` }}
                initial={{ scaleY: 0 }}
                animate={revealed ? { scaleY: 1 } : undefined}
                transition={{
                  duration: 0.62,
                  delay: 0.08 * i,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
              />
            </div>
          ))}
        </div>
        <div className="lcp-funnel-pcts">
          {FUNNEL.map((stage) => (
            <span key={stage.label}>{stage.pct}%</span>
          ))}
        </div>
      </Panel>

      <div className="lcp-analytics-split">
        <Panel title="Lead sources">
          <div className="lcp-sources">
            <div className="lcp-donut">
              <svg viewBox="0 0 92 92" width="92" height="92" aria-hidden>
                {DONUT_SEGMENTS.map((source) => {
                  const length = (source.pct / 100) * DONUT_C;
                  const dash = `${length} ${DONUT_C - length}`;
                  const start = -DONUT_C * (source.before / 100) + DONUT_C * 0.25;
                  return (
                    <circle
                      key={source.label}
                      cx="46"
                      cy="46"
                      r={DONUT_R}
                      fill="none"
                      stroke={source.colour}
                      strokeWidth="11"
                      strokeDasharray={dash}
                      strokeDashoffset={start}
                      transform="rotate(-90 46 46)"
                    />
                  );
                })}
              </svg>
              <span className="lcp-donut-centre" aria-hidden>
                <b>1,248</b>
                <small>Leads</small>
              </span>
            </div>
            <ul className="lcp-legend">
              {LEAD_SOURCES.map((source) => (
                <li key={source.label}>
                  <i style={{ background: source.colour }} aria-hidden />
                  {source.label}
                  <span>{source.pct}%</span>
                </li>
              ))}
            </ul>
          </div>
          <a href="#lcp-integrations" className="lcp-card-link">
            View sources
            <ArrowRight size={13} aria-hidden />
          </a>
        </Panel>

        <Panel title="Response time">
          <div className="lcp-rt">
            <Clock size={22} strokeWidth={2} aria-hidden />
            <b>2h 18m</b>
            <span className="lcp-rt-delta">Last 30 days</span>
          </div>
          <p className="lcp-rt-sub">Average time to first response</p>
          <svg
            className="lcp-spark"
            viewBox="0 0 210 34"
            preserveAspectRatio="none"
            aria-hidden
          >
            <motion.path
              d={SPARK}
              fill="none"
              stroke="#2f7df7"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={revealed ? { pathLength: 1 } : undefined}
              transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
            />
          </svg>
          <a href="#lcp-final" className="lcp-card-link">
            View detailed analytics
            <ArrowRight size={13} aria-hidden />
          </a>
        </Panel>
      </div>

      <p className="lcp-demo-note">
        <Info size={13} aria-hidden />
        Illustrative product data — not customer results.
      </p>
    </div>
  );
}
