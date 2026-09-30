"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Layers, ShieldAlert, SlidersHorizontal, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { StepUpDialog } from "@/components/admin/step-up-dialog";
import { useToast } from "@/components/ui/toast";
import { formatMoney, titleise } from "@/lib/admin/format";

import type {
  AdminAffiliateDetail,
  AdminFlagRow,
  AdminPayoutRow,
  AdminProgrammeSettings,
  AdminTierRow,
} from "@/lib/admin/affiliates-types";
import type { AdminActionResult } from "@/lib/admin/guarded";
import {
  adjustAffiliateLedger,
  approvePayout,
  approvePayoutRun,
  cancelPayoutAction,
  retryPayout,
  reviewReferralFlag,
  sendPayout,
  setAffiliateTier,
  updateProgrammeSettings,
  updateTiers,
} from "@/lib/admin/affiliate-actions";
import { RelativeTime } from "@/components/admin/relative-time";
import { askReason, confirmAction } from "@/components/admin/admin-prompt";

/**
 * Admin -> Affiliates, the programme controls added by affiliate audit 17:
 * the fraud review queue, tiers and payout automation settings, a partner
 * detail panel (tier, sales tiers, balances, override, audited adjustment),
 * payout approval and export. Every write goes through `guarded` (authorised,
 * step-up, audited).
 */

type Run = (key: string, fn: () => Promise<AdminActionResult>, success: string) => Promise<void>;

/* ------------------------------------------------------------ exports -- */

export function ExportLinks() {
  const kinds = [
    { kind: "affiliates", label: "Partners" },
    { kind: "commissions", label: "Commission ledger" },
    { kind: "payouts", label: "Payouts" },
  ] as const;
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = React.useState<string | null>(null);

  // Fetched rather than linked: the export needs a recent step-up, and a
  // plain link would land on a bare 403 instead of offering the password
  // confirmation and retrying.
  async function download(kind: string) {
    setPending(kind);
    try {
      const response = await fetch(`/admin/affiliates/export?kind=${kind}`, { credentials: "same-origin" });
      if (response.status === 403) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === "step_up_required") {
          setStepUpFor(kind);
          return;
        }
      }
      if (!response.ok) {
        toast({ variant: "error", title: "The export could not be created. Please try again." });
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `clientturn-affiliate-${kind}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "error", title: "The export could not be created. Please try again." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Export">
      {kinds.map((item) => (
        <button
          key={item.kind}
          type="button"
          disabled={pending !== null}
          aria-busy={pending === item.kind || undefined}
          onClick={() => void download(item.kind)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-content-secondary hover:bg-surface-hover hover:text-content disabled:opacity-60"
        >
          <Download className="size-3.5" aria-hidden />
          {item.label} CSV
        </button>
      ))}
      <StepUpDialog
        open={stepUpFor !== null}
        onClose={() => setStepUpFor(null)}
        onConfirmed={async () => {
          const kind = stepUpFor;
          setStepUpFor(null);
          if (kind) await download(kind);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------ payout actions -- */

export function PayoutRunBar({ drafts, pending, run }: { drafts: number; pending: string | null; run: Run }) {
  if (drafts === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle bg-warning-50/60 px-4 py-3 sm:px-5">
      <p className="text-[13px] text-content">
        {drafts} payout{drafts === 1 ? " is" : "s are"} waiting for approval. Approving does not send money.
      </p>
      <Button
        size="xs"
        variant="secondary"
        loading={pending === "payout-run"}
        onClick={() => run("payout-run", () => approvePayoutRun(), "Approved.")}
      >
        Approve all
      </Button>
    </div>
  );
}

export function PayoutRowActions({ row, pending, run }: { row: AdminPayoutRow; pending: string | null; run: Run }) {
  const busy = (key: string) => pending === `${key}:${row.id}`;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {row.status === "DRAFT" && (
        <Button size="xs" variant="secondary" loading={busy("approve-payout")} onClick={() => run(`approve-payout:${row.id}`, () => approvePayout({ payoutId: row.id }), "Approved.")}>
          Approve
        </Button>
      )}
      {row.status === "APPROVED" && (
        <Button
          size="xs"
          variant="secondary"
          loading={busy("send-payout")}
          onClick={async () => {
            if (!await confirmAction(`Send ${formatMoney(row.amountMinor / 100)} to ${row.affiliateName} through Stripe Connect now?`)) return;
            void run(`send-payout:${row.id}`, () => sendPayout({ payoutId: row.id }), "Sent.");
          }}
        >
          Send
        </Button>
      )}
      {row.status === "FAILED" && (
        <Button size="xs" variant="secondary" loading={busy("retry-payout")} onClick={() => run(`retry-payout:${row.id}`, () => retryPayout({ payoutId: row.id }), "Reopened.")}>
          Retry
        </Button>
      )}
      {(row.status === "DRAFT" || row.status === "APPROVED" || row.status === "FAILED") && (
        <Button
          size="xs"
          variant="ghost"
          loading={busy("cancel-payout")}
          onClick={async () => {
            const reason = await askReason("Why is this payout being cancelled? Its commission goes back to the partner's balance.");
            if (!reason) return;
            void run(`cancel-payout:${row.id}`, () => cancelPayoutAction({ payoutId: row.id, reason }), "Cancelled.");
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------- flags queue -- */

const SEVERITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { BLOCK: "danger", REVIEW: "warning", INFO: "neutral" };

export function FlagsQueue({ rows, pending, run }: { rows: AdminFlagRow[]; pending: string | null; run: Run }) {
  return (
    <Panel
      icon={ShieldAlert}
      title="Fraud and self-referral review"
      description="Held referrals earn nothing until you decide. Clearing replays their paid invoices; confirming reverses what accrued. The partner never sees which signal fired."
    >
      {rows.length === 0 ? (
        <PanelEmpty>Nothing is held for review.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {rows.map((row) => (
            <li key={row.referralId} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1.5">
                <p className="text-[13px] font-medium text-content">
                  {row.affiliateName} <span className="text-content-subtle">referred</span> {row.businessName ?? "a deleted workspace"}
                </p>
                <p className="text-[12px] text-content-muted">
                  {titleise(row.referralStatus)} · held for {titleise(row.heldReason ?? "review")} · <RelativeTime value={row.createdAt} options={{ style: "ago" }} />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {row.signals.length === 0 ? (
                    <Badge tone="neutral" dense>{titleise(row.heldReason ?? "Flagged")}</Badge>
                  ) : (
                    row.signals.map((signal) => (
                      <Badge key={signal.code} tone={SEVERITY_TONE[signal.severity] ?? "neutral"} dense>
                        {signal.label}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  loading={pending === `clear:${row.referralId}`}
                  onClick={async () => {
                    const note = await askReason("Why is this referral legitimate? Recorded in the audit log.");
                    if (!note) return;
                    void run(`clear:${row.referralId}`, () => reviewReferralFlag({ referralId: row.referralId, decision: "CLEAR", note }), "Cleared.");
                  }}
                >
                  Clear
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  loading={pending === `confirm:${row.referralId}`}
                  onClick={async () => {
                    const note = await askReason("Why is this referral not eligible? Recorded in the audit log.");
                    if (!note) return;
                    void run(`confirm:${row.referralId}`, () => reviewReferralFlag({ referralId: row.referralId, decision: "CONFIRM", note }), "Confirmed.");
                  }}
                >
                  Confirm fraud
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------- tiers & settings -- */

export function TiersPanel({
  tiers,
  settings,
  pending,
  run,
}: {
  tiers: AdminTierRow[];
  settings: AdminProgrammeSettings;
  pending: string | null;
  run: Run;
}) {
  const [draft, setDraft] = React.useState(() =>
    tiers.map((tier) => ({
      ...tier,
      percent: tier.commissionPercent === null ? "" : String(tier.commissionPercent),
    })),
  );
  const [autoApprove, setAutoApprove] = React.useState(settings.autoApprovePayouts);
  const [autoSend, setAutoSend] = React.useState(settings.autoDispatchPayouts);

  const update = (index: number, patch: Partial<(typeof draft)[number]>) =>
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = () =>
    run(
      "tiers",
      () =>
        updateTiers({
          tiers: draft.map((row) => ({
            key: row.key,
            name: row.name,
            rank: row.rank,
            minActiveCustomers: Math.max(0, Math.floor(Number(row.minActiveCustomers) || 0)),
            commissionPercent: row.percent.trim() === "" ? null : Number(row.percent),
            description: row.description,
          })),
        }),
      "Saved.",
    );

  return (
    <div className="space-y-4">
      <Panel
        icon={Layers}
        title="Partner tiers"
        description="Commission is one-off: one payment per referred customer, on their first payment (the full amount, annual plans included). A tier sets only that one-off rate, between 1% and 10%, and is reached by paid referred customers in the last 12 months. A tier never pays less than the plan. Promotions apply daily; demotions at the monthly review; a locked partner stays put."
        action={
          <Button size="xs" variant="secondary" loading={pending === "tiers"} onClick={save}>
            Save tiers
          </Button>
        }
      >
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60 text-[11.5px] uppercase tracking-wide text-content-subtle">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">Tier</th>
                <th scope="col" className="px-4 py-2 font-medium">Paid customers (last 12 months)</th>
                <th scope="col" className="px-4 py-2 font-medium">One-off rate (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {draft.map((row, index) => (
                <tr key={row.key}>
                  <td className="px-4 py-2 sm:px-5">
                    <Input aria-label={`${row.key} name`} value={row.name} onChange={(event) => update(index, { name: event.target.value })} className="max-w-[160px]" />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      aria-label={`${row.name} paid customers in the last 12 months`}
                      inputMode="numeric"
                      value={String(row.minActiveCustomers)}
                      disabled={row.rank === 0}
                      onChange={(event) => update(index, { minActiveCustomers: Number(event.target.value.replace(/\D/g, "")) || 0 })}
                      className="max-w-[110px]"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input aria-label={`${row.name} one-off rate`} inputMode="decimal" placeholder="Plan rate" value={row.percent} onChange={(event) => update(index, { percent: event.target.value })} className="max-w-[110px]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        icon={SlidersHorizontal}
        title="Payout automation"
        description="Off by default: the monthly run raises payouts as 'pending approval' and a person approves and sends them. Automatic sending also needs AFFILIATE_AUTO_PAYOUT=true in the deployment."
        action={
          <Button
            size="xs"
            variant="secondary"
            loading={pending === "settings"}
            disabled={!settings.available}
            onClick={() => run("settings", () => updateProgrammeSettings({ autoApprovePayouts: autoApprove, autoDispatchPayouts: autoSend }), "Saved.")}
          >
            Save settings
          </Button>
        }
      >
        <div className="space-y-3 px-4 pb-4 sm:px-5">
          {!settings.available && (
            <p className="rounded-md bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">Migration 0166 is not applied yet, so these switches are unavailable and nothing is automatic.</p>
          )}
          <p className="text-[12.5px] leading-relaxed text-content-secondary">
            Ending a partnership writes off a negative balance: one write-off entry nets it to zero, and the partner is never
            invoiced for it. There is no self-billing at launch: VAT-registered partners send ClientTurn a VAT invoice, and
            statements are remittance advice, not VAT invoices.
          </p>
          <label className="flex items-center justify-between gap-4 text-[13px] text-content">
            <span>Approve monthly payouts automatically</span>
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} disabled={!settings.available} label="Approve monthly payouts automatically" />
          </label>
          <label className="flex items-center justify-between gap-4 text-[13px] text-content">
            <span>
              Send approved payouts automatically
              <span className="block text-[11.5px] text-content-subtle">
                Deployment switch: {settings.envAutoPayout ? "on" : "off"}. Both must be on.
              </span>
            </span>
            <Switch checked={autoSend} onCheckedChange={setAutoSend} disabled={!settings.available} label="Send approved payouts automatically" />
          </label>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------ partner detail -- */

export function AffiliateDetailPanel({ detail, pending, run }: { detail: AdminAffiliateDetail; pending: string | null; run: Run }) {
  const [tier, setTier] = React.useState(detail.tier);
  const [lock, setLock] = React.useState(detail.tierLocked);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  // One id per adjustment being entered: a double-click reuses it (and the
  // ledger ignores the repeat); editing the amount or reason starts a new one.
  const requestId = React.useRef<string | null>(null);
  const editAmount = (value: string) => {
    requestId.current = null;
    setAmount(value);
  };
  const editReason = (value: string) => {
    requestId.current = null;
    setReason(value);
  };

  return (
    <Panel
      icon={UserRound}
      title={`${detail.displayName} (${detail.code})`}
      description={`${titleise(detail.status)} · ${titleise(detail.tier)} tier${detail.tierLocked ? " (locked)" : ""} · payouts ${titleise(detail.payoutReadiness)} · Stripe ${titleise(detail.connectState)}${detail.openFlags > 0 ? ` · ${detail.openFlags} open flag${detail.openFlags === 1 ? "" : "s"}` : ""}`}
      action={
        <Link href="/admin/affiliates?tab=affiliates" className="inline-flex items-center gap-1 text-[12.5px] text-content-secondary hover:text-content">
          <X className="size-3.5" aria-hidden /> Close
        </Link>
      }
    >
      <div className="grid gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-3">
        <section className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-content-subtle">Partner tier</h3>
          <p className="text-[13px] text-content">
            {detail.activeCustomers} active referred customer{detail.activeCustomers === 1 ? "" : "s"} · {formatMoney(detail.referredMrrMinor / 100)} referred MRR
          </p>
          {detail.nextTier ? (
            <Progress value={detail.tierPercent} label={`Progress to ${detail.nextTier}`} />
          ) : (
            <p className="text-[12px] text-content-muted">Top tier.</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select
              aria-label="Set tier"
              value={tier}
              onChange={(event) => setTier(event.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]"
            >
              {["STANDARD", "PARTNER", "PREMIUM"].map((key) => (
                <option key={key} value={key}>{titleise(key)}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[12.5px] text-content-secondary">
              <input type="checkbox" checked={lock} onChange={(event) => setLock(event.target.checked)} /> Lock
            </label>
            <Button size="xs" variant="secondary" loading={pending === `tier:${detail.id}`} onClick={() => run(`tier:${detail.id}`, () => setAffiliateTier({ affiliateId: detail.id, tier, lock }), "Tier set.")}>
              Apply
            </Button>
          </div>
          {detail.tierHistory.length > 0 && (
            <ul className="space-y-1 pt-1 text-[12px] text-content-muted">
              {detail.tierHistory.slice(0, 5).map((entry, index) => (
                <li key={index}>
                  {titleise(entry.fromTier ?? "none")} → {titleise(entry.toTier)} · {titleise(entry.reason)} · <RelativeTime value={entry.createdAt} options={{ style: "ago" }} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-content-subtle">Sales tiers (referred plans)</h3>
          {detail.sales.length === 0 ? (
            <p className="text-[12.5px] text-content-muted">No active referred customers.</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {detail.sales.map((sale) => (
                <li key={sale.label} className="flex justify-between gap-3">
                  <span>{sale.label}</span>
                  <span className="tabular-nums text-content-secondary">{sale.customers} · {formatMoney(sale.mrrMinor / 100)}/mo</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="pt-2 text-[12px] font-medium uppercase tracking-wide text-content-subtle">Balance</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-content-muted">On hold</dt><dd className="text-right tabular-nums">{formatMoney(detail.balances.pendingMinor / 100)}</dd>
            <dt className="text-content-muted">Approved</dt><dd className="text-right tabular-nums">{formatMoney(detail.balances.approvedMinor / 100)}</dd>
            <dt className="text-content-muted">Available now</dt>
            <dd className={detail.balances.availableMinor < 0 ? "text-right tabular-nums text-danger-600" : "text-right tabular-nums"}>{formatMoney(detail.balances.availableMinor / 100)}</dd>
            <dt className="text-content-muted">Paid</dt><dd className="text-right tabular-nums">{formatMoney(detail.balances.paidMinor / 100)}</dd>
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-content-subtle">Commission adjustment</h3>
          <p className="text-[12px] text-content-muted">A new ledger row, never an edit. Negative to claw back. The partner sees the reason. Audited.</p>
          <Input aria-label="Adjustment amount in pounds" inputMode="decimal" placeholder="Amount, e.g. -25.00" value={amount} onChange={(event) => editAmount(event.target.value)} />
          <Input aria-label="Adjustment reason" placeholder="Reason the partner will see" value={reason} onChange={(event) => editReason(event.target.value)} />
          <Button
            size="xs"
            variant="secondary"
            loading={pending === `adjust:${detail.id}`}
            onClick={() => {
              const minor = Math.round(Number(amount) * 100);
              if (!Number.isFinite(minor) || minor === 0) return;
              requestId.current ??= crypto.randomUUID();
              const id = requestId.current;
              void run(`adjust:${detail.id}`, () => adjustAffiliateLedger({ affiliateId: detail.id, amountMinor: minor, reason, requestId: id }), "Recorded.");
            }}
          >
            Record adjustment
          </Button>
        </section>
      </div>
    </Panel>
  );
}
