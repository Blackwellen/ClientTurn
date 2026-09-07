import {
  ArrowRight,
  Banknote,
  ChevronDown,
  Hammer,
  MapPin,
  MoreVertical,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { LEADS, LEAD_TABS, SELECTED_LEAD } from "../data";
import { Avatar, Panel, Pill } from "../primitives";

const FACT_ICONS = [Radio, Hammer, MapPin, Banknote];

/** The Leads surface: every enquiry in one list, with the selected one expanded. */
export function CapturePanel() {
  return (
    <Panel
      title="Leads"
      actions={
        <span className="lcp-btn-blue">
          <Plus size={13} strokeWidth={2.5} aria-hidden />
          Add Lead
        </span>
      }
    >
      <div className="lcp-cap-tabs">
        {LEAD_TABS.map((tab) => (
          <span
            key={tab.label}
            className="lcp-cap-tab"
            data-active={tab.active ? "true" : undefined}
          >
            {tab.label}
            <b>{tab.count}</b>
          </span>
        ))}
      </div>

      <div className="lcp-cap-toolbar">
        <span className="lcp-input">
          <Search strokeWidth={2} aria-hidden />
          Search leads…
        </span>
        <span className="lcp-btn-quiet">
          <SlidersHorizontal size={12} strokeWidth={2} aria-hidden />
          Filters
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </span>
        <span className="lcp-btn-quiet">
          <SlidersHorizontal size={12} strokeWidth={2} aria-hidden />
          Sort
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </span>
      </div>

      <div className="lcp-cap-table">
        <div className="lcp-cap-thead">
          <span className="lcp-check" aria-hidden />
          <span>Name</span>
          <span>Source</span>
          <span>Status</span>
          <span className="lcp-hide-sm">Last activity</span>
          <span />
        </div>
        {LEADS.map((lead) => (
          <div key={lead.name} className="lcp-cap-row">
            <span className="lcp-check" aria-hidden />
            <span className="lcp-cap-who">
              <Avatar initials={lead.initials} colours={lead.avatar} />
              <span className="min-w-0">
                <b>{lead.name}</b>
                <small>{lead.email}</small>
              </span>
            </span>
            <span className="lcp-cap-cell">
              <b>{lead.source}</b>
            </span>
            <span>
              <Pill tone={lead.tone}>{lead.status}</Pill>
            </span>
            <span className="lcp-cap-cell lcp-hide-sm">
              <b>{lead.activity}</b>
              <small>{lead.activityDetail}</small>
            </span>
            <MoreVertical size={13} className="lcp-app-kebab" aria-hidden />
          </div>
        ))}
      </div>

      <div className="lcp-cap-detail">
        <div className="lcp-cap-detail-top">
          <Avatar
            initials={SELECTED_LEAD.initials}
            colours={SELECTED_LEAD.avatar}
          />
          <span className="min-w-0">
            <span className="lcp-cap-detail-name">
              <b>{SELECTED_LEAD.name}</b>
              <Pill tone="qualified">Qualified</Pill>
            </span>
            <small>
              {SELECTED_LEAD.email} · {SELECTED_LEAD.phone}
            </small>
          </span>
          <span className="lcp-btn-quiet">
            View profile
            <ArrowRight size={12} strokeWidth={2} aria-hidden />
          </span>
        </div>

        <div className="lcp-cap-facts">
          {SELECTED_LEAD.facts.map((fact, i) => {
            const Icon = FACT_ICONS[i];
            return (
              <div key={fact.label} className="lcp-cap-fact">
                <Icon size={14} strokeWidth={2} aria-hidden />
                <span className="min-w-0">
                  <small>{fact.label}</small>
                  <b>{fact.value}</b>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
