import * as React from "react";
import {
  ArrowDownToLine,
  CalendarCheck,
  FileText,
  Globe,
  Megaphone,
  MessageSquare,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Mail,
  Repeat,
} from "lucide-react";

/**
 * The hero diagram: two lanes converging on one system.
 *
 * Inbound (enquiries you already have) and outbound (customers you have not
 * met) enter the same hub, and both leave it as opportunities and then as
 * business. Drawn as a labelled node graph rather than a picture so it stays
 * readable at 200% zoom, reflows on a phone, and is announced as a single
 * described figure instead of sixteen orphaned list items.
 *
 * The connectors are decorative: every relationship the lines express is also
 * stated in the group headings and in the surrounding copy.
 */

type Node = { icon: React.ReactNode; label: string };

const INBOUND: Node[] = [
  { icon: <Globe size={12} />, label: "Website forms" },
  { icon: <Megaphone size={12} />, label: "Meta Lead Ads" },
  { icon: <Phone size={12} />, label: "Phone calls" },
  { icon: <Mail size={12} />, label: "Emails" },
  { icon: <FileText size={12} />, label: "Manual entry" },
];

const OUTBOUND: Node[] = [
  { icon: <Sparkles size={12} />, label: "AI search" },
  { icon: <Search size={12} />, label: "Licensed data providers" },
  { icon: <Target size={12} />, label: "Intent signals" },
  { icon: <ShieldCheck size={12} />, label: "Verified contacts" },
  { icon: <Mail size={12} />, label: "Outbound campaigns" },
];

const WARM: Node[] = [
  { icon: <UserCheck size={12} />, label: "Qualified leads" },
  { icon: <MessageSquare size={12} />, label: "Active conversations" },
  { icon: <Repeat size={12} />, label: "Reactivation" },
  { icon: <Users size={12} />, label: "Ongoing nurture" },
];

const CONVERTED: Node[] = [
  { icon: <CalendarCheck size={12} />, label: "Bookings" },
  { icon: <TrendingUp size={12} />, label: "Sales pipeline" },
  { icon: <ArrowDownToLine size={12} />, label: "Team handover" },
  { icon: <FileText size={12} />, label: "Attributed revenue" },
];

function NodeGroup({
  title,
  nodes,
  tone = "lime",
}: {
  title: string;
  nodes: Node[];
  tone?: "lime" | "blue";
}) {
  return (
    <div className="pub-arch-group" data-tone={tone}>
      <p className="pub-arch-title">{title}</p>
      <ul>
        {nodes.map((node) => (
          <li key={node.label}>
            <span aria-hidden>{node.icon}</span>
            {node.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Architecture() {
  return (
    <figure
      className="pub-arch"
      role="img"
      aria-label="Two lanes feed one system. Inbound sources — website forms, Meta Lead Ads, phone calls, emails and manual entry — and outbound sourcing — AI search, licensed data providers, intent signals, verified contacts and outbound campaigns — both enter ClientTurn. ClientTurn produces warm opportunities: qualified leads, active conversations, reactivation and ongoing nurture; and converted business: bookings, sales pipeline, team handover and attributed revenue."
    >
      {/* Connector layer. Decorative — the copy carries the same relationships. */}
      <svg className="pub-arch-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="pub-arch-in" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#B7F34A" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#B7F34A" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="pub-arch-out" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#B7F34A" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#B7F34A" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d="M30 22 C 42 22 42 50 50 50" stroke="url(#pub-arch-in)" strokeWidth="0.5" fill="none" />
        <path d="M30 78 C 42 78 42 50 50 50" stroke="url(#pub-arch-in)" strokeWidth="0.5" fill="none" />
        <path d="M50 50 C 58 50 58 22 70 22" stroke="url(#pub-arch-out)" strokeWidth="0.5" fill="none" />
        <path d="M50 50 C 58 50 58 78 70 78" stroke="url(#pub-arch-out)" strokeWidth="0.5" fill="none" />
      </svg>

      <div className="pub-arch-col">
        <NodeGroup title="Inbound leads" nodes={INBOUND} />
        <NodeGroup title="Find new customers" nodes={OUTBOUND} tone="blue" />
      </div>

      <div className="pub-arch-hub">
        <span className="pub-arch-lane" aria-hidden>
          Inbound
        </span>
        <span className="pub-arch-mark" aria-hidden>
          C
        </span>
        <strong>ClientTurn</strong>
        <span className="pub-arch-lane" aria-hidden>
          Outbound
        </span>
      </div>

      <div className="pub-arch-col">
        <NodeGroup title="Warm opportunities" nodes={WARM} />
        <NodeGroup title="Converted business" nodes={CONVERTED} />
      </div>
    </figure>
  );
}
