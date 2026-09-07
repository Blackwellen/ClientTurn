"use client";

import * as React from "react";
import { CONVERSION_GOALS } from "@/lib/outreach/campaign-draft";
import { trackEngagement } from "@/lib/marketing/track";
import {
  CAMPAIGN_CHECKS,
  CAMPAIGN_LIMITS,
  CAMPAIGN_SEQUENCE,
  CAMPAIGN_STEPS,
} from "../data";
import {
  AppSurface,
  Badge,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Doc,
  Mail,
  Phone,
  Plus,
  Shield,
} from "../pieces";

/**
 * The acquisition campaign wizard.
 *
 * Six steps, taken from `WIZARD_STEPS`, and clicking one moves the panel —
 * this is the section where a buyer decides whether the product is a
 * controlled workflow or another automation maze, and a stepper that does not
 * step answers that question the wrong way.
 *
 * The outreach sequence is email-only by design. Cold SMS and WhatsApp are not
 * shown as a default because they are not one: the policy engine is email-first
 * for cold contact unless something explicitly permits another channel.
 */

const GOAL_ICONS = [Calendar, Doc, Phone];

/** The three goals the panel offers, read from the product's own list. */
const GOALS = CONVERSION_GOALS.filter((goal) =>
  ["BOOK_SITE_VISIT", "REQUEST_QUOTE", "PHONE_CALL"].includes(goal.value),
);

export function CampaignPanel() {
  const [step, setStep] = React.useState(0);
  const [goal, setGoal] = React.useState(GOALS[0]?.value ?? "");

  return (
    <AppSurface
      title="Create campaign"
      subtitle={CAMPAIGN_STEPS[step]?.description}
      actions={<Badge tone="lime">Draft</Badge>}
      footer={
        <div className="fl-app-foot" style={{ gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              color: "var(--fl-lime-soft)",
            }}
          >
            <Shield size={13} />
            Email-first cold outreach
          </span>
          <span className="fl-mini-btn">
            Review &amp; launch
            <ChevronRight size={11} />
          </span>
        </div>
      }
    >
      {/* ------------------------------------------------------- stepper */}
      <ol className="fl-stepper" aria-label="Campaign setup progress">
        {CAMPAIGN_STEPS.map((wizardStep, index) => (
          <li
            key={wizardStep.label}
            data-state={
              index === step ? "current" : index < step ? "done" : "todo"
            }
          >
            <button
              type="button"
              className="fl-step-dot"
              aria-current={index === step ? "step" : undefined}
              aria-label={`Step ${wizardStep.number}: ${wizardStep.label}`}
              onClick={() => {
                setStep(index);
                trackEngagement(
                  "find_leads_campaign_interaction",
                  wizardStep.label,
                );
              }}
            >
              {index < step ? <Check size={11} /> : wizardStep.number}
            </button>
            <span>{wizardStep.label}</span>
          </li>
        ))}
      </ol>

      {/* -------------------------------------------------------- goal */}
      <div className="fl-block" style={{ marginTop: 20 }}>
        <p className="fl-sublabel">Campaign goal</p>
        <ul className="fl-goals">
          {GOALS.map((option, index) => {
            const GoalIcon = GOAL_ICONS[index] ?? Calendar;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  className="fl-goal"
                  data-selected={goal === option.value}
                  aria-pressed={goal === option.value}
                  onClick={() => {
                    setGoal(option.value);
                    trackEngagement(
                      "find_leads_campaign_interaction",
                      option.value,
                    );
                  }}
                  style={{ width: "100%", textAlign: "left" }}
                >
                  <span className="fl-goal-top">
                    {goal === option.value ? (
                      <Check size={13} />
                    ) : (
                      <GoalIcon size={13} />
                    )}
                    <strong>{option.label}</strong>
                  </span>
                  <small>{option.description}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ------------------------------------------------------ details */}
      <div className="fl-block">
        <p className="fl-sublabel">Campaign details</p>
        <div className="fl-fields">
          <div className="fl-field">
            <span>Campaign name</span>
            <div className="fl-field-box">
              <b>South Coast roofing — Q4</b>
            </div>
          </div>
          <div className="fl-field">
            <span>Target audience</span>
            <div className="fl-field-box">
              <b>Property managers (5–50 emp)</b>
              <ChevronDown size={12} />
            </div>
          </div>
          <div className="fl-field">
            <span>Minimum fit</span>
            <div className="fl-field-box">
              <b>Grade B and above</b>
              <ChevronDown size={12} />
            </div>
          </div>
        </div>
      </div>

      {/* --------------------------------------------- outreach sequence */}
      <div className="fl-block">
        <p className="fl-sublabel">Outreach sequence (email first)</p>
        <ol className="fl-seq">
          {CAMPAIGN_SEQUENCE.map((item, index) => (
            <li key={item.day}>
              <span aria-hidden className="fl-seq-dot">
                {index + 1}
              </span>
              <span aria-hidden className="fl-event-icon" style={{ width: 26, height: 26 }}>
                <Mail size={12} />
              </span>
              <div>
                <strong>
                  {item.day} — {item.channel}
                </strong>
                <small>Subject: {item.subject}</small>
              </div>
              <span aria-hidden className="fl-switch-sm" />
              <span className="fl-mini-btn">Edit</span>
            </li>
          ))}
        </ol>
        <span className="fl-addstep">
          <Plus size={12} />
          Add step
        </span>
        <p className="fl-note-line">
          Cold outreach starts by email. SMS and WhatsApp are not used for cold
          contact, and social channels are manual or API-gated — never browser
          automation.
        </p>
      </div>

      {/* ------------------------------------------------------- limits */}
      <div className="fl-block">
        <p className="fl-sublabel">Budget &amp; limits</p>
        <dl className="fl-limits">
          {CAMPAIGN_LIMITS.map((limit) => (
            <div key={limit.label}>
              <dt>{limit.label}</dt>
              <dd>{limit.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* -------------------------------------------------------- checks */}
      <div className="fl-block">
        <p className="fl-sublabel">Checked before launch</p>
        <ul className="fl-checks">
          {CAMPAIGN_CHECKS.map((check) => (
            <li key={check}>
              <Check size={13} />
              {check}
            </li>
          ))}
        </ul>
      </div>
    </AppSurface>
  );
}
