"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ListFilter,
  Mail,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SquareCheckBig,
  TrendingUp,
  User,
} from "lucide-react";
import { trackEngagement } from "@/lib/marketing/track";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, SectionHeading } from "../ui";
import { ANCHORS } from "../nav-data";
import { Reveal } from "../reveal";

/**
 * "One system around the conversion" — six capability cards.
 *
 * Each card carries a faithful fragment of the real interface rather than a
 * screenshot, because the repository holds no product screenshots and a
 * rebuilt fragment stays correct when the product moves. The values inside
 * every fragment are illustrative interface samples, which the section says
 * once, in visible copy, above the grid.
 *
 * Client-side only for the `capability_click` analytics event; everything
 * rendered here is static.
 */

/* -------------------------------------------------- fragment furniture --- */

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pub-fragment pub-fragment-lift flex h-full min-w-0 flex-col overflow-hidden">
      {children}
      {/* Absorbs the leftover height so every panel in a row ends flush,
          whatever number of rows its fragment happens to carry. */}
      <div className="flex-1" />
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-[rgb(117_148_180/0.14)] px-3.5 py-3">
      {children}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <span className="flex-1 text-[12.5px] font-semibold text-[var(--pub-text)]">{children}</span>;
}

function MiniButton({
  children,
  tone = "quiet",
}: {
  children: React.ReactNode;
  tone?: "quiet" | "lime";
}) {
  return (
    <span
      className={
        tone === "lime"
          ? "inline-flex items-center gap-1 rounded-md bg-[var(--pub-lime)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--pub-lime-ink)]"
          : "inline-flex items-center gap-1 rounded-md border border-[var(--pub-border)] px-2.5 py-1 text-[10.5px] text-[var(--pub-text-secondary)]"
      }
    >
      {children}
    </span>
  );
}

function Tabs({ items }: { items: { label: string; count?: number; active?: boolean }[] }) {
  return (
    <div className="flex flex-nowrap gap-1 overflow-hidden px-3.5 py-2.5">
      {items.map((tab) => (
        <span
          key={tab.label}
          className={
            tab.active
              ? "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--pub-lime)]"
              : "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-[10px] text-[var(--pub-text-muted)]"
          }
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="rounded-full bg-[rgb(117_148_180/0.2)] px-1.5 text-[9px] font-semibold text-[var(--pub-text-secondary)]">
              {tab.count}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function Box({ checked }: { checked?: boolean }) {
  return checked ? (
    <span className="pub-tile" data-solid="true" style={{ width: 15, height: 15, borderRadius: 4 }}>
      <Check className="size-2.5" strokeWidth={3.4} />
    </span>
  ) : (
    <span className="size-[15px] shrink-0 rounded-[4px] border border-[rgb(117_148_180/0.36)]" />
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[rgb(117_148_180/0.16)] text-[9.5px] font-semibold text-[var(--pub-text-secondary)]">
      {initials}
    </span>
  );
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2.5"
      style={{ borderBottom: last ? undefined : "1px solid rgb(117 148 180 / 0.1)" }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ fragments --- */

function InboxFragment() {
  const rows = [
    { initials: "JT", name: "James Taylor", source: "New enquiry", msg: "Hi, I'm interested in …", time: "2m ago", live: true },
    { initials: "SS", name: "Sophie Smith", source: "Website enquiry", msg: "Do you cover this area?", time: "12m ago", live: true },
    { initials: "MD", name: "Michael Davies", source: "Property developer", msg: "Can you send more info?", time: "1h ago" },
    { initials: "EC", name: "Emma Carter", source: "Referral", msg: "Looking to get a quote …", time: "2h ago" },
  ];
  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Inbox</PanelTitle>
        <Search aria-hidden className="size-3.5 text-[var(--pub-text-muted)]" />
        <MiniButton>
          <ListFilter aria-hidden className="size-3" />
          Filter
        </MiniButton>
      </PanelHead>
      <Tabs
        items={[
          { label: "All leads", count: 12, active: true },
          { label: "Unread", count: 3 },
          { label: "Assigned" },
          { label: "Follow up" },
        ]}
      />
      {rows.map((row, index) => (
        <Row key={row.name} last={index === rows.length - 1}>
          <Box />
          <Avatar initials={row.initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-semibold text-[var(--pub-text)]">
              {row.name}
            </span>
            <span className="block truncate text-[10px] text-[var(--pub-text-muted)]">
              {row.source}
            </span>
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-[10.5px] text-[var(--pub-text-secondary)] sm:block">
            {row.msg}
          </span>
          <span className="shrink-0 text-[10px] text-[var(--pub-text-muted)]">{row.time}</span>
          <span
            className={
              row.live
                ? "pub-node-dot size-2 shrink-0"
                : "size-2 shrink-0 rounded-full bg-[rgb(117_148_180/0.3)]"
            }
          />
        </Row>
      ))}
    </Panel>
  );
}

function FindLeadsFragment() {
  const rows = ["Riverside Homes", "Oakwood Developments", "Centurion Living"];
  return (
    <Panel>
      <div className="flex items-center gap-2 px-3.5 pt-3.5">
        <span className="flex flex-1 items-center gap-2 rounded-lg border border-[rgb(117_148_180/0.2)] bg-[rgb(255_255_255/0.02)] px-2.5 py-2">
          <Search aria-hidden className="size-3.5 shrink-0 text-[var(--pub-text-muted)]" />
          <span className="truncate text-[11px] text-[var(--pub-text-secondary)]">
            Residential developers in Manchester
          </span>
        </span>
        <MiniButton tone="lime">Search</MiniButton>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
        {["Construction", "Residential", "Manchester"].map((chip) => (
          <span key={chip} className="pub-chip !py-1 !text-[10px]">
            {chip}
            <span aria-hidden className="text-[var(--pub-text-muted)]">
              &times;
            </span>
          </span>
        ))}
        <span className="pub-chip !py-1 !text-[10px] !text-[var(--pub-text-muted)]">
          <Plus aria-hidden className="size-2.5" /> Add filter
        </span>
      </div>
      <div className="flex items-center justify-between border-y border-[rgb(117_148_180/0.1)] px-3.5 py-2">
        <span className="text-[10.5px] text-[var(--pub-text-secondary)]">248 prospects found</span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--pub-text-muted)]">
          <Box /> Select all
        </span>
      </div>
      {rows.map((name, index) => (
        <Row key={name} last={index === rows.length - 1}>
          <Box />
          <span className="pub-tile" style={{ width: 26, height: 26, borderRadius: 7 }}>
            <Building2 className="size-3.5" strokeWidth={2.1} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-semibold text-[var(--pub-text)]">
              {name}
            </span>
            <span className="block truncate text-[10px] text-[var(--pub-text-muted)]">
              Residential developer &middot; Manchester
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] px-2 py-0.5 text-[9.5px] font-semibold text-[var(--pub-lime)]">
            <Check aria-hidden className="size-2.5" strokeWidth={3} />
            Verified
          </span>
        </Row>
      ))}
    </Panel>
  );
}

function FollowUpFragment() {
  const steps = [
    { icon: Mail, label: "Day 1 — Email", copy: "Thanks for your enquiry…" },
    { icon: MessageSquareText, label: "Day 3 — SMS", copy: "Just checking if you had any questions?" },
    { icon: MessageCircle, label: "Day 7 — WhatsApp", copy: "Here's some more information…" },
  ];
  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Follow-up sequence</PanelTitle>
        <span className="text-[10.5px] text-[var(--pub-text-muted)]">Active</span>
        <span className="flex h-4 w-7 shrink-0 items-center rounded-full bg-[var(--pub-lime)] px-0.5">
          <span className="ml-auto block size-3 rounded-full bg-[var(--pub-lime-ink)]" />
        </span>
      </PanelHead>
      <ol className="relative px-3.5 py-3">
        <span
          aria-hidden
          className="absolute bottom-8 left-[26px] top-8 w-px bg-[rgb(183_243_74/0.3)]"
        />
        {steps.map((step) => (
          <li key={step.label} className="relative flex items-center gap-2.5 py-2">
            <span className="pub-node-dot size-2 shrink-0" />
            <span className="pub-tile" style={{ width: 28, height: 28, borderRadius: 8 }}>
              <step.icon className="size-3.5" strokeWidth={2.1} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-semibold text-[var(--pub-text)]">
                {step.label}
              </span>
              <span className="block truncate text-[10px] text-[var(--pub-text-muted)]">
                {step.copy}
              </span>
            </span>
            <MiniButton>Auto-send</MiniButton>
          </li>
        ))}
      </ol>
      <div className="border-t border-[rgb(117_148_180/0.1)] px-3.5 py-2.5 text-center">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--pub-text-secondary)]">
          <Plus aria-hidden className="size-3" /> Add step
        </span>
      </div>
    </Panel>
  );
}

function QualificationFragment() {
  const criteria = [
    { label: "Budget", question: "What's your estimated budget?", required: true },
    { label: "Timescale", question: "When do you plan to start?", required: true },
    { label: "Project type", question: "What type of project is this?", required: true },
    { label: "Location", question: "Where is the project located?", required: false },
  ];
  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Qualification criteria</PanelTitle>
        <MiniButton>
          <Pencil aria-hidden className="size-3" />
          Edit
        </MiniButton>
      </PanelHead>
      {criteria.map((item, index) => (
        <Row key={item.label} last={index === criteria.length - 1}>
          <Box checked />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-semibold text-[var(--pub-text)]">
              {item.label}
            </span>
            <span className="block truncate text-[10px] text-[var(--pub-text-muted)]">
              {item.question}
            </span>
          </span>
          <MiniButton>{item.required ? "Required" : "Optional"}</MiniButton>
        </Row>
      ))}
    </Panel>
  );
}

function ReactivationFragment() {
  const rows = [
    { initials: "DM", name: "Daniel Moore", meta: "Last contact 6 months ago" },
    { initials: "HW", name: "Harriet Wilson", meta: "Last contact 8 months ago" },
    { initials: "TR", name: "Thomas Reed", meta: "Last contact 11 months ago" },
    { initials: "OB", name: "Olivia Bennett", meta: "Last contact 12 months ago" },
  ];
  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Reactivation campaign</PanelTitle>
        <MiniButton tone="lime">Create campaign</MiniButton>
      </PanelHead>
      <Tabs
        items={[
          { label: "Eligible", count: 142, active: true },
          { label: "Suppressed", count: 24 },
          { label: "Contacted" },
          { label: "Converted" },
        ]}
      />
      {rows.map((row, index) => (
        <Row key={row.name} last={index === rows.length - 1}>
          <Box />
          <Avatar initials={row.initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-semibold text-[var(--pub-text)]">
              {row.name}
            </span>
            <span className="block truncate text-[10px] text-[var(--pub-text-muted)]">
              {row.meta}
            </span>
          </span>
          <MiniButton>Eligible</MiniButton>
        </Row>
      ))}
    </Panel>
  );
}

const TREND = [8, 14, 12, 22, 28, 26, 38, 44, 52, 61, 70, 82];

function AnalyticsFragment() {
  const stats = [
    { label: "Leads", value: "842", delta: "12%" },
    { label: "Qualified", value: "284", delta: "18%" },
    { label: "Appointments", value: "96", delta: "14%" },
    { label: "Converted", value: "32", delta: "23%" },
  ];
  const points = TREND.map(
    (value, index) => `${(index / (TREND.length - 1)) * 100},${100 - value}`,
  ).join(" ");

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Conversion performance</PanelTitle>
        <MiniButton>Last 30 days</MiniButton>
      </PanelHead>
      <dl className="grid grid-cols-2 gap-px bg-[rgb(117_148_180/0.1)] sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[#070f18] px-3 py-2.5">
            <dt className="text-[10px] text-[var(--pub-text-muted)]">{stat.label}</dt>
            <dd className="mt-0.5 text-[17px] font-semibold leading-none text-[var(--pub-text)]">
              {stat.value}
            </dd>
            <dd className="mt-1 flex items-center gap-1 text-[9.5px] font-semibold text-[var(--pub-lime)]">
              <TrendingUp aria-hidden className="size-2.5" />
              {stat.delta}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-end gap-3 px-3.5 py-3">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-20 flex-1"
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--pub-lime)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={TREND.map(
              (value, index) => `${(index / (TREND.length - 1)) * 100},${100 - value * 0.62}`,
            ).join(" ")}
            fill="none"
            stroke="rgb(111 201 242 / 0.85)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={TREND.map(
              (value, index) => `${(index / (TREND.length - 1)) * 100},${100 - value * 0.34}`,
            ).join(" ")}
            fill="none"
            stroke="rgb(122 90 248 / 0.85)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <ul className="space-y-1.5">
          {[
            { label: "Leads", colour: "var(--pub-lime)" },
            { label: "Qualified", colour: "rgb(111 201 242)" },
            { label: "Appointments", colour: "rgb(122 90 248)" },
          ].map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-1.5 text-[9.5px] text-[var(--pub-text-secondary)]"
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: item.colour }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ============================================================= cards === */

type Capability = {
  id: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  solid?: boolean;
  title: string;
  copy: string;
  href: string;
  fragment: React.ReactNode;
};

const CAPABILITIES: Capability[] = [
  {
    id: "lead-management",
    icon: User,
    title: "Lead Management",
    copy: "Keep warm leads and their history in one operational inbox.",
    href: ANCHORS.proof,
    fragment: <InboxFragment />,
  },
  {
    id: "find-leads",
    icon: Search,
    title: "Find Leads",
    copy: "Create a verified prospect pipeline from a natural-language target.",
    href: ANCHORS.proof,
    fragment: <FindLeadsFragment />,
  },
  {
    id: "follow-up",
    icon: MessageSquareText,
    title: "Follow-Up",
    copy: "Coordinate permitted email, SMS and WhatsApp follow-up.",
    href: ANCHORS.howItWorks,
    fragment: <FollowUpFragment />,
  },
  {
    id: "qualification",
    icon: SquareCheckBig,
    solid: true,
    title: "Qualification",
    copy: "Apply your questions and rules to each enquiry.",
    href: ANCHORS.howItWorks,
    fragment: <QualificationFragment />,
  },
  {
    id: "reactivation",
    icon: RefreshCw,
    title: "Reactivation",
    copy: "Re-engage older eligible leads with suppression built in.",
    href: "/pricing",
    fragment: <ReactivationFragment />,
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Analytics",
    copy: "See acquisition, outreach and conversion performance together.",
    href: ANCHORS.proof,
    fragment: <AnalyticsFragment />,
  },
];

/* =========================================================== section === */

export function CapabilitiesSection() {
  return (
    <PublicSection
      id="capabilities"
      labelledBy="capabilities-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Glow x="left" y="middle" />
        </>
      }
    >
      <PublicContainer narrow>
        <Reveal>
        <SectionHeading
          id="capabilities-heading"
          align="centre"
          eyebrow="One connected platform"
          eyebrowPill
          title={
            <>
              One system around the <span className="pub-accent">conversion.</span>
            </>
          }
          description="Everything you need to capture, engage, qualify and convert — in a single, connected platform."
        />
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((capability, index) => (
            <Reveal key={capability.id} delay={(index % 3) * 0.06} className="h-full min-w-0">
            <article
              key={capability.id}
              className="pub-card pub-card-interactive pub-card-lit flex h-full min-w-0 flex-col p-5"
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="pub-tile"
                  data-solid={capability.solid ? "true" : undefined}
                  style={{ width: 44, height: 44, borderRadius: 12 }}
                >
                  <capability.icon className="size-5" strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <h3 className="pub-h3">{capability.title}</h3>
                  <p className="mt-1.5 min-h-[2.9em] text-[13.5px] leading-relaxed text-[var(--pub-text-secondary)]">
                    {capability.copy}
                  </p>
                  <Link
                    href={capability.href}
                    className="pub-link mt-3"
                    onClick={() => trackEngagement("capability_click", capability.id)}
                  >
                    Learn more
                    <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </div>
              </div>

              <div aria-hidden className="mt-5 min-w-0 flex-1">
                {capability.fragment}
              </div>
            </article>
            </Reveal>
          ))}
        </div>

        {/* Stated in visible copy, not a tooltip: nothing in the fragments
            above is a customer's real data or a published result. */}
        <p className="pub-small mt-8 text-center">
          Interface shown with sample data for illustration.
        </p>
      </PublicContainer>
    </PublicSection>
  );
}
