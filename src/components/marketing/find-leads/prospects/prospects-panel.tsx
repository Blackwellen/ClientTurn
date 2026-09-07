"use client";

import * as React from "react";
import { trackEngagement } from "@/lib/marketing/track";
import {
  DEMO_PROSPECTS,
  PROSPECT_ACTIONS,
  PROSPECT_FILTERS,
  type DemoProspect,
} from "../data";
import {
  AppSurface,
  Badge,
  Dots,
  Filter,
  Plus,
  Sliders,
  type BadgeTone,
} from "../pieces";

/**
 * The Prospect Inbox.
 *
 * Prospects are deliberately *not* leads: the eligibility and outreach columns
 * exist so a buyer can see that a sourced record is held back until it is
 * either engaged or explicitly promoted. The quick filters work, because a
 * filter bar that does nothing when clicked teaches a visitor that the demo is
 * a picture.
 *
 * Ten columns cannot survive a phone, so below 768px the same fields render as
 * cards. Both markups are present; CSS chooses.
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
            Showing {rows.length} of {DEMO_PROSPECTS.length} example prospects
          </span>
          <span className="fl-mini-btn">
            <Plus size={11} />
            Add to campaign
          </span>
        </div>
      }
    >
      {/* --------------------------------------------------- quick filters */}
      <ul className="fl-filters" aria-label="Prospect quick filters">
        {PROSPECT_FILTERS.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className="fl-filter"
              aria-pressed={filter === item.label}
              onClick={() => {
                setFilter(item.label);
                trackEngagement("find_leads_prospect_open", item.label);
              }}
            >
              {item.label}
              <b>{item.count.toLocaleString("en-GB")}</b>
            </button>
          </li>
        ))}
      </ul>

      {/* --------------------------------------------------- table (≥768px) */}
      <div className="fl-table-scroll">
        <table className="fl-table">
          <caption className="sr-only">
            Example sourced prospects, with fit, intent, verification,
            eligibility and outreach state
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col">Prospect</th>
              <th scope="col">Fit</th>
              <th scope="col">Intent</th>
              <th scope="col">Role</th>
              <th scope="col">Location</th>
              <th scope="col">Verification</th>
              <th scope="col">Eligibility</th>
              <th scope="col">Campaign</th>
              <th scope="col">Outreach</th>
              <th scope="col">Last activity</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.company}>
                <td>
                  <span aria-hidden className="fl-check" />
                </td>
                <td>
                  <span className="fl-cell-company">
                    <span aria-hidden className="fl-logo">
                      {row.initials}
                    </span>
                    <span>
                      <strong>{row.contact}</strong>
                      <small>{row.company}</small>
                    </span>
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
                    <span className="fl-muted">No recent intent</span>
                  ) : (
                    <Badge tone={INTENT_TONE[row.intent]}>
                      {row.intent} intent
                    </Badge>
                  )}
                </td>
                <td className="fl-muted">{row.role}</td>
                <td className="fl-muted">{row.location}</td>
                <td>
                  <Badge tone={row.verification === "Verified" ? "green" : "amber"}>
                    {row.verification}
                  </Badge>
                </td>
                <td>
                  <Badge tone={row.eligibility === "Eligible" ? "lime" : "amber"}>
                    {row.eligibility}
                  </Badge>
                </td>
                <td className="fl-muted">{row.campaign ?? "—"}</td>
                <td>
                  <Badge tone={OUTREACH_TONE[row.outreach]}>{row.outreach}</Badge>
                </td>
                <td className="fl-muted">{row.lastActivity}</td>
                <td>
                  <Dots size={13} className="text-[#5b6679]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --------------------------------------------------- cards (<768px) */}
      <ul className="fl-pcards" aria-label="Example sourced prospects">
        {rows.map((row) => (
          <li className="fl-pcard" key={row.company}>
            <div className="fl-pcard-top">
              <span aria-hidden className="fl-logo">
                {row.initials}
              </span>
              <div>
                <strong className="block text-[13px] font-medium text-[#f2f6fb]">
                  {row.contact}
                </strong>
                <small className="mt-0.5 block text-[11px] text-[#6c778a]">
                  {row.role} · {row.company}
                </small>
                <small className="mt-0.5 block text-[11px] text-[#6c778a]">
                  {row.location}
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
          state here with the filter that produced it.
        </p>
      )}

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
