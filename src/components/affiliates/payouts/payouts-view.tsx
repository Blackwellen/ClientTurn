"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Info,
  Landmark,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerBody } from "@/components/ui/drawer";
import {
  Panel,
  PanelEmpty,
  Table,
  Td,
} from "@/components/affiliates/portal-ui";
import { formatMinor } from "@/lib/affiliates/types";
import { PAYOUT_STATUS_LABEL, PAYOUT_STATUS_TONE } from "@/lib/affiliates/types";
import {
  CONNECT_STATE_LABEL,
  CONNECT_STATE_TONE,
  maskIdentifier,
  TAX_STATE_LABEL,
  TAX_STATE_TONE,
  type ConnectState,
  type TaxState,
} from "@/lib/affiliates/programme";
import type { PortalPayout } from "@/lib/affiliates/portal";
import type { PayoutBreakdown } from "@/lib/affiliates/payouts";

/**
 * The payout history table and its detail drawer (V4 §35).
 *
 * The drawer's breakdown is fetched on open rather than embedded in the page:
 * a partner with fifty payouts would otherwise ship fifty breakdowns to the
 * browser to render one.
 */
export function PayoutHistory({ payouts }: { payouts: PortalPayout[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  // Keyed by payout id so a stale response for a previously-opened drawer can
  // never be rendered against the payout now on screen.
  const [detail, setDetail] = React.useState<{
    id: string;
    state: "loading" | "loaded" | "failed";
    breakdown: PayoutBreakdown | null;
  } | null>(null);

  const selected = payouts.find((payout) => payout.id === openId) ?? null;

  // Fetching starts from the click rather than from an effect watching state:
  // the breakdown is a consequence of the user opening a row, not of a render.
  const open = React.useCallback((payoutId: string) => {
    setOpenId(payoutId);
    setDetail({ id: payoutId, state: "loading", breakdown: null });

    fetch(`/affiliates/app/payouts/${payoutId}/breakdown`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: PayoutBreakdown | null) => {
        setDetail((current) =>
          current?.id === payoutId
            ? { id: payoutId, state: data ? "loaded" : "failed", breakdown: data }
            : current,
        );
      })
      .catch(() => {
        setDetail((current) =>
          current?.id === payoutId
            ? { id: payoutId, state: "failed", breakdown: null }
            : current,
        );
      });
  }, []);

  const loading = detail?.id === openId && detail.state === "loading";
  const breakdown = detail?.id === openId ? detail.breakdown : null;

  return (
    <>
      <Panel
        icon={FileText}
        title="Payout history"
        description="View all your previous payouts and download your records."
        action={
          <a
            href="/affiliates/app/payouts/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[12.5px] font-medium text-content hover:bg-surface-hover"
          >
            <Download className="size-3.5" aria-hidden />
            Export
          </a>
        }
      >
        {payouts.length === 0 ? (
          <PanelEmpty
            title="No payouts yet."
            description="Your first payout is raised once your approved balance reaches the minimum threshold."
          />
        ) : (
          <>
            <Table
              minWidth={760}
              headers={[
                { label: "Payout ID" },
                { label: "Period" },
                { label: "Amount", numeric: true },
                { label: "Status" },
                { label: "Method" },
                { label: "Date" },
                { label: "Actions", srOnly: true },
              ]}
            >
              {payouts.map((payout) => (
                <tr key={payout.id} className="hover:bg-surface-hover">
                  <Td className="font-medium">{payout.reference}</Td>
                  <Td className="text-content-secondary">{payout.periodLabel}</Td>
                  <Td numeric className="font-semibold">
                    {formatMinor(payout.amountMinor, payout.currency)}
                  </Td>
                  <Td>
                    <Badge tone={PAYOUT_STATUS_TONE[payout.status]} dense>
                      {PAYOUT_STATUS_LABEL[payout.status]}
                    </Badge>
                  </Td>
                  <Td className="text-content-secondary">
                    {payout.method ?? "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-content-secondary">
                    {new Date(
                      payout.paidAt ?? payout.scheduledAt ?? payout.createdAt,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => open(payout.id)}
                      className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
                    >
                      View
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="px-4 py-3 text-[12.5px] text-content-muted">
              Showing 1–{payouts.length} of {payouts.length} payouts
            </p>
          </>
        )}
      </Panel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setOpenId(null)}
        title="Payout Details"
        anchor="content"
        footer={
          selected && (
            <div className="flex flex-wrap gap-2">
              <a
                href={`/affiliates/app/payouts/${selected.id}/statement`}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface px-4 text-[13.5px] font-medium text-content hover:bg-surface-hover"
              >
                <Download className="size-4" aria-hidden />
                Download statement
              </a>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-[9px] bg-accent-500 px-4 text-[13.5px] font-semibold text-brand-midnight hover:bg-[#a6e238]"
              >
                Close
              </button>
            </div>
          )
        }
      >
        {selected && (
          <DrawerBody>
            <div className="rounded-[11px] border border-line bg-surface-sunken/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={PAYOUT_STATUS_TONE[selected.status]} dot>
                  {PAYOUT_STATUS_LABEL[selected.status]}
                </Badge>
                <span className="text-[12px] font-medium text-content-muted">
                  {selected.reference}
                </span>
              </div>
              <p className="mt-3 text-[30px] font-bold leading-none tabular-nums text-content">
                {formatMinor(selected.amountMinor, selected.currency)}
              </p>
              <p className="mt-1.5 text-[14px] text-content-secondary">
                {selected.periodLabel}
              </p>
              {selected.paidAt && (
                <p className="mt-1 text-[12.5px] text-content-muted">
                  Paid on{" "}
                  {new Date(selected.paidAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {selected.method ? ` via ${selected.method}` : ""}
                </p>
              )}
              {selected.status === "FAILED" && selected.failureReason && (
                <p className="mt-3 rounded-[8px] border border-danger-100 bg-danger-50 px-3 py-2 text-[12.5px] leading-relaxed text-danger-700">
                  {selected.failureReason} Your balance is safe and will be
                  included in the next run.
                </p>
              )}
            </div>

            <Section title="Payout Summary">
              {loading ? (
                <p className="text-[13px] text-content-muted">Loading…</p>
              ) : breakdown ? (
                <dl className="divide-y divide-line-subtle">
                  <Row label="Referrals" value={String(breakdown.referrals)} />
                  <Row
                    label="Paid customers"
                    value={String(breakdown.paidCustomers)}
                  />
                  <Row
                    label="Total commission"
                    value={formatMinor(breakdown.totalMinor, selected.currency)}
                  />
                  <Row
                    label="Commission rate (avg)"
                    value={
                      breakdown.averageRate === null
                        ? "—"
                        : `${(breakdown.averageRate * 100).toFixed(1)}%`
                    }
                  />
                </dl>
              ) : (
                <p className="text-[13px] text-content-muted">
                  The breakdown for this payout is not available.
                </p>
              )}
            </Section>

            {breakdown && (
              <Section title="Commission Breakdown">
                <dl className="divide-y divide-line-subtle">
                  <Row
                    label="New customer commissions"
                    value={formatMinor(breakdown.newCustomerMinor, selected.currency)}
                  />
                  <Row
                    label="Renewal commissions"
                    value={formatMinor(breakdown.renewalMinor, selected.currency)}
                  />
                  <Row
                    label="Adjustments"
                    value={formatMinor(breakdown.adjustmentMinor, selected.currency)}
                    negative={breakdown.adjustmentMinor < 0}
                  />
                  {breakdown.reversalMinor !== 0 && (
                    <Row
                      label="Reversals"
                      value={formatMinor(breakdown.reversalMinor, selected.currency)}
                      negative
                    />
                  )}
                  <div className="flex items-center justify-between gap-3 border-t-2 border-line pt-2.5">
                    <dt className="text-[14px] font-semibold text-content">
                      Total payout
                    </dt>
                    <dd className="text-[14px] font-bold tabular-nums text-content">
                      {formatMinor(selected.amountMinor, selected.currency)}
                    </dd>
                  </div>
                </dl>
              </Section>
            )}

            <Section title="Status Timeline">
              <ol className="space-y-3.5">
                <TimelineStep
                  done={Boolean(selected.approvedAt)}
                  title="Payout approved"
                  body="Your payout was approved for processing."
                  at={selected.approvedAt}
                />
                <TimelineStep
                  done={Boolean(selected.processedAt)}
                  title="Payment processed"
                  body={`Payment sent${selected.method ? ` via ${selected.method}` : ""}.`}
                  at={selected.processedAt}
                />
                <TimelineStep
                  done={Boolean(selected.paidAt)}
                  title="Paid"
                  body="Funds received in your account."
                  at={selected.paidAt}
                  last
                />
              </ol>
            </Section>

            {selected.notes && (
              <Section title="Notes">
                <p className="rounded-[9px] bg-surface-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-content-secondary">
                  {selected.notes}
                </p>
              </Section>
            )}
          </DrawerBody>
        )}
      </Drawer>
    </>
  );
}

/* --------------------------------------------------------- payment cards -- */

/**
 * Where money is sent.
 *
 * Shows the connection state and nothing more — no account number, no Connect
 * account id, no bank reference. Stripe holds those; we do not need them and
 * do not display them.
 */
export function PaymentMethodCard({
  connectState,
  hasAccount,
  payoutsEnabled,
}: {
  connectState: ConnectState;
  hasAccount: boolean;
  payoutsEnabled: boolean;
}) {
  return (
    <Panel
      icon={Landmark}
      title="Payment method"
      description="Your earnings will be paid to this account."
      action={
        <Link
          href="/affiliates/app/settings?section=payments"
          className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
        >
          Manage
        </Link>
      }
    >
      <div className="px-4 pb-4">
        <div className="rounded-[11px] border border-line bg-surface-sunken/50 p-3.5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface">
              <Building2 className="size-4 text-content-muted" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13.5px] font-semibold text-content">
                  {hasAccount ? "Stripe Connect" : "No payment method"}
                </p>
                <Badge tone={CONNECT_STATE_TONE[connectState]} dense>
                  {CONNECT_STATE_LABEL[connectState]}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-content-muted">
                {hasAccount
                  ? payoutsEnabled
                    ? "Stripe has confirmed it can send you money. Payouts run automatically once you reach the threshold."
                    : "Stripe still needs something from you before payouts can be sent."
                  : "Connect a Stripe account so your commission can be paid out."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function TaxInfoCard({
  taxStatus,
  taxCountry,
  taxIdentifierLast4,
  submittedAt,
}: {
  taxStatus: TaxState;
  taxCountry: string | null;
  taxIdentifierLast4: string | null;
  submittedAt: string | null;
}) {
  return (
    <Panel
      icon={FileText}
      title="Tax information"
      description={
        taxStatus === "VERIFIED"
          ? "Your tax profile is complete."
          : "We need your tax details before we can pay you."
      }
      action={
        <Link
          href="/affiliates/app/settings?section=tax"
          className="rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
        >
          Update
        </Link>
      }
    >
      <div className="space-y-2 px-4 pb-4">
        <div className="flex items-center gap-2">
          <Badge tone={TAX_STATE_TONE[taxStatus]} dot>
            {TAX_STATE_LABEL[taxStatus]}
          </Badge>
          {submittedAt && (
            <span className="text-[12px] text-content-muted">
              Submitted{" "}
              {new Date(submittedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        {taxCountry && (
          <p className="text-[13px] text-content-secondary">{taxCountry}</p>
        )}
        {taxIdentifierLast4 && (
          <p className="text-[13px] tabular-nums text-content-secondary">
            Tax reference {maskIdentifier(taxIdentifierLast4)}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- next payout -- */

export function NextPayoutCard({
  availableMinor,
  minimumMinor,
  currency,
  payoutDate,
  ready,
}: {
  availableMinor: number;
  minimumMinor: number;
  currency: string;
  payoutDate: string;
  ready: boolean;
}) {
  const pct = Math.min(
    100,
    Math.round((availableMinor / Math.max(minimumMinor, 1)) * 100),
  );
  const shortfall = Math.max(minimumMinor - availableMinor, 0);

  return (
    <Panel
      icon={CalendarClock}
      title="Next payout"
      description="Your next payout is scheduled for the end of this month."
      action={
        <Badge tone={ready ? "info" : "warning"} dot dense>
          {ready ? "Scheduled" : "Below threshold"}
        </Badge>
      }
    >
      <div className="px-4 pb-4">
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-[26px] font-bold leading-none tracking-[-0.02em] text-content">
              {new Date(payoutDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            <p className="mt-1 text-[12px] text-content-muted">Next payout date</p>
          </div>
          <div>
            <p className="text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums text-content">
              {formatMinor(availableMinor, currency)}
            </p>
            <p className="mt-1 text-[12px] text-content-muted">Expected amount</p>
          </div>
        </div>

        <p className="mt-4 text-[13px] tabular-nums text-content-secondary">
          {formatMinor(availableMinor, currency)} /{" "}
          {formatMinor(minimumMinor, currency)} minimum
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div
            className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={`${pct}% of the minimum payout threshold reached`}
          >
            <div
              className="h-full rounded-full bg-accent-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-content-muted">
            {pct}%
          </span>
        </div>

        <p
          className={cn(
            "mt-3 flex items-start gap-2 rounded-[9px] px-3 py-2.5 text-[12.5px] leading-relaxed",
            shortfall > 0
              ? "bg-warning-50 text-warning-700"
              : "bg-surface-sunken text-content-secondary",
          )}
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {shortfall > 0
            ? `${formatMinor(shortfall, currency)} more needed before a payout is raised.`
            : `You've reached the minimum threshold. Your payout will be processed on ${new Date(
                payoutDate,
              ).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}.`}
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- fragments -- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-2.5 text-[14px] font-semibold text-content">{title}</h3>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[13px] text-content-secondary">{label}</dt>
      <dd
        className={cn(
          "text-[13px] font-semibold tabular-nums",
          negative ? "text-danger-600" : "text-content",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function TimelineStep({
  done,
  title,
  body,
  at,
  last,
}: {
  done: boolean;
  title: string;
  body: string;
  at: string | null;
  last?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        {done ? (
          <CheckCircle2 className="size-5 shrink-0 text-success-600" aria-hidden />
        ) : (
          <span
            className="size-5 shrink-0 rounded-full border-2 border-line-strong"
            aria-hidden
          />
        )}
        {!last && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
      </div>
      <div className="min-w-0 pb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p
            className={cn(
              "text-[13px] font-semibold",
              done ? "text-content" : "text-content-muted",
            )}
          >
            {title}
          </p>
          {at && (
            <span className="text-[11.5px] tabular-nums text-content-muted">
              {new Date(at).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-content-muted">{body}</p>
      </div>
    </li>
  );
}
