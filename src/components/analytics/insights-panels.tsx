import * as React from "react";
import Link from "next/link";
import { FileText, GitBranch, PhoneCall, TrendingUp } from "lucide-react";
import {
  JOURNEY_MODELS,
  JOURNEY_MODEL_LABEL,
  formatMinor,
  type JourneyModel,
} from "@/lib/analytics/attribution";
import type { JourneyResult, AttributionReport } from "@/lib/analytics/revenue-journey-query";
import type { InsightResult } from "@/lib/analytics/insights-query";
import {
  formatDuration,
  formatRate,
  type QuoteAnalytics,
  type Rate,
  type RoiCard,
  type VoiceAnalytics,
} from "@/lib/analytics/insight-metrics";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { AnalyticsCard } from "./cards";

/**
 * Analytics -> revenue journey, quotes, voice and return on voice (§40-42,
 * §70). Server components: every figure is computed on the server and the
 * restricted ones (margin, cost) never reach a member's browser.
 *
 * States, per panel: loading (the skeleton, as the Suspense fallback), empty
 * (nothing recorded in the period), not set up (the tables are not on this
 * database yet), unavailable (a failed read), and "not enough data" per rate.
 */

/* ------------------------------------------------------------ shared bits */

export function InsightSkeleton({ title, icon }: { title: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <AnalyticsCard icon={icon} title={title}>
      <SkeletonTable rows={3} />
    </AnalyticsCard>
  );
}

function NotReady({ status, message }: { status: "not_set_up" | "unavailable"; message: string }) {
  return status === "not_set_up" ? (
    <EmptyState title="Not set up yet" description={message} className="py-8" />
  ) : (
    <ErrorState title="Not available" description={message} className="py-8" />
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "muted" }) {
  return (
    <div className="min-w-0 rounded-lg border border-line-subtle bg-surface-sunken/40 px-3 py-2.5">
      <p className="truncate text-[11.5px] text-content-muted">{label}</p>
      <p className={cn("mt-0.5 text-[15px] font-semibold tabular-nums text-content", tone === "muted" && "text-content-muted text-[12.5px] font-medium")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-content-subtle">{hint}</p>}
    </div>
  );
}

function RateText({ rate }: { rate: Rate }) {
  if (rate.value !== null && !rate.enough) {
    return (
      <span className="text-content-muted" title={`Only ${rate.denominator} in the denominator; at least 10 are needed`}>
        Not enough data
      </span>
    );
  }
  return <span>{formatRate(rate)}</span>;
}

function rateValue(rate: Rate): string {
  return rate.value !== null && !rate.enough ? "Not enough data" : formatRate(rate);
}

const hours = (h: number | null) => (h === null ? "—" : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} days`);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
const gbp = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n));
const money = (map: Record<string, number>) =>
  Object.entries(map)
    .filter(([, v]) => v !== 0)
    .map(([c, v]) => formatMinor(v, c))
    .join(" + ") || "—";

function titleCase(key: string): string {
  return key.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------ attribution */

const ATTRIBUTION_TITLE = "Revenue journey attribution";

export function AttributionPanel({
  result,
  model,
  baseParams,
}: {
  result: JourneyResult<AttributionReport>;
  model: JourneyModel;
  baseParams: Record<string, string>;
}) {
  const chips = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Attribution model">
      {JOURNEY_MODELS.map((m) => (
        <Link
          key={m}
          scroll={false}
          href={`/app/analytics?${new URLSearchParams({ ...baseParams, jmodel: m }).toString()}`}
          aria-current={m === model ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors",
            m === model ? "border-accent-500 bg-surface text-content shadow-xs" : "border-line text-content-muted hover:text-content",
          )}
        >
          {JOURNEY_MODEL_LABEL[m]}
        </Link>
      ))}
    </div>
  );
  const description = "Recorded revenue in this period, credited across every touch that came before it: ads, forms, messages, calls and quotes.";

  if (result.status === "unavailable") {
    return (
      <AnalyticsCard icon={GitBranch} title={ATTRIBUTION_TITLE} description={description}>
        <NotReady status="unavailable" message={result.message} />
      </AnalyticsCard>
    );
  }
  const data = result.data;
  return (
    <AnalyticsCard icon={GitBranch} title={ATTRIBUTION_TITLE} description={description}>
      <div className="mb-3">{chips}</div>
      {!data.hasRevenue ? (
        <EmptyState
          icon={GitBranch}
          title="No revenue recorded in this period"
          description="Attribution appears once a payment is recorded (a checkout payment or an invoice payment) or a deal is marked won with a value. It is never estimated from pipeline."
          className="py-8"
        />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Recorded revenue" value={money(data.totalRevenueMinor)} />
            <Stat label="Converting leads" value={data.convertingJourneys.toLocaleString("en-GB")} />
            <Stat label="Payments" value={money({ ...sumMaps(data.revenueByKind.CHECKOUT_PAYMENT, data.revenueByKind.INVOICE_PAYMENT) })} />
            <Stat label="Won value, not yet paid" value={money(data.revenueByKind.WON_OPPORTUNITY)} hint="Entered by a person on a won deal" />
          </div>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="text-content-muted">
                <tr>
                  <th className="px-1 py-2 font-medium">Channel</th>
                  <th className="px-1 py-2 text-right font-medium">Credited revenue</th>
                  <th className="px-1 py-2 text-right font-medium">Credited sales</th>
                  <th className="px-1 py-2 text-right font-medium" title="Share of converting journeys this channel appeared in, at any position">
                    Influence
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {data.rows.map((row) => (
                  <tr key={row.channel}>
                    <td className="px-1 py-2 font-medium text-content">{row.label}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{money(row.revenueMinor)}</td>
                    <td className="px-1 py-2 text-right tabular-nums">{row.conversions.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</td>
                    <td className="px-1 py-2 text-right tabular-nums">
                      {pct(row.influence)} <span className="text-content-subtle">({row.journeysTouched})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.45] text-content-subtle">
            {JOURNEY_MODEL_LABEL[model]} model. Only touches before the payment earn credit.
            {Object.keys(data.unattributedRevenueMinor).length > 0 && ` ${money(data.unattributedRevenueMinor)} had no earlier touch and is not credited to a channel.`}
            {data.truncated && " Only the first 2,000 converting leads are included."}
            {result.missing.length > 0 && ` Not counted yet on this database: ${result.missing.join(", ")}.`}
          </p>
        </>
      )}
    </AnalyticsCard>
  );
}

function sumMaps(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/* ------------------------------------------------------------------ quotes */

const QUOTE_TITLE = "Quotes";

export function QuoteAnalyticsPanel({ result }: { result: InsightResult<QuoteAnalytics & { restrictedVisible: boolean }> }) {
  const description = "From request to payment: how quotes are viewed, accepted, signed and paid, and what discounts cost.";
  if (result.status !== "ok") {
    return (
      <AnalyticsCard icon={FileText} title={QUOTE_TITLE} description={description}>
        <NotReady status={result.status} message={result.message} />
      </AnalyticsCard>
    );
  }
  const q = result.data;
  if (!q.hasData) {
    return (
      <AnalyticsCard icon={FileText} title={QUOTE_TITLE} description={description}>
        <EmptyState icon={FileText} title="No quotes in this period" description="Quote rates appear here once quotes are created and sent. Try a longer period." className="py-8" />
      </AnalyticsCard>
    );
  }
  return (
    <AnalyticsCard icon={FileText} title={QUOTE_TITLE} description={description}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Requested" value={q.counts.requested.toLocaleString("en-GB")} hint={`${rateValue(q.rates.requestToQuote)} quoted`} />
        <Stat label="Created / sent" value={`${q.counts.created} / ${q.counts.sent}`} />
        <Stat label="Viewed" value={rateValue(q.rates.viewed)} hint={`${q.counts.viewed} of ${q.counts.sent} sent`} />
        <Stat label="Accepted" value={rateValue(q.rates.accepted)} hint={`${q.counts.accepted} of ${q.counts.sent} sent`} />
        <Stat label="Signed" value={rateValue(q.rates.signed)} hint={`${q.counts.signed} of ${q.counts.sent} sent`} />
        <Stat label="Paid (any payment)" value={rateValue(q.rates.paid)} hint={`${q.counts.paid} of ${q.counts.sent} sent`} />
        <Stat label="Declined" value={rateValue(q.rates.declined)} />
        <Stat label="Expired" value={rateValue(q.rates.expired)} />
        <Stat label="Median time to quote" value={hours(q.medianHours.toQuote)} hint="Request to sent" />
        <Stat label="Median time to accept" value={hours(q.medianHours.toAccept)} hint="Sent to accepted" />
        <Stat label="Median time to pay" value={hours(q.medianHours.toPay)} hint="Accepted to first payment" />
        <Stat label="Average value sent" value={money(q.averageValueMinor)} />
        <Stat label="Revisions per quote" value={q.revisions.averagePerQuote === null ? "—" : q.revisions.averagePerQuote.toFixed(1)} hint={`${rateValue(q.revisions.revisedShare)} revised`} />
        <Stat label="Discount requested" value={q.discount.requested.toLocaleString("en-GB")} hint="Price or discount raised before sending" />
        <Stat label="Discount offered" value={rateValue(q.discount.offeredShare)} hint={q.discount.averagePercent === null ? "No discounts" : `Average ${pct(q.discount.averagePercent)} off list`} />
        {q.restrictedVisible ? (
          <Stat
            label="Margin impact of discounts"
            value={q.margin.impactPoints === null ? "—" : `${q.margin.impactPoints > 0 ? "+" : ""}${q.margin.impactPoints} pts`}
            hint={q.margin.quotesWithCost ? `${pct(q.margin.averageMarginPercent)} margin on ${q.margin.quotesWithCost} costed quotes` : "No quote has every cost recorded"}
          />
        ) : (
          <Stat label="Margin impact" value="Owners and admins only" tone="muted" />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SegmentTable title="AI vs human" rows={q.byAuthor.map((r) => ({ ...r, label: r.key === "LEAD_REQUEST" ? "Lead request" : titleCase(r.key) }))} />
        <SegmentTable title="By source" rows={q.bySource.map((r) => ({ ...r, label: r.key }))} />
        <SegmentTable title="By channel sent" rows={q.byChannel.map((r) => ({ ...r, label: titleCase(r.key) }))} />
      </div>
      {result.truncated && <p className="mt-2 text-[11.5px] text-content-subtle">Only the first 5,000 quotes in the period are included.</p>}
    </AnalyticsCard>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: { label: string; created: number; sent: number; acceptRate: Rate; paidRate: Rate }[] }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-[12.5px] font-semibold text-content">{title}</h4>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[300px] text-left text-[12px]">
          <thead className="text-content-muted">
            <tr>
              <th className="px-1 py-1.5 font-medium" />
              <th className="px-1 py-1.5 text-right font-medium">Sent</th>
              <th className="px-1 py-1.5 text-right font-medium">Accepted</th>
              <th className="px-1 py-1.5 text-right font-medium">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="max-w-[140px] truncate px-1 py-1.5 text-content">{r.label}</td>
                <td className="px-1 py-1.5 text-right tabular-nums">{r.sent}</td>
                <td className="px-1 py-1.5 text-right tabular-nums"><RateText rate={r.acceptRate} /></td>
                <td className="px-1 py-1.5 text-right tabular-nums"><RateText rate={r.paidRate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- voice */

const VOICE_TITLE = "AI calls";

export function VoiceAnalyticsPanel({
  result,
}: {
  result: InsightResult<VoiceAnalytics & { restrictedVisible: boolean; quality: { available: false; note: string } }>;
}) {
  const description = "Calls, connections and what they led to. Durations are the recorded call lengths only.";
  if (result.status !== "ok") {
    return (
      <AnalyticsCard icon={PhoneCall} title={VOICE_TITLE} description={description}>
        <NotReady status={result.status} message={result.message} />
      </AnalyticsCard>
    );
  }
  const v = result.data;
  if (!v.hasData) {
    return (
      <AnalyticsCard icon={PhoneCall} title={VOICE_TITLE} description={description}>
        <EmptyState icon={PhoneCall} title="No calls in this period" description="Once AI calling is switched on and calls are placed, connect rates, outcomes and conversions appear here." className="py-8" />
      </AnalyticsCard>
    );
  }
  return (
    <AnalyticsCard icon={PhoneCall} title={VOICE_TITLE} description={description}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Calls" value={v.calls.toLocaleString("en-GB")} hint={`${v.attempted} placed`} />
        <Stat label="Connect rate" value={rateValue(v.connectRate)} />
        <Stat label="Voicemail" value={rateValue(v.voicemailRate)} />
        <Stat label="Average duration" value={formatDuration(v.averageDurationSec)} hint={v.durationSample ? `${v.durationSample} recorded` : "None recorded yet"} />
        <Stat label="Led to a booking" value={rateValue(v.conversion.booking)} hint={`of ${v.conversion.connectedLeads} leads reached`} />
        <Stat label="Led to a quote" value={rateValue(v.conversion.quote)} />
        <Stat label="Led to a sale" value={rateValue(v.conversion.sale)} />
        {v.restrictedVisible ? (
          <Stat label="Cost per booking" value={gbp(v.costPerOutcome.perBooking)} hint={`Call cost ${gbp(v.costPerOutcome.totalCostGbp)} · per sale ${gbp(v.costPerOutcome.perSale)}`} />
        ) : (
          <Stat label="Cost per outcome" value="Owners and admins only" tone="muted" />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-1.5 text-[12.5px] font-semibold text-content">Outcome by route</h4>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[12px]">
              <thead className="text-content-muted">
                <tr>
                  <th className="px-1 py-1.5 font-medium">Route</th>
                  <th className="px-1 py-1.5 text-right font-medium">Placed</th>
                  <th className="px-1 py-1.5 text-right font-medium">Connected</th>
                  <th className="px-1 py-1.5 text-right font-medium">Voicemail</th>
                  <th className="px-1 py-1.5 text-right font-medium">No answer</th>
                  <th className="px-1 py-1.5 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {v.byRoute.map((r) => (
                  <tr key={r.route}>
                    <td className="px-1 py-1.5 text-content">{titleCase(r.route)}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{r.attempted}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">
                      {r.connected} <span className="text-content-subtle">(<RateText rate={r.connectRate} />)</span>
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{r.voicemail}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{r.noAnswer}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          <h4 className="mb-1.5 text-[12.5px] font-semibold text-content">Objections raised on calls</h4>
          {v.objections.length === 0 ? (
            <p className="text-[12.5px] text-content-muted">No objections recorded on calls in this period.</p>
          ) : (
            <ul className="divide-y divide-line-subtle text-[12px]">
              {v.objections.slice(0, 8).map((o) => (
                <li key={o.key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-content">{titleCase(o.key.replace(/[.:-]/g, " "))}</span>
                  <span className="shrink-0 tabular-nums text-content-muted">
                    {o.count} · resolved <RateText rate={o.resolvedRate} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px] leading-[1.45] text-content-subtle">{v.quality.note}</p>
        </div>
      </div>
    </AnalyticsCard>
  );
}

/* --------------------------------------------------------------------- ROI */

const ROI_TITLE = "Return on AI calling";

export function RoiPanel({ result, compact = false }: { result: InsightResult<RoiCard>; compact?: boolean }) {
  const description = "Voice minutes and spend, through to revenue credited to calls. Shown only when there is real data.";
  const body = (() => {
    if (result.status !== "ok") return <NotReady status={result.status} message={result.message} />;
    const card = result.data;
    if (card.status === "empty") {
      // On the Dashboard an empty ROI panel is one quiet line, not a 200px
      // hero: nothing here needs a decision yet.
      if (compact) {
        return (
          <p className="flex flex-wrap gap-x-1.5 text-[12.5px] text-content-muted">
            <span className="font-medium text-content">Nothing to measure yet.</span>
            <span>{card.reason}</span>
          </p>
        );
      }
      return <EmptyState icon={TrendingUp} title="Nothing to measure yet" description={card.reason} className="py-8" />;
    }
    return (
      <>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="From voice minutes to revenue">
          {card.steps.map((step) => (
            <li key={step.key} className="min-w-0 rounded-lg border border-line-subtle bg-surface-sunken/40 px-3 py-2.5">
              <p className="truncate text-[11.5px] text-content-muted">{step.label}</p>
              <p className={cn("mt-0.5 truncate font-semibold tabular-nums text-content", step.key === "revenue" ? "text-[15px] text-success-700" : "text-[15px]")}>{step.value}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-content-subtle">
          <Badge dense tone="info">Attributed</Badge>
          Revenue is recorded payments and won deal values, credited to calls with the {JOURNEY_MODEL_LABEL.position.toLowerCase()} model.
          {card.returnMultiple !== null && <span className="font-medium text-content">{card.returnMultiple}x voice spend.</span>}
        </p>
      </>
    );
  })();
  return (
    <AnalyticsCard icon={TrendingUp} title={ROI_TITLE} description={compact ? undefined : description}>
      {body}
    </AnalyticsCard>
  );
}

/* -------------------------------------------------------- async sections */

/** Awaits a loader inside Suspense so each section streams behind its own skeleton. */
export async function InsightSection<T>({ load, render }: { load: () => Promise<T>; render: (value: T) => React.ReactNode }) {
  return <>{render(await load())}</>;
}
