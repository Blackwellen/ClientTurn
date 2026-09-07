"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import {
  AnimatePresence,
  Collapse,
  LayoutGroup,
  chatMessageEnter,
  fadeUp,
  motion,
  panelEnter,
  planExpand,
  planField,
  stagger,
  useSequence,
  T,
} from "../motion";
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
  Chart,
  Check,
  ChevronDown,
  Clip,
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
 * your own words, so the first thing a visitor sees is a conversation, not a
 * filter form.
 *
 * The resting frame is the approved design — greeting, six example prompts,
 * and the request sitting in a light composer. From there the demo advances
 * once, in the order the design calls for: the request is sent, the assistant
 * replies, the structured plan unfolds field by field, and the review checks
 * arm. It runs once and stops; there is no loop.
 *
 * Nothing here talks to a server. The composer is a static demonstration
 * marked `aria-readonly`, and the send control advances the demo rather than
 * submitting a form that would go nowhere.
 */

const PROFILE_ICONS = [Briefcase, Wrench, Pin, Users, Target];

/** Stage map: 1 send · 2 reply · 3 first plan fields · 4 all fields · 5 checks. */
const STAGES = 5;

export function FindLeadsHeroChat() {
  const { ref, step, reduced } = useSequence<HTMLDivElement>(STAGES, 1100);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedChip, setSelectedChip] = React.useState<string | null>(null);
  const [forced, setForced] = React.useState(0);

  // Clicking a chip or the send control jumps to the finished frame rather
  // than leaving the visitor waiting for the timer to reach it.
  const stage = Math.max(step, forced);

  const sent = stage >= 1;
  const replied = stage >= 2;
  const planFields = stage >= 4 ? HERO_PLAN.length : stage >= 3 ? 3 : 0;
  const checksArmed = stage >= 5;

  const request = selectedChip
    ? `Find ${selectedChip.toLowerCase()} that match my services and may need a commercial roofing contractor.`
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
    // Above the fold, so this animates on mount rather than on viewport:
    // waiting for an IntersectionObserver would let the page's central visual
    // render blank if the callback never arrives.
    <motion.div
      ref={ref}
      className="fl-appframe"
      initial={reduced ? "shown" : "hidden"}
      animate="shown"
      variants={panelEnter}
    >
      <div className="fl-hero-shell">
        {/* ------------------------------------------------------ sidebar */}
        <aside className="fl-side" aria-label="Find Leads workspace navigation">
          <div className="fl-side-brand">
            <BrandMark size={18} />
            <span>
              Client<em className="not-italic text-[#74a516]">Turn</em>
            </span>
          </div>

          <motion.ul
            className="fl-side-nav"
            initial={reduced ? "shown" : "hidden"}
            animate="shown"
            variants={stagger(reduced ? 0 : 0.05, reduced ? 0 : 0.15)}
          >
            {[
              { label: "Find Leads", icon: Search, active: true },
              { label: "Saved searches", icon: Bookmark },
              { label: "Prospects", icon: List },
              { label: "Campaigns", icon: Send },
              { label: "Settings", icon: Settings },
            ].map((item) => {
              const NavIcon = item.icon;
              return (
                <motion.li
                  key={item.label}
                  variants={fadeUp}
                  data-active={item.active ? "true" : undefined}
                >
                  <NavIcon size={14} />
                  {item.label}
                </motion.li>
              );
            })}
          </motion.ul>

          <div className="fl-side-credits">
            <strong>Sourcing allowance</strong>
            <div className="fl-meter" aria-hidden>
              <motion.span
                initial={reduced ? false : { width: 0 }}
                animate={{ width: "49%" }}
                transition={reduced ? { duration: 0 } : T.slow}
              />
            </div>
            <div className="fl-side-figure">
              <span>Used this month</span>
              <b>49%</b>
            </div>
            <button type="button" className="fl-side-btn">
              Manage plan
            </button>
          </div>
        </aside>

        {/* --------------------------------------------------------- chat */}
        <div className="fl-chat">
          <div className="fl-chat-top">
            <span className="fl-badge" data-tone="lime">
              Demo
            </span>
            <div className="fl-chat-top-icons">
              <span aria-hidden className="fl-top-icon">
                <Chart size={13} />
              </span>
              <span aria-hidden className="fl-top-icon">
                <Send size={13} />
              </span>
              <span aria-hidden className="fl-top-icon" data-avatar="true">
                <Users size={13} />
              </span>
            </div>
          </div>

          <div className="fl-chat-inner">
          <p className="fl-chat-title">Find Leads with AI</p>

          <LayoutGroup>
            <motion.ul
              layout={!reduced}
              className="fl-msglist"
              aria-label="Example conversation"
            >
              <motion.li layout={!reduced} className="fl-msg">
                <span className="fl-avatar">
                  <BrandMark />
                </span>
                <div className="fl-bubble">
                  <strong>{HERO_GREETING}</strong>
                  {HERO_GREETING_SUPPORT}
                </div>
              </motion.li>

              <AnimatePresence initial={false}>
                {sent && (
                  <motion.li
                    key="request"
                    layout={!reduced}
                    className="fl-msg fl-msg-user"
                    initial={reduced ? "shown" : "hidden"}
                    animate="shown"
                    variants={chatMessageEnter(true)}
                  >
                    <div className="fl-bubble fl-bubble-user">{request}</div>
                    <span className="fl-avatar fl-avatar-user">You</span>
                  </motion.li>
                )}

                {replied && (
                  <motion.li
                    key="reply"
                    layout={!reduced}
                    className="fl-msg"
                    initial={reduced ? "shown" : "hidden"}
                    animate="shown"
                    variants={chatMessageEnter(false)}
                  >
                    <span className="fl-avatar">
                      <BrandMark />
                    </span>
                    <div className="fl-bubble">
                      {HERO_REPLY}

                      <Collapse open={planFields > 0} variants={planExpand}>
                        <motion.dl
                          className="mt-3.5 grid gap-2.5 border-t border-[#1b2434] pt-3.5"
                          initial={reduced ? "shown" : "hidden"}
                          animate="shown"
                          variants={stagger(reduced ? 0 : 0.06)}
                        >
                          {HERO_PLAN.slice(0, planFields).map((row) => (
                            <motion.div
                              key={row.label}
                              className="grid grid-cols-[104px_minmax(0,1fr)] gap-3"
                              variants={planField}
                            >
                              <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#56637a]">
                                {row.label}
                              </dt>
                              <dd className="m-0 text-[12px] leading-relaxed text-[#dfe6ef]">
                                {row.value.join(" · ")}
                              </dd>
                            </motion.div>
                          ))}
                        </motion.dl>
                      </Collapse>

                      <Collapse open={checksArmed} variants={planExpand}>
                        <motion.div
                          className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-[#1b2434] pt-3.5"
                          initial={reduced ? "shown" : "hidden"}
                          animate="shown"
                          variants={stagger(reduced ? 0 : 0.08)}
                        >
                          {[
                            "Targeting reviewed",
                            "Exclusions applied",
                            "Allowance checked",
                          ].map((check, index) => (
                            <motion.span
                              key={check}
                              className="fl-badge"
                              data-tone={index === 0 ? "lime" : "neutral"}
                              variants={fadeUp}
                            >
                              {index === 0 && <Check size={11} />}
                              {check}
                            </motion.span>
                          ))}
                        </motion.div>
                      </Collapse>
                    </div>
                  </motion.li>
                )}
              </AnimatePresence>
            </motion.ul>

            {/* Example prompts. Present from the first paint, as in the design:
                they are the invitation, not a reveal. */}
            <motion.ul
              layout={!reduced}
              className="fl-chips"
              aria-label="Example prompts"
              initial={reduced ? "shown" : "hidden"}
              animate="shown"
              variants={stagger(reduced ? 0 : 0.04, reduced ? 0 : 0.1)}
            >
              {HERO_PROMPT_CHIPS.map((chip) => (
                <motion.li key={chip} variants={fadeUp}>
                  <motion.button
                    type="button"
                    className="fl-chip"
                    data-selected={selectedChip === chip}
                    onClick={() => chooseChip(chip)}
                    whileHover={reduced ? undefined : { y: -2 }}
                    whileTap={reduced ? undefined : { scale: 0.97 }}
                    transition={T.fast}
                  >
                    {chip}
                  </motion.button>
                </motion.li>
              ))}
            </motion.ul>

            <motion.div layout={!reduced} className="fl-composer">
              <div className="fl-composer-box">
                <p
                  data-placeholder={sent}
                  aria-readonly="true"
                  id="fl-composer-text"
                >
                  {sent ? "Describe the businesses you want to find…" : request}
                </p>
                <Clip size={15} className="fl-clip" />
                <motion.button
                  type="button"
                  className="fl-send"
                  aria-describedby="fl-composer-text"
                  aria-label="Run the example request"
                  onClick={() => {
                    setForced(STAGES);
                    trackEngagement(
                      "find_leads_search_plan_interaction",
                      "send",
                    );
                  }}
                  whileHover={reduced ? undefined : { scale: 1.06 }}
                  whileTap={reduced ? undefined : { scale: 0.94 }}
                  transition={T.fast}
                >
                  <Send size={14} />
                </motion.button>
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
            </motion.div>
          </LayoutGroup>
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

          <motion.dl
            className="fl-deflist"
            initial={reduced ? "shown" : "hidden"}
            animate="shown"
            variants={stagger(reduced ? 0 : 0.06)}
          >
            {ACQUISITION_PROFILE.map((row, index) => {
              const RowIcon = PROFILE_ICONS[index] ?? Briefcase;
              return (
                <motion.div className="fl-def" key={row.label} variants={fadeUp}>
                  <span aria-hidden className="fl-def-icon">
                    <RowIcon size={13} />
                  </span>
                  <div>
                    <dt>{row.label}</dt>
                    <dd>{row.value.join(", ")}</dd>
                  </div>
                </motion.div>
              );
            })}
          </motion.dl>

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
          <motion.ul
            className="fl-recent-list"
            initial={reduced ? "shown" : "hidden"}
            animate="shown"
            variants={stagger(reduced ? 0 : 0.06)}
          >
            {PREVIOUS_SEARCHES.slice(0, 4).map((item) => (
              <motion.li key={item.title} variants={fadeUp}>
                <motion.button
                  type="button"
                  className="fl-recent-row"
                  onClick={openHistory}
                  whileHover={reduced ? undefined : { x: 2 }}
                  transition={T.fast}
                >
                  <Search size={13} />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </div>
                  <span className="fl-recent-age">{item.age}</span>
                </motion.button>
              </motion.li>
            ))}
          </motion.ul>
        </section>
      </div>

      <PreviousChatsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </motion.div>
  );
}
