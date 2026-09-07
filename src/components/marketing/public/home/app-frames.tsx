import * as React from "react";
import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  Coins,
  CreditCard,
  Handshake,
  LifeBuoy,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Filter,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  PanelLeftClose,
  Phone,
  Radar,
  Repeat,
  ServerCog,
  Search,
  Settings,
  Sparkles,
  SquareCheckBig,
  TrendingUp,
  Triangle,
  User,
  Users,
  Workflow,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * Faithful rebuilds of three ClientTurn workspace screens, for the product
 * showcase.
 *
 * The repository ships no product screenshots, so these are the interface
 * rebuilt in markup rather than captured. That is deliberate: a rebuild stays
 * correct when a token changes, weighs a few kilobytes instead of a few
 * hundred, and cannot become a stale image of an old release.
 *
 * Every frame is authored at a fixed 1040x660 design size and scaled as a
 * single unit by `AppFrame` (see `.pub-shot-*` in `clientturn.css`) — so the
 * internals below can be written in plain design pixels and still fit any
 * column width exactly.
 *
 * The workspace, the figures and the names are sample data. The showcase
 * section says so in visible copy; nothing here is a customer or a result.
 */

/* The workspace app is a light surface. It sits inside the dark public site,
   so its palette is written out here rather than inherited. */
const INK = "#212936";
const INK_SOFT = "#4d5b6e";
const INK_MUTED = "#6b7a8f";
const LINE = "#e5eaf1";
const CANVAS = "#f7f9fc";
const LIME = "#b7f34a";
const LIME_DARK = "#486b12";

export function AppFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="pub-shot relative overflow-hidden rounded-[18px] border border-[var(--pub-lime-border)] bg-[#050b12] shadow-[0_40px_90px_-40px_rgb(0_0_0/0.9),0_0_70px_-24px_rgb(183_243_74/0.42)]"
    >
      <div className="pub-shot-aspect">
        <div aria-hidden className="pub-shot-scaler flex overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sidebar --- */

/* The real primary rail, in the order `lib/app/nav.ts` fixes. Kept in step
   with it deliberately: a marketing screenshot of a nav the product does not
   have is a small lie that a visitor discovers on day one. */
const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Bot, label: "Agents" },
  { icon: Inbox, label: "Inbox" },
  { icon: Users, label: "Leads" },
  { icon: Radar, label: "Find Leads" },
  { icon: Workflow, label: "Follow-Up" },
  { icon: Repeat, label: "Reactivation" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Settings, label: "Settings" },
] as const;

type RailItem = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
};

function Sidebar({
  active,
  items = NAV,
  workspace,
}: {
  active: string;
  items?: readonly RailItem[];
  workspace?: { name: string; meta: string };
}) {
  return (
    <aside
      className="flex w-[188px] shrink-0 flex-col border-r px-3 pb-4 pt-3"
      style={{ background: "#0a1017", borderColor: "rgb(255 255 255 / 0.055)" }}
    >
      {/* The real rail centres the lockup in a fixed-height header under a
          divider (`--ct-rail-logo-h`, 68px on a 256px rail). Scaled to this
          188px rail that is a 50px mark. */}
      <div
        className="-mx-3 mb-3 flex shrink-0 items-center justify-center px-2 pb-3"
        style={{ borderBottom: "1px solid rgb(255 255 255 / 0.07)" }}
      >
        <Logo href={null} height={68} imgClassName="h-[50px] w-auto" />
      </div>

      <div
        className="flex items-center gap-2 rounded-lg px-2 py-2"
        style={{ background: "rgb(255 255 255 / 0.025)", border: "1px solid rgb(255 255 255 / 0.05)" }}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md"
          style={{ background: "#0c3d0e" }}
        >
          <Building2 className="size-3.5" style={{ color: LIME }} strokeWidth={2.1} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[10.5px] font-semibold leading-tight text-[#cdd4de]">
            {workspace?.name ?? "Northgate Roofing"}
          </span>
          <span className="block truncate text-[9px] leading-tight text-[#8794a5]">
            {workspace?.meta ?? "& Exteriors · Pro"}
          </span>
        </span>
      </div>

      <nav className="mt-4 space-y-0.5">
        {items.map((item) => {
          const current = item.label === active;
          return (
            <span
              key={item.label}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
              style={
                current
                  ? { background: "rgb(183 243 74 / 0.1)", color: LIME, fontWeight: 600 }
                  : { color: "#abb6c5" }
              }
            >
              <item.icon className="size-3.5 shrink-0" strokeWidth={2.1} />
              {item.label}
            </span>
          );
        })}
      </nav>

      <div className="mt-auto space-y-0.5 border-t pt-3" style={{ borderColor: "rgb(255 255 255 / 0.07)" }}>
        {[
          { icon: CircleHelp, label: "Help" },
          { icon: User, label: "Profile" },
          { icon: PanelLeftClose, label: "Collapse" },
        ].map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11.5px]"
            style={{ color: "#abb6c5" }}
          >
            <item.icon className="size-3.5 shrink-0" strokeWidth={2.1} />
            {item.label}
          </span>
        ))}
      </div>
    </aside>
  );
}

function TopBar() {
  return (
    <header
      className="flex items-center gap-3 border-b px-5 py-2.5"
      style={{ borderColor: LINE, background: "#fff" }}
    >
      <span
        className="flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5"
        style={{ borderColor: LINE, background: CANVAS }}
      >
        <Search className="size-3.5 shrink-0" style={{ color: INK_MUTED }} />
        <span className="flex-1 text-[11px]" style={{ color: INK_MUTED }}>
          Search leads, bookings, campaigns…
        </span>
        <span className="text-[10px]" style={{ color: INK_MUTED }}>
          &#8984;K
        </span>
      </span>
      <span
        className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px]"
        style={{ borderColor: LINE, color: INK_SOFT }}
      >
        <span className="size-1.5 rounded-full" style={{ background: "#9aa7b8" }} />
        Not connected
      </span>
      <span className="relative">
        <Bell className="size-4" style={{ color: INK_SOFT }} strokeWidth={2} />
        <span
          className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
          style={{ background: "#f04438" }}
        />
      </span>
      <span className="flex items-center gap-1">
        {/* The signed-in user, not a lead — deliberately not "JT", which is
            James Taylor in the lead rows below. */}
        <span
          className="grid size-6 place-items-center rounded-full text-[9px] font-semibold text-white"
          style={{ background: "#6938ef" }}
        >
          AM
        </span>
        <ChevronDown className="size-3" style={{ color: INK_MUTED }} />
      </span>
    </header>
  );
}

/* ------------------------------------------------------- dashboard --- */

function StatusCell({
  ok,
  title,
  detail,
  action,
  last,
}: {
  ok?: boolean;
  title: string;
  detail: string;
  action: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-1 items-center gap-2 px-3 py-2.5"
      style={{ borderRight: last ? undefined : `1px solid ${LINE}` }}
    >
      {ok ? (
        <CircleCheck className="size-4 shrink-0" style={{ color: "#039855" }} strokeWidth={2} />
      ) : (
        <CircleAlert className="size-4 shrink-0" style={{ color: "#d92d20" }} strokeWidth={2} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10.5px] font-semibold" style={{ color: INK }}>
          {title}
        </span>
        <span className="block truncate text-[9.5px]" style={{ color: INK_MUTED }}>
          {detail}
        </span>
      </span>
      <span
        className="shrink-0 rounded-md border px-2 py-1 text-[9.5px] font-medium"
        style={{ borderColor: LINE, color: INK_SOFT }}
      >
        {action}
      </span>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
}) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: LINE }}>
      <div className="flex items-start justify-between">
        <span className="text-[10px]" style={{ color: INK_MUTED }}>
          {label}
        </span>
        <span
          className="grid size-6 place-items-center rounded-md"
          style={{ background: "#f3ffe5" }}
        >
          <Icon className="size-3" style={{ color: LIME_DARK }} strokeWidth={2.2} />
        </span>
      </div>
      <p className="mt-1 text-[21px] font-semibold leading-none" style={{ color: INK }}>
        {value}
      </p>
      <p className="mt-1.5 flex items-center gap-1 text-[9px]" style={{ color: "#027a48" }}>
        <TrendingUp className="size-2.5" />
        <span className="font-semibold">{delta}</span>
        <span style={{ color: INK_MUTED }}>vs. previous 30 days</span>
      </p>
    </div>
  );
}

const ATTENTION = [
  {
    title: "Lead requested a person",
    detail: "A lead has asked to speak with a person.",
    count: "1",
    tone: "#f04438",
  },
  {
    title: "Meta connection not connected",
    detail: "New leads from your forms are not arriving.",
    count: "1",
    tone: "#dc6803",
  },
];

const RECENT = [
  { initials: "JT", name: "James Taylor", source: "Website enquiry", status: "Qualified" },
  { initials: "SS", name: "Sophie Smith", source: "Referral", status: "Contacted" },
  { initials: "MD", name: "Michael Davies", source: "Manual entry", status: "New" },
];

const BOOKINGS = [
  { name: "James Taylor", service: "Roof survey", when: "Mon 10:00" },
  { name: "Harriet Wilson", service: "Measure-up", when: "Tue 14:30" },
  { name: "Daniel Moore", service: "Site visit", when: "Wed 09:15" },
];

const FUNNEL = [
  { label: "Leads", pct: 100, value: 24 },
  { label: "Contacted", pct: 92, value: 22 },
  { label: "Responded", pct: 77, value: 17 },
  { label: "Qualified", pct: 53, value: 9 },
  { label: "Booked", pct: 78, value: 7 },
  { label: "Won", pct: 71, value: 5 },
];

export function DashboardFrame() {
  return (
    <>
      <Sidebar active="Dashboard" />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: CANVAS }}>
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[19px] font-semibold tracking-[-0.02em]" style={{ color: INK }}>
                Good afternoon, Northgate Roofing &amp; Exteriors
              </h3>
              <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>
                Here is what happened over the last 30 days.
              </p>
            </div>
            <div
              className="flex shrink-0 items-center rounded-lg border bg-white p-0.5"
              style={{ borderColor: LINE }}
            >
              {["Last 7 days", "Last 30 days", "Last 90 days", "Custom"].map((range) => (
                <span
                  key={range}
                  className="rounded-md px-2.5 py-1.5 text-[10px] font-medium"
                  style={
                    range === "Last 30 days"
                      ? { background: "#f3ffe5", color: LIME_DARK, fontWeight: 600 }
                      : { color: INK_SOFT }
                  }
                >
                  {range}
                </span>
              ))}
            </div>
          </div>

          <div
            className="mt-3.5 flex overflow-hidden rounded-xl border bg-white"
            style={{ borderColor: LINE }}
          >
            <StatusCell title="Meta connection" detail="Not connected" action="Connect" />
            <StatusCell title="Messaging" detail="Not connected" action="Connect" />
            <StatusCell
              ok
              title="Booking destination"
              detail="Human handover — qualified leads flagged"
              action="Configure"
            />
            <StatusCell ok last title="Follow-up" detail="Published and running" action="View" />
          </div>

          {/* Seven cards, matching the real rail: the six period KPIs plus
              Estimated Pipeline, which the product also renders as a KPI. */}
          <div className="mt-3 grid grid-cols-7 gap-2">
            <Kpi label="New Leads" value="24" delta="+50%" icon={Users} />
            <Kpi label="Contacted" value="22" delta="+69%" icon={Phone} />
            <Kpi label="Replies" value="17" delta="+55%" icon={MessageSquareText} />
            <Kpi label="Qualified" value="9" delta="+13%" icon={SquareCheckBig} />
            <Kpi label="Bookings" value="7" delta="+75%" icon={CalendarDays} />
            <Kpi label="Booking Rate" value="29%" delta="+17%" icon={BarChart3} />
            <Kpi label="Est. Pipeline" value="34.5k" delta="+21%" icon={TrendingUp} />
          </div>

          <div className="mt-3 grid grid-cols-[1.55fr_1fr] gap-2.5">
            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <div className="flex items-center gap-2">
                <BarChart3 className="size-3.5" style={{ color: LIME_DARK }} strokeWidth={2.2} />
                <span className="flex-1">
                  <span className="block text-[12px] font-semibold" style={{ color: INK }}>
                    Conversion funnel
                  </span>
                  <span className="block text-[9.5px]" style={{ color: INK_MUTED }}>
                    Every stage links to the matching lead list.
                  </span>
                </span>
                <span
                  className="rounded-md border px-2 py-1 text-[9.5px] font-medium"
                  style={{ borderColor: LINE, color: INK_SOFT }}
                >
                  View all leads
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {FUNNEL.map((stage) => (
                  <div key={stage.label}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] font-medium" style={{ color: INK }}>
                        {stage.label}
                      </span>
                      <span
                        className="flex items-center gap-2 text-[9.5px]"
                        style={{ color: INK_MUTED }}
                      >
                        <span>{stage.pct}%</span>
                        <span className="font-semibold" style={{ color: INK }}>
                          {stage.value}
                        </span>
                        <ChevronRight className="size-3" />
                      </span>
                    </div>
                    <span
                      className="mt-1 block h-1.5 rounded-full"
                      style={{ background: "#eef2f7" }}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: stage.pct + "%", background: LIME }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <div className="flex items-center gap-2">
                <Triangle className="size-3.5" style={{ color: "#dc6803" }} strokeWidth={2.4} />
                <span className="flex-1 text-[12px] font-semibold" style={{ color: INK }}>
                  Needs attention
                </span>
                <span className="text-[10px] font-medium" style={{ color: LIME_DARK }}>
                  View all
                </span>
              </div>
              {ATTENTION.map((item) => (
                <div
                  key={item.title}
                  className="mt-2 flex items-center gap-2 border-t pt-2"
                  style={{ borderColor: LINE }}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: item.tone }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[10.5px] font-semibold"
                      style={{ color: INK }}
                    >
                      {item.title}
                    </span>
                    <span className="block truncate text-[9.5px]" style={{ color: INK_MUTED }}>
                      {item.detail}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold" style={{ color: INK }}>
                    {item.count}
                  </span>
                  <ChevronRight className="size-3" style={{ color: INK_MUTED }} />
                </div>
              ))}
            </div>
          </div>

          {/* The next row of the real dashboard. It runs past the bottom of
              the frame, the way a screenshot of a scrolling page would. */}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <span className="text-[12px] font-semibold" style={{ color: INK }}>
                Recent leads
              </span>
              <div className="mt-2 space-y-2">
                {RECENT.map((lead) => (
                  <div key={lead.name} className="flex items-center gap-2">
                    <span
                      className="grid size-6 place-items-center rounded-full text-[8.5px] font-semibold"
                      style={{ background: "#eef2f7", color: INK_SOFT }}
                    >
                      {lead.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[10.5px] font-semibold"
                        style={{ color: INK }}
                      >
                        {lead.name}
                      </span>
                      <span className="block truncate text-[9.5px]" style={{ color: INK_MUTED }}>
                        {lead.source}
                      </span>
                    </span>
                    <span
                      className="rounded-md px-2 py-0.5 text-[9px] font-semibold"
                      style={{ background: "#f3ffe5", color: LIME_DARK }}
                    >
                      {lead.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <span className="text-[12px] font-semibold" style={{ color: INK }}>
                Upcoming bookings
              </span>
              <div className="mt-2 space-y-2">
                {BOOKINGS.map((booking) => (
                  <div key={booking.name} className="flex items-center gap-2">
                    <span
                      className="grid size-6 place-items-center rounded-md"
                      style={{ background: "#f3ffe5" }}
                    >
                      <CalendarDays className="size-3" style={{ color: LIME_DARK }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[10.5px] font-semibold"
                        style={{ color: INK }}
                      >
                        {booking.name}
                      </span>
                      <span className="block truncate text-[9.5px]" style={{ color: INK_MUTED }}>
                        {booking.service}
                      </span>
                    </span>
                    <span className="shrink-0 text-[9.5px]" style={{ color: INK_MUTED }}>
                      {booking.when}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}


/* ------------------------------------------------------------- admin --- */

/**
 * The operator console, for the admin door.
 *
 * The rail mirrors `lib/admin/nav.ts` exactly — an operator recognises the
 * product they are about to sign into, and a marketing screenshot of a nav the
 * tool does not have is the sort of small lie that gets noticed on day one.
 * The figures are illustrative, like every other frame here.
 */
const ADMIN_NAV = [
  { icon: LayoutDashboard, label: "Overview" },
  { icon: Building2, label: "Customers" },
  { icon: LifeBuoy, label: "Support" },
  { icon: Handshake, label: "Affiliates" },
  { icon: ServerCog, label: "System" },
  { icon: CreditCard, label: "Billing" },
  { icon: Coins, label: "Usage & Margins" },
  { icon: Settings, label: "Settings" },
] as const;

const ADMIN_WORKSPACES = [
  { name: "Northgate Roofing", plan: "Pro", state: "Active", leads: "1,284" },
  { name: "Harper Kitchens", plan: "Growth", state: "Active", leads: "412" },
  { name: "Vale Landscapes", plan: "Starter", state: "Trial", leads: "96" },
  { name: "Bellway Plumbing", plan: "Growth", state: "Active", leads: "338" },
];

const ADMIN_HEALTH = [
  { label: "Worker queue", detail: "No backlog", ok: true },
  { label: "Webhook ingest", detail: "All providers acknowledging", ok: true },
  { label: "Message delivery", detail: "2 retries in the last hour", ok: false },
];

export function AdminFrame() {
  return (
    <>
      <Sidebar
        active="Overview"
        items={ADMIN_NAV}
        workspace={{ name: "Platform", meta: "Operations console" }}
      />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: CANVAS }}>
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[19px] font-semibold tracking-[-0.02em]" style={{ color: INK }}>
                Platform overview
              </h3>
              <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>
                Every workspace, subscription and background job in one place.
              </p>
            </div>
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-[10px] font-medium"
              style={{ borderColor: LINE, color: INK_SOFT }}
            >
              Last 30 days
              <ChevronDown className="size-3" />
            </span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2.5">
            <Kpi label="Workspaces" value="128" delta="+9%" icon={Building2} />
            <Kpi label="Active Trials" value="24" delta="+14%" icon={Users} />
            <Kpi label="Paying" value="96" delta="+6%" icon={CreditCard} />
            <Kpi label="Jobs / hour" value="4,210" delta="+3%" icon={ServerCog} />
          </div>

          <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-2.5">
            <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: LINE }}>
              <div
                className="flex items-center gap-2 border-b px-3.5 py-2.5"
                style={{ borderColor: LINE }}
              >
                <span className="flex-1 text-[12px] font-semibold" style={{ color: INK }}>
                  Recent workspaces
                </span>
                <span
                  className="rounded-md border px-2 py-1 text-[9.5px] font-medium"
                  style={{ borderColor: LINE, color: INK_SOFT }}
                >
                  View all
                </span>
              </div>
              {ADMIN_WORKSPACES.map((row, index) => (
                <div
                  key={row.name}
                  className="flex items-center gap-2.5 px-3.5 py-2.5"
                  style={{
                    borderBottom:
                      index === ADMIN_WORKSPACES.length - 1 ? undefined : `1px solid ${LINE}`,
                  }}
                >
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md"
                    style={{ background: "#f3ffe5" }}
                  >
                    <Building2 className="size-3.5" style={{ color: LIME_DARK }} strokeWidth={2.1} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[11.5px] font-semibold"
                      style={{ color: INK }}
                    >
                      {row.name}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: INK_MUTED }}>
                      {row.plan} &middot; {row.leads} leads
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-semibold"
                    style={
                      row.state === "Trial"
                        ? { background: "#fffaeb", color: "#b54708" }
                        : { background: "#f3ffe5", color: LIME_DARK }
                    }
                  >
                    {row.state}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <span className="text-[12px] font-semibold" style={{ color: INK }}>
                System health
              </span>
              <div className="mt-2.5 space-y-2.5">
                {ADMIN_HEALTH.map((row) => (
                  <div key={row.label} className="flex items-start gap-2">
                    {row.ok ? (
                      <CircleCheck
                        className="mt-0.5 size-3.5 shrink-0"
                        style={{ color: "#039855" }}
                        strokeWidth={2}
                      />
                    ) : (
                      <Triangle
                        className="mt-0.5 size-3.5 shrink-0"
                        style={{ color: "#dc6803" }}
                        strokeWidth={2.4}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold" style={{ color: INK }}>
                        {row.label}
                      </span>
                      <span className="block text-[10px]" style={{ color: INK_MUTED }}>
                        {row.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p
                className="mt-3 rounded-lg px-2.5 py-2 text-[9.5px] leading-relaxed"
                style={{ background: "#f3ffe5", color: LIME_DARK }}
              >
                Platform role is checked against the database on every request.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------ acquisition --- */

const PROSPECTS = [
  { name: "Riverside Homes", meta: "Residential developer · Manchester", score: 92 },
  { name: "Oakwood Developments", meta: "Property developer · Manchester", score: 88 },
  { name: "Centurion Living", meta: "Residential developer · Stockport", score: 84 },
  { name: "Halewood Estates", meta: "Property developer · Salford", score: 79 },
  { name: "Brookfield Residential", meta: "Residential developer · Bolton", score: 74 },
];

export function AcquisitionFrame() {
  return (
    <>
      <Sidebar active="Find Leads" />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: CANVAS }}>
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <h3 className="text-[19px] font-semibold tracking-[-0.02em]" style={{ color: INK }}>
            Find Leads
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>
            Describe who you want to reach. ClientTurn builds the search plan and verifies
            every contact before it reaches your review queue.
          </p>

          <div className="mt-3.5 rounded-xl border bg-white p-3.5" style={{ borderColor: LINE }}>
            <div className="flex items-center gap-2">
              <span
                className="flex flex-1 items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: LINE, background: CANVAS }}
              >
                <Sparkles className="size-3.5 shrink-0" style={{ color: LIME_DARK }} />
                <span className="text-[11.5px]" style={{ color: INK }}>
                  Residential developers in Manchester with 10&ndash;200 staff
                </span>
              </span>
              <span
                className="shrink-0 rounded-lg px-3.5 py-2 text-[11px] font-semibold"
                style={{ background: LIME, color: "#0a1206" }}
              >
                Search
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {["Construction", "Residential", "Manchester", "10–200 staff"].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border px-2.5 py-1 text-[10px]"
                  style={{ borderColor: LINE, color: INK_SOFT, background: "#fff" }}
                >
                  {chip} &times;
                </span>
              ))}
              <span
                className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[10px]"
                style={{ borderColor: "#d3dae5", color: INK_MUTED }}
              >
                <Filter className="size-2.5" /> Add filter
              </span>
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-3 gap-2.5">
            {[
              { label: "Search plan", value: "4 steps", detail: "Sources, filters, enrichment, verification" },
              { label: "Prospects found", value: "248", detail: "Deduplicated against your workspace" },
              { label: "Verified contacts", value: "191", detail: "Email, phone and role confirmed" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: LINE }}>
                <p className="text-[10px]" style={{ color: INK_MUTED }}>
                  {stat.label}
                </p>
                <p className="mt-1 text-[19px] font-semibold leading-none" style={{ color: INK }}>
                  {stat.value}
                </p>
                <p className="mt-1.5 text-[9.5px]" style={{ color: INK_MUTED }}>
                  {stat.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3.5 overflow-hidden rounded-xl border bg-white" style={{ borderColor: LINE }}>
            <div
              className="flex items-center gap-2 border-b px-3.5 py-2.5"
              style={{ borderColor: LINE }}
            >
              <span className="flex-1 text-[12px] font-semibold" style={{ color: INK }}>
                Verified prospects
              </span>
              <span
                className="rounded-md border px-2 py-1 text-[9.5px] font-medium"
                style={{ borderColor: LINE, color: INK_SOFT }}
              >
                Export
              </span>
              <span
                className="rounded-md px-2.5 py-1 text-[9.5px] font-semibold"
                style={{ background: LIME, color: "#0a1206" }}
              >
                Add to campaign
              </span>
            </div>
            {PROSPECTS.map((prospect, index) => (
              <div
                key={prospect.name}
                className="flex items-center gap-2.5 px-3.5 py-2.5"
                style={{ borderBottom: index === PROSPECTS.length - 1 ? undefined : `1px solid ${LINE}` }}
              >
                <span
                  className="size-3.5 shrink-0 rounded border"
                  style={{ borderColor: "#d3dae5" }}
                />
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-md"
                  style={{ background: "#f3ffe5" }}
                >
                  <Building2 className="size-3.5" style={{ color: LIME_DARK }} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-semibold" style={{ color: INK }}>
                    {prospect.name}
                  </span>
                  <span className="block truncate text-[10px]" style={{ color: INK_MUTED }}>
                    {prospect.meta}
                  </span>
                </span>
                <span className="w-24 shrink-0">
                  <span className="block h-1.5 rounded-full" style={{ background: "#eef2f7" }}>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${prospect.score}%`, background: LIME }}
                    />
                  </span>
                </span>
                <span className="w-6 shrink-0 text-right text-[10.5px] font-semibold" style={{ color: INK }}>
                  {prospect.score}
                </span>
                <span
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[9.5px] font-semibold"
                  style={{ background: "#f3ffe5", color: LIME_DARK }}
                >
                  <Check className="size-2.5" strokeWidth={3} />
                  Verified
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------- analytics --- */

const SERIES = [12, 18, 16, 26, 32, 30, 41, 47, 55, 63, 72, 84];
const SOURCES = [
  { label: "Website form", value: 82 },
  { label: "Referrals", value: 61 },
  { label: "Paid campaigns", value: 44 },
  { label: "Outbound prospecting", value: 33 },
  { label: "Manual entry", value: 18 },
];

export function AnalyticsFrame() {
  const line = (scale: number) =>
    SERIES.map((value, index) => `${(index / (SERIES.length - 1)) * 100},${100 - value * scale}`).join(" ");

  return (
    <>
      <Sidebar active="Analytics" />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: CANVAS }}>
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[19px] font-semibold tracking-[-0.02em]" style={{ color: INK }}>
                Analytics
              </h3>
              <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>
                Acquisition, outreach and conversion performance in one view.
              </p>
            </div>
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-[10px] font-medium"
              style={{ borderColor: LINE, color: INK_SOFT }}
            >
              Last 90 days
              <ChevronDown className="size-3" />
            </span>
          </div>

          <div className="mt-3.5 grid grid-cols-4 gap-2.5">
            <Kpi label="Leads" value="842" delta="+12%" icon={Users} />
            <Kpi label="Qualified" value="284" delta="+18%" icon={SquareCheckBig} />
            <Kpi label="Appointments" value="96" delta="+14%" icon={CalendarDays} />
            <Kpi label="Converted" value="32" delta="+23%" icon={TrendingUp} />
          </div>

          <div className="mt-3.5 grid grid-cols-[1.5fr_1fr] gap-2.5">
            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold" style={{ color: INK }}>
                  Conversion performance
                </span>
                <span className="flex items-center gap-3">
                  {[
                    { label: "Leads", colour: LIME },
                    { label: "Qualified", colour: "#0ba5ec" },
                    { label: "Converted", colour: "#7a5af8" },
                  ].map((item) => (
                    <span
                      key={item.label}
                      className="flex items-center gap-1 text-[9.5px]"
                      style={{ color: INK_MUTED }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: item.colour }}
                      />
                      {item.label}
                    </span>
                  ))}
                </span>
              </div>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="mt-3 h-[186px] w-full"
              >
                {[0, 25, 50, 75, 100].map((y) => (
                  <line
                    key={y}
                    x1={0}
                    x2={100}
                    y1={y}
                    y2={y}
                    stroke="#eef2f7"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <polyline points={line(1)} fill="none" stroke={LIME} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <polyline points={line(0.62)} fill="none" stroke="#0ba5ec" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
                <polyline points={line(0.3)} fill="none" stroke="#7a5af8" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="mt-1 flex justify-between text-[9px]" style={{ color: INK_MUTED }}>
                {["1 Sep", "15 Sep", "1 Oct", "15 Oct", "1 Nov", "15 Nov"].map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-white px-3.5 py-3" style={{ borderColor: LINE }}>
              <span className="text-[12px] font-semibold" style={{ color: INK }}>
                Lead source performance
              </span>
              <dl className="mt-3 space-y-2.5">
                {SOURCES.map((source) => (
                  <div key={source.label}>
                    <div className="flex items-baseline justify-between">
                      <dt className="text-[10px]" style={{ color: INK_SOFT }}>
                        {source.label}
                      </dt>
                      <dd className="text-[10px] font-semibold" style={{ color: INK }}>
                        {source.value}
                      </dd>
                    </div>
                    <span className="mt-1 block h-1.5 rounded-full" style={{ background: "#eef2f7" }}>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${source.value}%`, background: LIME }}
                      />
                    </span>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
