"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import { useStagedReveal } from "../../use-staged";
import {
  ACQUISITION_PROFILE,
  HERO_GREETING,
  HERO_GREETING_SUPPORT,
  HERO_PLAN,
  HERO_PROMPT_CHIPS,
  HERO_REPLY,
  HERO_REQUEST,
  PREVIOUS_SEARCHES,
} from "../data";
import {
  BrandMark,
  Bookmark,
  Briefcase,
  Check,
  ChevronDown,
  Clip,
  Dots,
  Globe,
  List,
  Pencil,
  Pin,
  Search,
  Send,
  Settings,
  Target,
  Users,
  Wrench,
} from "../pieces";
import { PreviousChatsDrawer } from "./previous-chats-drawer";

/**
 * The hero's Find Leads workspace.
 *
 * Chat-first on purpose: the proposition is that you describe a customer in
 * your own words, so the first thing a visitor sees has to be a conversation,
 * not a filter form.
 *
 * Two frames, advanced by `useStagedReveal`:
 *
 *   * Frame A — the greeting, the example prompts and the request sitting in
 *     the composer. This is the resting state, and the one rendered when the
 *     visitor has asked for reduced motion... except that reduced motion
 *     resolves every stage at once, which lands on frame B. Both frames
 *     contain the whole proposition, so either is a complete first read.
 *   * Frame B — the request sent, the assistant's reply, and the structured
 *     search plan expanded field by field.
 *
 * Nothing here talks to a server. The composer is a static demonstration
 * marked `aria-readonly`, and the send control is a button that advances the
 * demo rather than a form submit that would go nowhere.
 */

const PROFILE_ICONS = [Briefcase, Wrench, Pin, Users, Target];

/** Stage map: 1 chips · 2 request · 3 reply · 4 plan · 5 plan fields · 6 controls. */
const STAGES = 6;

export function FindLeadsHeroChat() {
  const { ref, revealed } = useStagedReveal(STAGES, 950);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedChip, setSelectedChip] = React.useState<string | null>(null);
  const [forced, setForced] = React.useState(0);

  // A visitor who clicks a chip or the send control gets the later frame
  // immediately rather than waiting for the timer to reach it.
  const stage = Math.max(revealed, forced);

  const sent = stage >= 2;
  const planFields = stage >= 5 ? HERO_PLAN.length : stage >= 4 ? 2 : 0;

  const request = selectedChip
    ? `Find ${selectedChip.toLowerCase()} who match my services and may need a commercial roofing contractor.`
    : HERO_REQUEST;

  function chooseChip(chip: string) {
    setSelectedChip(chip);
    setForced(STAGES);
    trackEngagement("find_leads_example_prompt", chip);
  }

  function openHistory() {
    setDrawerOpen(true);
    trackEngagement("find_leads_previous_chats_open");
  }

  return (
    <div ref={ref} className="fl-appframe">
      <div className="fl-hero-shell">
        {/* ------------------------------------------------------ sidebar */}
        <aside className="fl-side" aria-label="Find Leads workspace navigation">
          <div className="fl-side-brand">
            <BrandMark size={22} />
            <span>ClientTurn</span>
          </div>
          <ul className="fl-side-nav">
            <li data-active="true">
              <Search size={14} />
              Find Leads
            </li>
            <li>
              <Bookmark size={14} />
              Saved searches
            </li>
            <li>
              <List size={14} />
              Prospects
            </li>
            <li>
              <Send size={14} />
              Campaigns
            </li>
            <li>
              <Settings size={14} />
              Settings
            </li>
          </ul>
          <div className="fl-side-credits">
            <strong>Sourcing allowance</strong>
            <div className="fl-meter" aria-hidden>
              <span style={{ width: "49%" }} />
            </div>
            <small>49% of this month used</small>
          </div>
        </aside>

        {/* --------------------------------------------------------- chat */}
        <div className="fl-chat">
          <div className="flex items-center justify-between gap-3">
            <p className="fl-chat-title">Find Leads with AI</p>
            <span className="fl-badge" data-tone="lime">
              Demo
            </span>
          </div>

          <ul
            className="fl-msglist"
            aria-label="Example conversation"
            aria-live="off"
          >
            <li className="fl-msg">
              <span className="fl-avatar">
                <BrandMark />
              </span>
              <div className="fl-bubble">
                <strong>{HERO_GREETING}</strong>
                {HERO_GREETING_SUPPORT}
              </div>
            </li>

            {sent && (
              <li
                className="fl-msg fl-msg-user fl-reveal"
                data-shown="true"
              >
                <div className="fl-bubble fl-bubble-user">{request}</div>
                <span className="fl-avatar fl-avatar-user">You</span>
              </li>
            )}

            {stage >= 3 && (
              <li className="fl-msg fl-reveal" data-shown="true">
                <span className="fl-avatar">
                  <BrandMark />
                </span>
                <div className="fl-bubble">
                  {HERO_REPLY}

                  {planFields > 0 && (
                    <dl className="mt-3.5 grid gap-2.5 border-t border-[#1b2434] pt-3.5">
                      {HERO_PLAN.slice(0, planFields).map((row) => (
                        <div
                          key={row.label}
                          className="fl-reveal grid grid-cols-[104px_minmax(0,1fr)] gap-3"
                          data-shown="true"
                        >
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6c778a]">
                            {row.label}
                          </dt>
                          <dd className="m-0 text-[12px] leading-relaxed text-[#dfe6ef]">
                            {row.value.join(" · ")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {stage >= 6 && (
                    <div
                      className="fl-reveal mt-3.5 flex flex-wrap items-center gap-2 border-t border-[#1b2434] pt-3.5"
                      data-shown="true"
                    >
                      <span className="fl-badge" data-tone="lime">
                        <Check size={11} />
                        Targeting reviewed
                      </span>
                      <span className="fl-badge">Exclusions applied</span>
                      <span className="fl-badge">Allowance checked</span>
                    </div>
                  )}
                </div>
              </li>
            )}
          </ul>

          {/* Example prompts. Buttons, because each one changes the demo. */}
          <ul
            className="fl-chips fl-reveal"
            data-shown={stage >= 1}
            aria-label="Example prompts"
          >
            {HERO_PROMPT_CHIPS.map((chip) => (
              <li key={chip}>
                <button
                  type="button"
                  className="fl-chip"
                  data-selected={selectedChip === chip}
                  onClick={() => chooseChip(chip)}
                >
                  {chip}
                </button>
              </li>
            ))}
          </ul>

          <div className="fl-composer">
            <div className="fl-composer-box">
              <p
                data-placeholder={sent}
                aria-readonly="true"
                id="fl-composer-text"
              >
                {sent ? "Describe the businesses you want to find…" : request}
              </p>
              <Clip size={15} className="fl-clip" />
              <button
                type="button"
                className="fl-send"
                aria-describedby="fl-composer-text"
                aria-label="Run the example request"
                onClick={() => {
                  setForced(STAGES);
                  trackEngagement("find_leads_search_plan_interaction", "send");
                }}
              >
                <Send size={14} />
              </button>
            </div>
            <div className="fl-composer-foot">
              <span className="fl-pill">
                <Globe size={12} />
                Use my business context
                <ChevronDown size={12} />
              </span>
              <span className="fl-toggle-row">
                <span aria-hidden className="fl-switch" />
                <b>Deep search</b> (more relevant results)
              </span>
            </div>
          </div>
        </div>

        {/* --------------------------------------- acquisition profile */}
        <section className="fl-ctx" aria-labelledby="fl-ctx-title">
          <div className="fl-ctx-head">
            <h3 className="fl-panel-title" id="fl-ctx-title">
              Your acquisition profile
            </h3>
            <span className="fl-mini-btn">
              <Pencil size={11} />
              Edit
            </span>
          </div>

          <dl className="fl-deflist">
            {ACQUISITION_PROFILE.map((row, index) => {
              const RowIcon = PROFILE_ICONS[index] ?? Briefcase;
              return (
                <div className="fl-def" key={row.label}>
                  <span aria-hidden className="fl-def-icon">
                    <RowIcon size={13} />
                  </span>
                  <div>
                    <dt>{row.label}</dt>
                    <dd>{row.value.join(", ")}</dd>
                  </div>
                </div>
              );
            })}
          </dl>

          <p className="fl-callout">
            Website analysed — review and edit everything ClientTurn learns
            before it is used for sourcing.
          </p>
        </section>

        {/* ----------------------------------------- previous searches */}
        <section className="fl-recent" aria-labelledby="fl-recent-title">
          <div className="fl-ctx-head">
            <h3 className="fl-panel-title" id="fl-recent-title">
              Previous searches
            </h3>
            <button type="button" className="fl-mini-link" onClick={openHistory}>
              View all
            </button>
          </div>
          <ul className="fl-recent-list">
            {PREVIOUS_SEARCHES.slice(0, 4).map((item) => (
              <li key={item.title}>
                <button
                  type="button"
                  className="fl-recent-row"
                  onClick={openHistory}
                >
                  <Search size={13} />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </div>
                  <span className="fl-recent-age">{item.age}</span>
                  <Dots size={13} className="shrink-0 text-[#5b6679]" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <PreviousChatsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
