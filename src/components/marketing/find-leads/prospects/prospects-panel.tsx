"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import {
  AnimatePresence,
  fadeUp,
  motion,
  prospectTableReveal,
  stagger,
  useReducedMotion,
  T,
} from "../motion";
import {
  DEMO_PROSPECTS,
  PROSPECT_ACTIONS,
  PROSPECT_FILTERS,
  type DemoProspect,
} from "../data";
import {
  AppSurface,
  Badge,
  Filter,
  Plus,
  Sliders,
  type BadgeTone,
} from "../pieces";

/**
 * The Prospect Inbox.
 *
 * Prospects are deliberately *not* leads: eligibility and outreach state are
 * shown so a buyer can see that a sourced record is held back until it either
 * engages or is explicitly promoted.
 *
 * Two representations of the same eleven fields, because eleven columns cannot
 * fit a third-width card at any legible size:
 *
 *   * the table carries the eight columns the approved design shows, scrolling
 *     horizontally inside its own container if the card is narrower still;
 *   * the card list below it — the only representation under 768px — carries
 *     all eleven, including eligibility, campaign, outreach and last activity.
 *
 * Nothing is hidden either way; the fields are simply not all in one row.
 *
 * The quick filters really filter. A filter bar that does nothing when clicked
 * teaches a visitor that the whole demo is a picture.
 */

const INTENT_TONE: Record<DemoProspect["intent"], BadgeTone> = {
  High: "green",
  Medium: "lime",
  Low: "neutral",
  None: "neutral",
};

const OUTREACH_TONE: Record<DemoProspect["outreach"], BadgeTone> = {
  Ready: "lime",
  Replied: "green",
  "In outreach": "blue",
  "Not contacted": "neutral",
};

function matches(prospect: DemoProspect, filter: string): boolean {
  switch (filter) {
    case "A Grade":
      return prospect.grade === "A" || prospect.grade === "A+";
    case "Intent":
      return prospect.intent !== "None";
    case "Ready":
      return prospect.outreach === "Ready";
    case "Contacted":
      return prospect.outreach === "In outreach" || prospect.outreach === "Replied";
    case "Replied":
      return prospect.outreach === "Replied";
    case "Review":
      return prospect.eligibility === "Review";
    default:
      return true;
  }
}

export function ProspectsPanel() {
  const [filter, setFilter] = React.useState("All");
  const reduced = useReducedMotion();
  const rows = DEMO_PROSPECTS.filter((p) => matches(p, filter));

  return (
    <AppSurface
      title="Prospects"
      subtitle="1,187 sourced · illustrative data"
      actions={
        <div className="flex items-center gap-2">
          <span className="fl-mini-btn">
            <Filter size={11} />
            Filters
          </span>
          <span className="fl-mini-btn">
            <Sliders size={11} />
            Sort
          </span>
        </div>
      }
      footer={
        <div className="fl-app-foot">
          <span>
            {rows.length} of {DEMO_PROSPECTS.length} examples
          </span>
          <span className="fl-mini-btn">
            <Plus size={11} />
            Add to campaign
          </span>
        </div>
      }
    >
      {/* --------------------------------------------------- quick filters */}
      <motion.ul
        className="fl-filters"
        aria-label="Prospect quick filters"
        initial={reduced ? "shown" : "hidden"}
        whileInView="shown"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger(reduced ? 0 : 0.04)}
      >
        {PROSPECT_FILTERS.map((item) => (
          <motion.li key={item.label} variants={fadeUp}>
            <motion.button
              type="button"
              className="fl-filter"
              aria-pressed={filter === item.label}
              onClick={() => {
                setFilter(item.label);
                trackEngagement("find_leads_prospect_open", item.label);
              }}
              whileTap={reduced ? undefined : { scale: 0.96 }}
              transition={T.fast}
            >
              {item.label}
              <b>{item.count.toLocaleString("en-GB")}</b>
            </motion.button>
          </motion.li>
        ))}
      </motion.ul>

      {/* --------------------------------------------------- table (≥768px) */}
      <div className="fl-table-scroll">
        <table className="fl-table">
          <caption className="sr-only">
            Example sourced prospects with company, location and size,
            contact and role, fit, intent and verification. Eligibility,
            campaign, outreach state and last activity follow the table.
          </caption>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Contact</th>
              <th scope="col">Fit</th>
              <th scope="col">Intent</th>
              <th scope="col">Verified</th>
            </tr>
          </thead>
          <motion.tbody
            initial={reduced ? "shown" : "hidden"}
            whileInView="shown"
            viewport={{ once: true, amount: 0.15 }}
            variants={stagger(reduced ? 0 : 0.045)}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {rows.map((row) => (
                <motion.tr
                  key={row.company}
                  layout={!reduced}
                  variants={prospectTableReveal}
                  initial={reduced ? "shown" : "hidden"}
                  animate="shown"
                  exit={reduced ? undefined : { opacity: 0 }}
                >
                  <td>
                    <span className="fl-cell-company">
                      <span aria-hidden className="fl-logo">
                        {row.initials}
                      </span>
                      <span>
                        <strong>{row.company}</strong>
                        <small>
                          {row.location} · {row.companyMeta}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="fl-cell-contact">
                      <strong>{row.contact}</strong>
                      <small>{row.role}</small>
                    </span>
                  </td>
                  <td>
                    <span className="fl-fit" data-grade={row.grade}>
                      <b>{row.fit}</b>
                      <span>{row.grade}</span>
                    </span>
                  </td>
                  <td>
                    {row.intent === "None" ? (
                      <span className="fl-muted">None</span>
                    ) : (
                      <Badge tone={INTENT_TONE[row.intent]}>{row.intent}</Badge>
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={row.verification === "Verified" ? "green" : "amber"}
                    >
                      {row.verification}
                    </Badge>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </motion.tbody>
        </table>
      </div>

      {/* -------------------------------- every field, per prospect (<768px) */}
      <ul className="fl-pcards" aria-label="Example sourced prospects">
        {rows.map((row) => (
          <li className="fl-pcard" key={row.company}>
            <div className="fl-pcard-top">
              <span aria-hidden className="fl-logo">
                {row.initials}
              </span>
              <div>
                <strong className="block text-[13px] font-medium text-[#f2f6fa]">
                  {row.contact}
                </strong>
                <small className="mt-0.5 block text-[11px] text-[#56637a]">
                  {row.role} · {row.company}
                </small>
                <small className="mt-0.5 block text-[11px] text-[#56637a]">
                  {row.location}
                  {row.campaign ? ` · ${row.campaign}` : ""}
                </small>
              </div>
              <span className="fl-fit" data-grade={row.grade}>
                <b>{row.fit}</b>
                <span>{row.grade}</span>
              </span>
            </div>
            <div className="fl-pcard-meta">
              {row.intent !== "None" && (
                <Badge tone={INTENT_TONE[row.intent]}>{row.intent} intent</Badge>
              )}
              <Badge tone={row.verification === "Verified" ? "green" : "amber"}>
                {row.verification}
              </Badge>
              <Badge tone={row.eligibility === "Eligible" ? "lime" : "amber"}>
                {row.eligibility}
              </Badge>
              <Badge tone={OUTREACH_TONE[row.outreach]}>{row.outreach}</Badge>
            </div>
            <div className="fl-pcard-foot">
              <small>{row.lastActivity}</small>
              <span className="fl-mini-btn">Open details</span>
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="fl-note-line">
          No example prospects match that filter — the product shows an empty
          state here, naming the filter that produced it.
        </p>
      )}

      {/* The four fields the table cannot fit, for the selected cohort. */}
      <div className="fl-block">
        <p className="fl-sublabel">Selected prospect</p>
        <ul className="fl-rowlist">
          {rows[0] && (
            <>
              <li>
                <span className="fl-rowlist-label">Eligibility</span>
                <span className="fl-rowlist-value">
                  <Badge
                    tone={rows[0].eligibility === "Eligible" ? "lime" : "amber"}
                  >
                    {rows[0].eligibility}
                  </Badge>
                </span>
              </li>
              <li>
                <span className="fl-rowlist-label">Campaign</span>
                <span className="fl-rowlist-value">
                  {rows[0].campaign ?? "Not assigned"}
                </span>
              </li>
              <li>
                <span className="fl-rowlist-label">Outreach</span>
                <span className="fl-rowlist-value">
                  <Badge tone={OUTREACH_TONE[rows[0].outreach]}>
                    {rows[0].outreach}
                  </Badge>
                </span>
              </li>
              <li>
                <span className="fl-rowlist-label">Last activity</span>
                <span className="fl-rowlist-value">
                  {rows[0].lastActivity}
                </span>
              </li>
            </>
          )}
        </ul>
      </div>

      {/* Row actions, listed rather than hidden in a menu the demo cannot open. */}
      <ul className="fl-controls">
        {PROSPECT_ACTIONS.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ul>
      <p className="fl-note-line">
        Promotion to a lead only appears once a prospect has engaged. Fictional
        people and companies, shown to demonstrate the interface.
      </p>
    </AppSurface>
  );
}
