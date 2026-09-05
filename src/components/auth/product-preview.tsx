import {
  LayoutGrid,
  Users2,
  Repeat2,
  CalendarClock,
  Settings2,
  Search,
  Lock,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

const FRAME_STYLE = {
  background: "linear-gradient(165deg, #0a1420 0%, #071018 55%, #050c14 100%)",
  border: "1px solid rgba(168,255,31,0.26)",
  boxShadow:
    "0 60px 120px rgba(0,0,0,0.6), 0 0 60px rgba(168,255,31,0.14), inset 0 1px 0 rgba(255,255,255,0.07)",
};

/** Thin gloss line + faint diagonal glass sheen shared by every preview
 * frame, so the "product visual" reads as one glassy material system. */
function FrameGloss() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(168,255,31,0.6) 30%, rgba(255,255,255,0.75) 50%, rgba(168,255,31,0.6) 70%, transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 opacity-[0.05]"
        style={{
          background: "linear-gradient(115deg, transparent 40%, #ffffff 50%, transparent 60%)",
        }}
      />
    </>
  );
}

const NAV_ITEMS = [
  { icon: LayoutGrid, label: "Dashboard", active: true },
  { icon: Users2, label: "Leads" },
  { icon: Repeat2, label: "Follow-Up" },
  { icon: CalendarClock, label: "Reactivation" },
  { icon: Settings2, label: "Settings" },
];

export type PreviewKpi = { label: string; value: string; delta: string };
export type PreviewBar = { label: string; value: string; height: number };
export type PreviewRow = { initials: string; name: string; detail: string; time: string };

/** DOM/CSS miniature of the ClientTurn dashboard — decorative only, with
 * clearly generic demo values (never a claimed customer outcome). */
export function DashboardPreview({
  title,
  subtitle,
  kpis,
  chartTitle,
  chartChip,
  bars,
  showBarValues,
  listTitle,
  rows,
  className,
}: {
  title: string;
  subtitle: string;
  kpis: PreviewKpi[];
  chartTitle: string;
  chartChip?: string;
  bars: PreviewBar[];
  showBarValues?: boolean;
  listTitle: string;
  rows: PreviewRow[];
  className?: string;
}) {
  return (
    <div
      className={`relative w-[520px] max-w-full overflow-hidden rounded-[20px] ${className ?? ""}`}
      style={FRAME_STYLE}
    >
      <FrameGloss />
      <div className="relative flex">
        <nav className="flex w-[132px] shrink-0 flex-col gap-1 border-r border-white/8 px-3 py-4">
          <div className="mb-4 flex items-center gap-2 px-1">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-[var(--auth-lime)] text-[12px] font-black text-[#071009]">
              C
            </span>
            <span className="text-[14px] font-bold tracking-tight text-white">
              Client<span className="text-[var(--auth-lime)]">Turn</span>
            </span>
          </div>
          {NAV_ITEMS.map(({ icon: Icon, label, active }) => (
            <span
              key={label}
              className={`flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-[11.5px] font-medium ${
                active
                  ? "bg-[rgba(168,255,31,0.13)] text-[var(--auth-lime)] shadow-[inset_0_0_0_1px_rgba(168,255,31,0.22)]"
                  : "text-white/45"
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </span>
          ))}
        </nav>

        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3.5 flex items-center gap-2 rounded-[9px] border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] text-white/35">
            <Search className="size-3.5" aria-hidden />
            Search leads, bookings, campaigns…
          </div>

          <p className="text-[15px] font-bold text-white">{title}</p>
          <p className="mt-0.5 text-[10.5px] text-white/45">{subtitle}</p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {kpis.map((kpi, i) => (
              <div
                key={kpi.label}
                className="relative rounded-[10px] border border-white/8 bg-white/[0.035] px-2.5 py-2.5"
              >
                {i === 0 && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 size-1.5 rounded-full bg-[var(--auth-lime)] shadow-[0_0_7px_rgba(168,255,31,0.9)]"
                  />
                )}
                <p className="text-[19px] leading-none font-bold text-white">{kpi.value}</p>
                <p className="mt-1.5 text-[9.5px] text-white/45">{kpi.label}</p>
                <p className="mt-0.5 flex items-center gap-0.5 text-[9.5px] font-semibold text-[var(--auth-lime)]">
                  <TrendingUp className="size-2.5" aria-hidden />
                  {kpi.delta}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-[10px] border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-semibold text-white">{chartTitle}</p>
              {chartChip && (
                <span className="flex items-center gap-1 rounded-[6px] border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/55">
                  {chartChip}
                  <ChevronDown className="size-2.5" aria-hidden />
                </span>
              )}
            </div>
            <div className="mt-2.5 flex h-[70px] items-end gap-2">
              {bars.map((bar, i) => (
                <div key={bar.label} className="flex h-full flex-1 flex-col justify-end gap-1">
                  {showBarValues && (
                    <span className="text-center text-[9px] font-semibold text-white/70">
                      {bar.value}
                    </span>
                  )}
                  <span
                    className="relative w-full overflow-hidden rounded-t-[4px]"
                    style={{
                      height: `${bar.height}%`,
                      background: "linear-gradient(180deg, #c8ff70, var(--auth-lime) 40%, #6fc914)",
                    }}
                  >
                    {i === 0 && (
                      <span
                        aria-hidden
                        className="ct-auth-shimmer absolute inset-y-0 left-0 w-1/3"
                        style={{
                          background:
                            "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                        }}
                      />
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-2">
              {bars.map((bar) => (
                <span key={bar.label} className="flex-1 text-center text-[8.5px] text-white/35">
                  {bar.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-[10px] border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-semibold text-white">{listTitle}</p>
              <span className="flex items-center gap-1 text-[9.5px] text-white/40">
                View all
                <ArrowRight className="size-2.5" aria-hidden />
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {rows.map((row) => (
                <div key={row.name} className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[8.5px] font-semibold text-white/80">
                    {row.initials}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-white/80">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[9.5px] text-white/40">{row.detail}</span>
                  <span className="shrink-0 text-[9px] text-white/25">{row.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STACK_CARDS = [
  { icon: Users2, label: "More Leads", delta: "+12%", bars: [40, 55, 70, 100] },
  { icon: CalendarClock, label: "More Bookings", delta: "+28%", bars: [35, 60, 80, 100] },
  { icon: TrendingUp, label: "More Revenue", delta: "+32%", bars: [45, 62, 78, 100] },
];

/** Floating stat-card stack used on the forgot-password panel. */
export function StackedCardsPreview({ className }: { className?: string }) {
  return (
    <div className={`relative w-[340px] max-w-full ${className ?? ""}`}>
      {STACK_CARDS.map((card, i) => (
        <div
          key={card.label}
          className="ct-auth-float relative flex items-center gap-3.5 overflow-hidden rounded-[16px] px-4.5 py-4"
          style={{
            ...FRAME_STYLE,
            marginTop: i === 0 ? 0 : 16,
            marginLeft: i * 22,
            animationDelay: `${i * 0.7}s`,
          }}
        >
          <FrameGloss />
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-[rgba(168,255,31,0.2)] bg-[rgba(168,255,31,0.12)] text-[var(--auth-lime)]">
            <card.icon className="size-5" aria-hidden />
          </span>
          <span className="relative flex-1">
            <span className="block text-[14px] font-semibold text-white">{card.label}</span>
            <span className="block text-[12.5px] font-semibold text-[var(--auth-lime)]">
              {card.delta}
            </span>
          </span>
          <span className="relative flex h-7 items-end gap-1">
            {card.bars.map((h, bi) => (
              <span
                key={bi}
                className="w-1.5 rounded-t-[2px] bg-[var(--auth-lime)]"
                style={{ height: `${h}%`, opacity: 0.35 + bi * 0.2 }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Security-themed dashboard sliver used on the reset-password panel. */
export function SecurityPreview({ className }: { className?: string }) {
  return (
    <div className={`relative w-[380px] max-w-full ${className ?? ""}`}>
      <div className="relative overflow-hidden rounded-[20px]" style={FRAME_STYLE}>
        <FrameGloss />
        <div className="relative flex">
          <nav className="flex w-[124px] shrink-0 flex-col gap-1 border-r border-white/8 px-3 py-4">
            <div className="mb-4 flex items-center gap-2 px-1">
              <span className="flex size-7 items-center justify-center rounded-[8px] bg-[var(--auth-lime)] text-[12px] font-black text-[#071009]">
                C
              </span>
              <span className="text-[13.5px] font-bold tracking-tight text-white">
                Client<span className="text-[var(--auth-lime)]">Turn</span>
              </span>
            </div>
            {NAV_ITEMS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-[11px] font-medium text-white/40"
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </span>
            ))}
          </nav>
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <span className="relative flex size-24 items-center justify-center">
              <span
                aria-hidden
                className="ct-auth-glow-breathe absolute inset-0 rounded-[28px] blur-xl"
                style={{ background: "rgba(168,255,31,0.45)" }}
              />
              <span
                className="relative flex size-20 items-center justify-center rounded-[24px] border text-[var(--auth-lime)]"
                style={{
                  borderColor: "rgba(168,255,31,0.4)",
                  background:
                    "linear-gradient(160deg, rgba(168,255,31,0.18), rgba(168,255,31,0.04))",
                }}
              >
                <Lock className="size-9" strokeWidth={2.2} aria-hidden />
              </span>
            </span>
          </div>
        </div>
      </div>

      <div
        className="ct-auth-float relative -mt-4 ml-auto flex w-fit items-center gap-2 overflow-hidden rounded-[13px] px-3.5 py-2.5"
        style={{ ...FRAME_STYLE, marginRight: -12 }}
      >
        <FrameGloss />
        <span className="relative flex size-7 items-center justify-center rounded-[8px] bg-[rgba(168,255,31,0.12)] text-[var(--auth-lime)]">
          <ShieldCheck className="size-4" aria-hidden />
        </span>
        <span className="relative text-[11.5px] leading-tight font-medium text-white/85">
          Your business
          <br />
          stays protected
        </span>
      </div>
    </div>
  );
}
