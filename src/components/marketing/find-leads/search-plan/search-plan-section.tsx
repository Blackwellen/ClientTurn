"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import { FlCta } from "../fl-cta";
import { HERO_PLAN, HERO_REPLY, HERO_REQUEST } from "../data";
import {
  AppSurface,
  ArrowRight,
  Badge,
  BrandMark,
  Check,
  ChevronDown,
  FlSection,
  Pencil,
  Shield,
  Sliders,
} from "../pieces";

/**
 * The structured search plan.
 *
 * Two halves that have to be read together: on the left the sentence someone
 * typed, on the right the machine's interpretation of it. The commercial
 * argument of the whole page lives in that adjacency — the interpretation is
 * visible and editable *before* anybody's money is spent.
 *
 * On a phone the plan collapses behind a "View search plan" control rather
 * than being squeezed into a sidebar, because eleven label/value rows below a
 * conversation is a scroll nobody finishes.
 */

/** Rows the plan panel shows beyond the ones already in the chat summary. */
const EXTRA_ROWS = [
  { label: "Organisation type", value: ["Commercial", "Mixed"] },
  { label: "Minimum grade", value: ["B and above"] },
  { label: "Conversion goal", value: ["Book a site visit"] },
];

const PLAN_ROWS = [...HERO_PLAN, ...EXTRA_ROWS];

const TRUST_CHECKS = [
  "Targeting reviewed",
  "Exclusions applied",
  "Plan allowance checked",
  "Contactability rules applied during sourcing",
];

export function SearchPlanSection() {
  const [open, setOpen] = React.useState(false);

  return (
    <FlSection id="search-plan" glow="right">
      <div className="fl-chapter-head">
        <div>
          <p className="fl-eyebrow">Search plan</p>
          <h2 className="fl-h2">
            Review the interpretation <em>before the search starts.</em>
          </h2>
        </div>
        <div className="fl-chapter-aside">
          <p>
            Natural language becomes a structured plan covering companies,
            roles, locations, intent, exclusions, the result target and the
            review mode.
          </p>
        </div>
      </div>

      <div className="fl-split">
        {/* -------------------------------------------------- conversation */}
        <AppSurface
          title="Search session"
          subtitle="Property managers — Bournemouth"
          actions={<Badge tone="lime">Draft plan</Badge>}
        >
          <ul className="fl-msglist" style={{ marginTop: 0 }}>
            <li className="fl-msg fl-msg-user">
              <div className="fl-bubble fl-bubble-user">{HERO_REQUEST}</div>
              <span className="fl-avatar fl-avatar-user">You</span>
            </li>
            <li className="fl-msg">
              <span className="fl-avatar">
                <BrandMark />
              </span>
              <div className="fl-bubble">{HERO_REPLY}</div>
            </li>
            <li className="fl-msg">
              <span className="fl-avatar">
                <BrandMark />
              </span>
              <div className="fl-bubble">
                Anything you would like to change? I can widen the radius, add
                roles, or exclude specific domains before we start.
              </div>
            </li>
          </ul>

          {/* Mobile route into the plan; hidden once there is room beside it. */}
          <button
            type="button"
            className="fl-btn fl-btn-ghost fl-plan-toggle"
            aria-expanded={open}
            aria-controls="fl-plan-panel"
            onClick={() => {
              setOpen((v) => !v);
              trackEngagement("find_leads_search_plan_interaction", "toggle");
            }}
          >
            {open ? "Hide search plan" : "View search plan"}
            <ChevronDown
              size={14}
              style={{ rotate: open ? "180deg" : "0deg", transition: "rotate .25s" }}
            />
          </button>
        </AppSurface>

        {/* ---------------------------------------------------- plan panel */}
        <div
          id="fl-plan-panel"
          className="fl-collapse fl-plan-collapse"
          data-open={open}
        >
          <div>
            <AppSurface
              title="Search plan"
              subtitle="Version 1 · not yet started"
              actions={
                <span className="fl-mini-btn">
                  <Pencil size={11} />
                  Edit criteria
                </span>
              }
              footer={
                <div className="fl-app-foot" style={{ flexWrap: "wrap", gap: 10 }}>
                  <FlCta
                    placement="find_leads_search_plan_cta"
                    className="fl-btn-sm"
                  >
                    Start sourcing run
                    <ArrowRight size={13} />
                  </FlCta>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <Shield size={13} />
                    Review targeting and limits before provider spend begins.
                  </span>
                </div>
              }
            >
              <dl className="fl-limits" style={{ gridTemplateColumns: "1fr" }}>
                {PLAN_ROWS.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value.join(", ")}</dd>
                  </div>
                ))}
              </dl>

              {/* ------------------------------------------ budget panel */}
              <div
                className="fl-run-request"
                style={{ marginTop: 16, alignItems: "center" }}
              >
                <span aria-hidden className="fl-def-icon">
                  <Sliders size={13} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--fl-ink)",
                    }}
                  >
                    Estimated sourcing allowance
                  </strong>
                  <div className="fl-meter" aria-hidden style={{ marginTop: 9 }}>
                    <span style={{ width: "34%" }} />
                  </div>
                  <small
                    style={{
                      display: "block",
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--fl-ink-4)",
                    }}
                  >
                    100 verified prospects · minimum grade B · intent not
                    required · within your plan
                  </small>
                </div>
              </div>

              <ul className="fl-checks" style={{ marginTop: 14 }}>
                {TRUST_CHECKS.map((check) => (
                  <li key={check}>
                    <Check size={13} />
                    {check}
                  </li>
                ))}
              </ul>
            </AppSurface>
          </div>
        </div>
      </div>
    </FlSection>
  );
}
