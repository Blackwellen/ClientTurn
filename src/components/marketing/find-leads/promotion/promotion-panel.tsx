"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import { LEAD_READY_ACTIONS, PROMOTION_CONVERSATION } from "../data";
import {
  AppSurface,
  ArrowRight,
  Badge,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Dots,
  Send,
  Sparkle,
} from "../pieces";

/**
 * Prospect → Lead.
 *
 * The one thing this panel must not do is replace the conversation when the
 * entity changes. `promote_reviewed_prospect` re-points the existing
 * `conversations` row at the new lead rather than starting a new thread, so the
 * demo keeps the same three messages on screen and changes only the chip above
 * them. Destroying the thread and drawing a fresh one would illustrate a
 * product that loses the history — the opposite of what happens.
 */

const ACTION_ICONS = [Check, Send, Calendar];

export function PromotionPanel() {
  const [promoted, setPromoted] = React.useState(false);

  return (
    <AppSurface
      title="Prospect to lead"
      subtitle="Peninsula Estates · South Coast roofing — Q4"
      actions={
        <Badge tone={promoted ? "lime" : "green"} dot>
          {promoted ? "Lead · engaged" : "Engaged"}
        </Badge>
      }
      footer={
        <div className="fl-app-foot">
          <span>
            {promoted
              ? "Promotion retains the conversation and sourcing history."
              : "Cold outreach and research stay attached to the prospect until promotion."}
          </span>
        </div>
      }
    >
      {/* ------------------------------------------------- entity header */}
      <div className="fl-entity" style={{ padding: 0, paddingBottom: 14 }}>
        <span aria-hidden className="fl-logo" style={{ width: 34, height: 34 }}>
          PE
        </span>
        <div>
          <div className="flex items-center gap-2">
            <strong>Peninsula Estates</strong>
            {/* The chip is the only thing that changes identity. */}
            <span
              className="fl-entity-chip"
              data-state={promoted ? "lead" : "prospect"}
            >
              {promoted ? "Lead" : "Prospect"}
            </span>
          </div>
          <small>peninsula-estates.co.uk · Bournemouth, UK · 11–50 emp</small>
        </div>
        <div className="fl-fit-block">
          <b>92</b>
          <span>High fit</span>
        </div>
        <Dots size={14} className="shrink-0 text-[#5b6679]" />
      </div>

      <div className="fl-tabs" role="tablist" aria-label="Record detail">
        {["Conversation", "Company", "Intent", "Campaign", "Notes"].map(
          (tab, index) => (
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
          ),
        )}
      </div>

      {/* ------------------------------------------ the same conversation */}
      <div className="pt-4">
        <ul className="fl-thread" aria-label="Conversation history">
          {PROMOTION_CONVERSATION.map((message) => (
            <li key={message.when} data-outbound={message.outbound}>
              <span aria-hidden className="fl-thread-av">
                {message.initials}
              </span>
              <div>
                <div className="fl-thread-top">
                  <strong>{message.author}</strong>
                  <span>{message.when}</span>
                </div>
                <p>{message.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* Campaign context: retained, and collapsed into activity once
            promoted rather than discarded. */}
        <div className="fl-block">
          <p className="fl-sublabel">
            {promoted ? "Sourcing & campaign history" : "Campaign context"}
          </p>
          <div className="fl-context-card">
            <span aria-hidden className="fl-event-icon">
              <Send size={13} />
            </span>
            <div>
              <strong>South Coast roofing — Q4</strong>
              <small>
                {promoted
                  ? "Step 1 of 4 · email · retained on the lead"
                  : "Step 1 of 4 · email · reply classified as interested"}
              </small>
            </div>
            <span className="fl-mini-btn">
              View campaign
              <ChevronDown size={10} />
            </span>
          </div>
          {promoted && (
            <div className="fl-context-card" style={{ marginTop: 8 }}>
              <span aria-hidden className="fl-event-icon">
                <Sparkle size={13} />
              </span>
              <div>
                <strong>Sourcing run · 14 Oct</strong>
                <small>
                  Score 92 · grade A · one live intent signal · evidence
                  retained
                </small>
              </div>
            </div>
          )}
        </div>

        {/* -------------------------------------------------- promote step */}
        {promoted ? (
          <>
            <div className="fl-promote">
              <span aria-hidden className="fl-def-icon">
                <Check size={13} />
              </span>
              <div>
                <strong>Promoted to lead</strong>
                <p>
                  The conversation, campaign context and sourcing evidence moved
                  with the record. The warm lead workflow starts with the full
                  history.
                </p>
              </div>
            </div>
            <ul className="fl-lead-actions">
              {LEAD_READY_ACTIONS.map((action, index) => {
                const ActionIcon = ACTION_ICONS[index] ?? Check;
                return (
                  <li key={action}>
                    <ActionIcon size={12} />
                    {action}
                  </li>
                );
              })}
            </ul>
            <p className="fl-note-line">
              Status: engaged · qualification ready · follow-up on the warm lead
              policy · conversion goal site visit.
            </p>
          </>
        ) : (
          <div className="fl-promote">
            <span aria-hidden className="fl-def-icon">
              <Check size={13} />
            </span>
            <div>
              <strong>Ready to promote</strong>
              <p>
                Convert to a lead and keep the full history — messages, intent
                signals and campaign details.
              </p>
            </div>
            <button
              type="button"
              className="fl-promote-btn"
              onClick={() => {
                setPromoted(true);
                trackEngagement("find_leads_promotion_demo", "promote");
              }}
            >
              Promote to lead
              <ArrowRight size={13} />
            </button>
          </div>
        )}

        {promoted && (
          <button
            type="button"
            className="fl-btn fl-btn-ghost mt-3 w-full"
            onClick={() => setPromoted(false)}
          >
            Replay from prospect
            <ChevronRight size={13} />
          </button>
        )}
      </div>
    </AppSurface>
  );
}
