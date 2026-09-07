import * as React from "react";
import {
  BarChart3,
  Bell,
  CircleHelp,
  CreditCard,
  FileText,
  Home,
  Link2,
  MousePointerClick,
  PanelLeftClose,
  Search,
  Settings,
  TestTube,
  User,
  Users,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * The partner portal, rebuilt for the affiliate-facing surfaces.
 *
 * A partner signing in wants to see clicks, referrals and commission — not a
 * customer's lead inbox. Showing the customer workspace on the partner door
 * advertises the wrong product to the wrong person, so this frame exists
 * alongside the three workspace frames rather than being substituted for one.
 *
 * Authored at the same fixed 1040x660 design size as `app-frames.tsx`, so it
 * drops into `AppFrame` and scales identically. The rail, its order and the
 * KPI labels are taken from `lib/affiliates/nav.ts` and the real portal
 * dashboard, because a screenshot of navigation the product does not have is
 * a small lie a partner discovers on day one.
 *
 * Sample partner, sample figures. The surfaces that render it say so in
 * visible copy — a figure like "£2,840" presented plainly would be an
 * earnings claim the programme does not make.
 */

const INK = "#212936";
const INK_SOFT = "#4d5b6e";
const INK_MUTED = "#6b7a8f";
const LINE = "#e5eaf1";
const CANVAS = "#f7f9fc";
const LIME = "#b7f34a";
const LIME_DARK = "#486b12";

/** The real partner rail, in the order `lib/affiliates/nav.ts` fixes. */
const NAV = [
  { icon: Home, label: "Home" },
  { icon: Link2, label: "Links" },
  { icon: Users, label: "Referrals" },
  { icon: FileText, label: "Resources Hub" },
  { icon: BarChart3, label: "Performance" },
  { icon: CreditCard, label: "Payouts" },
  { icon: Settings, label: "Settings" },
] as const;

/** Twelve months of relative commission, rising toward the present. */
const BARS = [22, 27, 39, 34, 47, 43, 38, 55, 62, 68, 78, 100];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const REFERRALS = [
  { name: "Harper Joinery", plan: "Growth", state: "Paid", commission: "£39.80" },
  { name: "Kerr Electrical", plan: "Starter", state: "Trial", commission: "—" },
  { name: "Vale Landscapes", plan: "Pro", state: "Paid", commission: "£79.80" },
  { name: "Ridgeway Roofing", plan: "Growth", state: "Signed up", commission: "—" },
];

function Sidebar() {
  return (
    <aside
      className="flex w-[188px] shrink-0 flex-col border-r px-3 pb-4 pt-3"
      style={{ background: "#0a1017", borderColor: "rgb(255 255 255 / 0.055)" }}
    >
      <div
        className="-mx-3 mb-3 flex shrink-0 items-center justify-center px-2 pb-3"
        style={{ borderBottom: "1px solid rgb(255 255 255 / 0.07)" }}
      >
        <Logo href={null} height={68} imgClassName="h-[50px] w-auto" />
      </div>

      <div
        className="flex items-center gap-2 rounded-lg px-2 py-2"
        style={{
          background: "rgb(255 255 255 / 0.025)",
          border: "1px solid rgb(255 255 255 / 0.05)",
        }}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold"
          style={{ background: "#0c3d0e", color: LIME }}
        >
          RM
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-white">
            Rowan Mills
          </span>
          <span className="block truncate text-[9.5px]" style={{ color: "#8b98a8" }}>
            Partner &middot; Active
          </span>
        </span>
      </div>

      <nav className="mt-4 space-y-0.5">
        {NAV.map((item) => {
          const current = item.label === "Home";
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

      <div
        className="mt-auto space-y-0.5 border-t pt-3"
        style={{ borderColor: "rgb(255 255 255 / 0.07)" }}
      >
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
      <div
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5"
        style={{ borderColor: LINE, background: CANVAS }}
      >
        <Search className="size-3.5 shrink-0" style={{ color: INK_MUTED }} strokeWidth={2.1} />
        <span className="truncate text-[10.5px]" style={{ color: INK_MUTED }}>
          Search referrals, links and payouts…
        </span>
      </div>
      <span
        className="shrink-0 rounded-full border px-2.5 py-1 text-[9.5px] font-semibold"
        style={{ borderColor: LINE, color: LIME_DARK, background: "#f3ffe5" }}
      >
        20% commission
      </span>
      <Bell className="size-4 shrink-0" style={{ color: INK_MUTED }} strokeWidth={2.1} />
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
        style={{ background: "#0c3d0e", color: LIME }}
      >
        RM
      </span>
    </header>
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
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
}) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2.5" style={{ borderColor: LINE }}>
      <div className="flex items-start justify-between">
        <span className="text-[10px]" style={{ color: INK_MUTED }}>
          {label}
        </span>
        <Icon className="size-3.5" style={{ color: LIME_DARK }} strokeWidth={2.1} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="text-[20px] font-semibold tabular-nums tracking-[-0.02em]"
          style={{ color: INK }}
        >
          {value}
        </span>
        <span className="text-[9.5px] font-semibold" style={{ color: "#3f7d21" }}>
          {delta}
        </span>
      </div>
    </div>
  );
}

export function PartnerFrame() {
  const max = Math.max(...BARS);

  return (
    <>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: CANVAS }}>
        <TopBar />
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3
                className="text-[19px] font-semibold tracking-[-0.02em]"
                style={{ color: INK }}
              >
                Affiliate dashboard
              </h3>
              <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>
                Your links, referrals and commission over the last 30 days.
              </p>
            </div>
            <div
              className="flex shrink-0 items-center rounded-lg border bg-white p-0.5"
              style={{ borderColor: LINE }}
            >
              {["Last 7 days", "Last 30 days", "Last 90 days"].map((range) => (
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

          {/* The four period KPIs the real dashboard leads with. */}
          <div className="mt-3.5 grid grid-cols-4 gap-2.5">
            <Kpi label="Clicks" value="1,284" delta="+18%" icon={MousePointerClick} />
            <Kpi label="Signups" value="46" delta="+24%" icon={Users} />
            <Kpi label="Trials" value="31" delta="+12%" icon={TestTube} />
            <Kpi label="Paid customers" value="14" delta="+21%" icon={CreditCard} />
          </div>

          <div className="mt-3 grid grid-cols-[1.5fr_1fr] gap-2.5">
            <div
              className="rounded-xl border bg-white px-3.5 py-3"
              style={{ borderColor: LINE }}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="size-3.5" style={{ color: LIME_DARK }} strokeWidth={2.2} />
                <span className="flex-1">
                  <span className="block text-[12px] font-semibold" style={{ color: INK }}>
                    Commission earned
                  </span>
                  <span className="block text-[9.5px]" style={{ color: INK_MUTED }}>
                    Approved commission, by month.
                  </span>
                </span>
                <span
                  className="rounded-md border px-2 py-1 text-[9.5px] font-medium"
                  style={{ borderColor: LINE, color: INK_SOFT }}
                >
                  This year
                </span>
              </div>

              <div className="mt-3 flex h-[132px] items-end gap-1.5">
                {BARS.map((value, index) => (
                  <span key={MONTHS[index]} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className="w-full rounded-t-[3px]"
                      style={{
                        height: `${(value / max) * 108}px`,
                        background: index === BARS.length - 1 ? LIME : "rgb(183 243 74 / 0.42)",
                      }}
                    />
                    <span className="text-[8px]" style={{ color: INK_MUTED }}>
                      {MONTHS[index]}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div
              className="rounded-xl border bg-white px-3.5 py-3"
              style={{ borderColor: LINE }}
            >
              <span className="block text-[12px] font-semibold" style={{ color: INK }}>
                Commission summary
              </span>
              <div className="mt-3 space-y-2">
                {[
                  ["Pending", "£312.40"],
                  ["Approved", "£1,845.60"],
                  ["Paid out", "£682.00"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-baseline justify-between border-b pb-2 last:border-0 last:pb-0"
                    style={{ borderColor: LINE }}
                  >
                    <span className="text-[10.5px]" style={{ color: INK_MUTED }}>
                      {label}
                    </span>
                    <span
                      className="text-[12px] font-semibold tabular-nums"
                      style={{ color: INK }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="mt-3 rounded-lg px-2.5 py-2"
                style={{ background: "#f3ffe5" }}
              >
                <span className="block text-[9.5px]" style={{ color: LIME_DARK }}>
                  Next payout
                </span>
                <span
                  className="mt-0.5 block text-[15px] font-semibold tabular-nums"
                  style={{ color: LIME_DARK }}
                >
                  £1,845.60
                </span>
              </div>
            </div>
          </div>

          <div
            className="mt-3 rounded-xl border bg-white px-3.5 py-3"
            style={{ borderColor: LINE }}
          >
            <span className="block text-[12px] font-semibold" style={{ color: INK }}>
              Recent referrals
            </span>
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr>
                  {["Business", "Plan", "State", "Commission"].map((head, index) => (
                    <th
                      key={head}
                      className="pb-1.5 text-[9.5px] font-semibold"
                      style={{
                        color: INK_MUTED,
                        textAlign: index === 0 ? "left" : index === 3 ? "right" : "left",
                      }}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {REFERRALS.map((row) => (
                  <tr key={row.name}>
                    <td
                      className="border-t py-1.5 text-[10.5px] font-medium"
                      style={{ borderColor: LINE, color: INK }}
                    >
                      {row.name}
                    </td>
                    <td
                      className="border-t py-1.5 text-[10px]"
                      style={{ borderColor: LINE, color: INK_SOFT }}
                    >
                      {row.plan}
                    </td>
                    <td className="border-t py-1.5" style={{ borderColor: LINE }}>
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                        style={
                          row.state === "Paid"
                            ? { background: "#e7f5da", color: "#3f6b10" }
                            : row.state === "Trial"
                              ? { background: "#fdf1dc", color: "#8a5a12" }
                              : { background: "#eef1f6", color: INK_SOFT }
                        }
                      >
                        {row.state}
                      </span>
                    </td>
                    <td
                      className="border-t py-1.5 text-right text-[10.5px] font-semibold tabular-nums"
                      style={{ borderColor: LINE, color: INK }}
                    >
                      {row.commission}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
