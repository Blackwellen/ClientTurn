import Image from "next/image";
import {
  BarChart3,
  CalendarCheck,
  ChevronDown,
  ListChecks,
  MessageSquare,
  MoreVertical,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LEADS, LEAD_TABS } from "../data";
import { Avatar, Pill } from "../primitives";

const NAV: { label: string; icon: LucideIcon; active?: boolean }[] = [
  { label: "Leads", icon: Users, active: true },
  { label: "Follow Up", icon: MessageSquare },
  { label: "Qualification", icon: ListChecks },
  { label: "Booking", icon: CalendarCheck },
  { label: "Reactivation", icon: RefreshCw },
  { label: "Analytics", icon: BarChart3 },
];

const FOOT: { label: string; icon: LucideIcon }[] = [
  { label: "Find Leads", icon: Search },
  { label: "Settings", icon: Settings },
];

/**
 * The ClientTurn application as a customer sees it — light, not another dark
 * marketing panel. It is decorative on this page, so the whole frame is hidden
 * from assistive technology and the hero copy carries the meaning instead.
 */
export function LeadConversionAppFrame({ litRow }: { litRow: number }) {
  return (
    <div className="lcp-app" aria-hidden>
      <div className="lcp-app-rail">
        <div className="lcp-app-brand">
          <Image src="/Favicon.png" alt="" width={36} height={36} />
          <span>
            Client<em>Turn</em>
          </span>
        </div>
        <ul className="lcp-app-nav">
          {NAV.map(({ label, icon: Icon, active }) => (
            <li key={label} data-active={active ? "true" : undefined}>
              <Icon strokeWidth={2} />
              {label}
            </li>
          ))}
        </ul>
        <ul className="lcp-app-nav lcp-app-rail-foot">
          {FOOT.map(({ label, icon: Icon }) => (
            <li key={label}>
              <Icon strokeWidth={2} />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="lcp-app-main">
        <div className="lcp-app-top">
          <span className="lcp-app-top-icon">
            <BarChart3 size={13} strokeWidth={2} />
          </span>
          <span className="lcp-app-top-icon">
            <MessageSquare size={13} strokeWidth={2} />
          </span>
          <span className="lcp-app-top-icon" data-avatar="true">
            <Users size={13} strokeWidth={2} />
          </span>
        </div>

        <div className="lcp-app-body">
          <p className="lcp-app-title">Leads</p>

          <div className="lcp-app-tabs">
            {LEAD_TABS.map((tab) => (
              <span
                key={tab.label}
                className="lcp-app-tab"
                data-active={tab.active ? "true" : undefined}
              >
                {tab.label}
                <b>{tab.count}</b>
              </span>
            ))}
          </div>

          <div className="lcp-app-toolbar">
            <span className="lcp-app-search">
              <Search strokeWidth={2} />
              Search leads…
            </span>
            <span className="lcp-app-chip">
              <SlidersHorizontal strokeWidth={2} />
              Filters
              <ChevronDown strokeWidth={2} />
            </span>
            <span className="lcp-app-chip">
              <ListChecks strokeWidth={2} />
              Sort
              <ChevronDown strokeWidth={2} />
            </span>
          </div>

          <div className="lcp-app-table">
            <div className="lcp-app-thead">
              <span>Name</span>
              <span>Source</span>
              <span>Status</span>
              <span className="lcp-app-hide-sm">Last activity</span>
              <span className="lcp-app-hide-sm" />
            </div>
            {LEADS.map((lead, i) => (
              <div
                key={lead.name}
                className="lcp-app-row"
                data-lit={litRow === i ? "true" : undefined}
              >
                <span className="lcp-app-who">
                  <Avatar initials={lead.initials} colours={lead.avatar} />
                  <span className="min-w-0">
                    <b>{lead.name}</b>
                    <small>{lead.email}</small>
                  </span>
                </span>
                <span className="lcp-app-cell">
                  <b>{lead.source}</b>
                </span>
                <span>
                  <Pill tone={lead.tone}>{lead.status}</Pill>
                </span>
                <span className="lcp-app-cell lcp-app-hide-sm">
                  <b>{lead.activity}</b>
                  <small>{lead.activityDetail}</small>
                </span>
                <MoreVertical size={13} className="lcp-app-kebab lcp-app-hide-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
