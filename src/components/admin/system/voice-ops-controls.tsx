"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/badge";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { cn } from "@/lib/cn";
import {
  gmHealth,
  simulateVoicePackages,
  VOICE_GM_FLOOR,
  type GmDimension,
  type GmReport,
  type SimulatorInput,
} from "@/lib/admin/voice-ops-model";
import {
  retryVoiceWebhook,
  runVoiceMarginCheckNow,
  setNumberSuspended,
  setOutboundPaused,
  setSpendLimit,
  setWorkspaceVoiceDisabled,
} from "@/lib/admin/voice-ops-actions";
import { retryJob } from "@/lib/admin/job-actions";
import type { AdminActionResult } from "@/lib/admin/guarded";
import { gbp, percent } from "@/components/admin/economics/format";

/* ------------------------------------------------------ the confirm dialog */

type ControlSpec = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** Show a £ amount input (spending limit). */
  amount?: { label: string; initial: number | null };
  run: (input: { reason: string; confirm: boolean; amount: number | null }) => Promise<AdminActionResult>;
  success: string;
};

/**
 * Every emergency control asks for a reason (the audit row) and an explicit
 * tick before it runs; the server checks both again (authorizeAdminVoiceControl
 * and the op's `confirm: true`). Step-up is offered by useAdminAction.
 */
function ControlDialog({ spec, onClose }: { spec: ControlSpec; onClose: () => void }) {
  const { run, pending, stepUpDialog } = useAdminAction();
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [amount, setAmount] = React.useState(spec.amount?.initial === null || spec.amount?.initial === undefined ? "" : String(spec.amount.initial));
  const parsedAmount = amount.trim() === "" ? null : Number(amount);
  const amountInvalid = spec.amount !== undefined && parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0);

  return (
    <>
      <Modal open onClose={onClose} title={spec.title} size="sm">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", spec.danger ? "border-danger-100 bg-danger-50" : "border-warning-100 bg-warning-50")}>
            <AlertTriangle className={cn("size-4", spec.danger ? "text-danger-600" : "text-warning-600")} aria-hidden />
          </span>
          <p className="min-w-0 text-[13px] text-content">{spec.body}</p>
        </div>
        {spec.amount && (
          <div className="mt-4">
            <FormField label={spec.amount.label} htmlFor="voice-control-amount" hint="GBP of provider spend per calendar month. Leave empty for no limit.">
              <Input id="voice-control-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 250" />
            </FormField>
          </div>
        )}
        <div className="mt-4">
          <FormField label="Reason" htmlFor="voice-control-reason" hint="Recorded in the audit log against your operator account." required>
            <Textarea id="voice-control-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[13px] text-content">
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          I understand this takes effect immediately for this workspace.
        </label>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending !== null}>
            Cancel
          </Button>
          <Button
            variant={spec.danger ? "danger" : "primary"}
            size="sm"
            loading={pending !== null}
            disabled={!confirmed || reason.trim().length < 4 || amountInvalid}
            onClick={async () => {
              await run("control", () => spec.run({ reason: reason.trim(), confirm: confirmed, amount: parsedAmount }), spec.success);
              onClose();
            }}
          >
            {spec.confirmLabel}
          </Button>
        </div>
      </Modal>
      {stepUpDialog}
    </>
  );
}

function useControl() {
  const [spec, setSpec] = React.useState<ControlSpec | null>(null);
  const dialog = spec ? <ControlDialog spec={spec} onClose={() => setSpec(null)} /> : null;
  return { open: setSpec, dialog };
}

/* ------------------------------------------------------- workspace controls */

export function WorkspaceVoiceControls({
  businessId,
  name,
  killSwitch,
  outboundPaused,
  spendLimitGbp,
}: {
  businessId: string;
  name: string;
  killSwitch: boolean;
  /** Null when 0158 is not applied: the control is shown as unavailable. */
  outboundPaused: boolean | null;
  spendLimitGbp: number | null;
}) {
  const { open, dialog } = useControl();
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="xs"
        variant={killSwitch ? "secondary" : "danger"}
        onClick={() =>
          open({
            title: killSwitch ? `Re-enable AI calling for ${name}?` : `Disable AI calling for ${name}?`,
            body: killSwitch
              ? "The workspace's own voice settings apply again. Queued calls that were cancelled are not restored."
              : "Every queued call is cancelled and no call is placed or answered by the AI until this is reversed.",
            confirmLabel: killSwitch ? "Re-enable" : "Disable voice",
            danger: !killSwitch,
            run: ({ reason, confirm }) => setWorkspaceVoiceDisabled({ businessId, disabled: !killSwitch, reason, confirm }),
            success: killSwitch ? "AI calling re-enabled." : "AI calling disabled.",
          })
        }
      >
        {killSwitch ? "Enable voice" : "Disable voice"}
      </Button>
      <Button
        size="xs"
        variant="secondary"
        disabled={outboundPaused === null}
        title={outboundPaused === null ? "Needs migration 0158" : undefined}
        onClick={() =>
          open({
            title: outboundPaused ? "Resume outbound calls?" : "Pause outbound calls?",
            body: outboundPaused ? "Outbound AI calls may be placed again." : "No new outbound AI call is dialled. Inbound calls are still answered.",
            confirmLabel: outboundPaused ? "Resume" : "Pause outbound",
            run: ({ reason, confirm }) => setOutboundPaused({ businessId, paused: !outboundPaused, reason, confirm }),
            success: outboundPaused ? "Outbound resumed." : "Outbound paused.",
          })
        }
      >
        {outboundPaused ? "Resume outbound" : "Pause outbound"}
      </Button>
      <Button
        size="xs"
        variant="secondary"
        disabled={outboundPaused === null}
        title={outboundPaused === null ? "Needs migration 0158" : undefined}
        onClick={() =>
          open({
            title: `Spending limit for ${name}`,
            body: "Outbound calls stop for the rest of the month once provider spend reaches this amount.",
            confirmLabel: "Save limit",
            amount: { label: "Monthly limit (£)", initial: spendLimitGbp },
            run: ({ reason, confirm, amount }) => setSpendLimit({ businessId, limitGbp: amount, reason, confirm }),
            success: "Spending limit saved.",
          })
        }
      >
        {spendLimitGbp === null ? "Set limit" : `Limit ${gbp(spendLimitGbp, 0)}`}
      </Button>
      {dialog}
    </div>
  );
}

export function NumberSuspendControl({ numberId, businessId, suspended }: { numberId: string; businessId: string; suspended: boolean | null }) {
  const { open, dialog } = useControl();
  return (
    <>
      <Button
        size="xs"
        variant={suspended ? "secondary" : "danger"}
        disabled={suspended === null}
        title={suspended === null ? "Needs migration 0158" : undefined}
        onClick={() =>
          open({
            title: suspended ? "Reinstate this number?" : "Suspend this number?",
            body: suspended ? "The number can place and take AI calls again." : "No AI call is placed from or answered on this number until it is reinstated.",
            confirmLabel: suspended ? "Reinstate" : "Suspend number",
            danger: !suspended,
            run: ({ reason, confirm }) => setNumberSuspended({ businessId, numberId, suspended: !suspended, reason, confirm }),
            success: suspended ? "Number reinstated." : "Number suspended.",
          })
        }
      >
        {suspended ? "Reinstate" : "Suspend"}
      </Button>
      {dialog}
    </>
  );
}

export function RetryVoiceWebhookButton({ id }: { id: string }) {
  const { run, pending, stepUpDialog } = useAdminAction();
  return (
    <>
      <Button size="xs" variant="secondary" loading={pending !== null} onClick={() => run("retry", () => retryVoiceWebhook({ webhookEventId: id, confirm: true }), "Voice event re-queued.")}>
        <RotateCcw className="size-3" aria-hidden />
        Retry
      </Button>
      {stepUpDialog}
    </>
  );
}

export function RetryVoiceJobButton({ id }: { id: string }) {
  const { run, pending, stepUpDialog } = useAdminAction();
  return (
    <>
      <Button size="xs" variant="secondary" loading={pending !== null} onClick={() => run("retry", () => retryJob({ jobId: id }), "Job re-queued.")}>
        <RotateCcw className="size-3" aria-hidden />
        Retry
      </Button>
      {stepUpDialog}
    </>
  );
}

export function RunMarginCheckButton() {
  const { run, pending, stepUpDialog } = useAdminAction();
  return (
    <>
      <Button size="sm" variant="secondary" loading={pending !== null} onClick={() => run("check", () => runVoiceMarginCheckNow(), "Voice margin checked.")}>
        Run margin check
      </Button>
      {stepUpDialog}
    </>
  );
}

/* ------------------------------------------------------------ GM tables */

const DIMENSIONS: { value: GmDimension; label: string }[] = [
  { value: "workspace", label: "Workspace" },
  { value: "package", label: "Package" },
  { value: "provider", label: "Provider" },
  { value: "country", label: "Country" },
  { value: "route", label: "Route" },
  { value: "month", label: "Month" },
];

export function GmTables({ gm }: { gm: GmReport }) {
  const [dimension, setDimension] = React.useState<GmDimension>("workspace");
  const rows = gm[dimension];
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <SegmentedControl size="sm" items={DIMENSIONS} value={dimension} onChange={(v) => setDimension(v as GmDimension)} />
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-content-muted">No voice revenue or cost recorded in the last six months.</p>
      ) : (
        <div className="-mx-1 mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12.5px]">
            <thead className="text-content-muted">
              <tr>
                <th className="px-1 py-2 font-medium">{DIMENSIONS.find((d) => d.value === dimension)?.label}</th>
                <th className="px-1 py-2 text-right font-medium">Revenue</th>
                <th className="px-1 py-2 text-right font-medium">COGS</th>
                <th className="px-1 py-2 text-right font-medium">Gross profit</th>
                <th className="px-1 py-2 text-right font-medium">GM</th>
                <th className="px-1 py-2 text-right font-medium">Minutes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-[200px] truncate px-1 py-2 font-medium text-content">
                    {row.key}
                    {row.allocated && <span className="ml-1 text-[11px] font-normal text-content-subtle">allocated</span>}
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.revenueGbp)}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.cogsGbp)}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.grossProfitGbp)}</td>
                  <td className="px-1 py-2 text-right">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      {percent(row.gm)}
                      <StatusBadge kind="gm_health" value={gmHealth(row.gm)} dense dot={false} />
                    </span>
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums">{row.minutes === null ? "—" : row.minutes.toLocaleString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11.5px] leading-[1.45] text-content-subtle">
        Revenue is minute packs and the Pro voice item from the minute ledger; the £11.99 number item is billed on the subscription and is not in it, so number costs appear without their revenue (GM is understated, never overstated). COGS is the provider cost ledger (a provider figure replaces its estimate) plus Stripe fees. Provider, country and route have no revenue of their own: each workspace&apos;s revenue is allocated by billed minutes.
        {gm.unpricedLedgerRows > 0 && ` ${gm.unpricedLedgerRows} pack purchase(s) of an unknown size are excluded.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- simulator */

export function VoiceGmSimulator() {
  const [draft, setDraft] = React.useState({ price: "0", cogs: "0", number: "0", scenario: "stress" as SimulatorInput["scenario"] });
  const toMultiplier = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && n > -100 ? 1 + n / 100 : null;
  };
  const price = toMultiplier(draft.price);
  const cogs = toMultiplier(draft.cogs);
  const number = toMultiplier(draft.number);
  const rows =
    price !== null && cogs !== null && number !== null
      ? simulateVoicePackages({ priceMultiplier: price, cogsMultiplier: cogs, numberCostMultiplier: number, scenario: draft.scenario })
      : null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FormField label="Price change %" htmlFor="sim-price">
          <Input id="sim-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        </FormField>
        <FormField label="Provider cost change %" htmlFor="sim-cogs">
          <Input id="sim-cogs" inputMode="decimal" value={draft.cogs} onChange={(e) => setDraft({ ...draft, cogs: e.target.value })} />
        </FormField>
        <FormField label="Number cost change %" htmlFor="sim-number">
          <Input id="sim-number" inputMode="decimal" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} />
        </FormField>
        <FormField label="Cost scenario" htmlFor="sim-scenario">
          <SegmentedControl
            size="sm"
            items={[
              { value: "base", label: "Base" },
              { value: "stress", label: "Stress" },
            ]}
            value={draft.scenario}
            onChange={(v) => setDraft({ ...draft, scenario: v as SimulatorInput["scenario"] })}
          />
        </FormField>
        <div className="col-span-2 flex items-end sm:col-span-4">
          <Button size="xs" variant="ghost" onClick={() => setDraft({ price: "0", cogs: "0", number: "0", scenario: "stress" })}>
            <RotateCcw className="size-3" aria-hidden />
            Reset
          </Button>
        </div>
      </div>
      {rows === null ? (
        <p className="mt-3 text-[12.5px] text-danger-700">Enter each change as a percentage above -100.</p>
      ) : (
        <div className="-mx-1 mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12.5px]">
            <thead className="text-content-muted">
              <tr>
                <th className="px-1 py-2 font-medium">Package (every minute used)</th>
                <th className="px-1 py-2 text-right font-medium">Price</th>
                <th className="px-1 py-2 text-right font-medium">COGS</th>
                <th className="px-1 py-2 text-right font-medium">Stripe</th>
                <th className="px-1 py-2 text-right font-medium">GM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((row) => (
                <tr key={row.item}>
                  <td className="px-1 py-2 text-content">{row.item}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.priceGbp)}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.cogsGbp)}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{gbp(row.feeGbp)}</td>
                  <td className="px-1 py-2 text-right">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      {percent(row.gm)}
                      <StatusBadge kind="gm_health" value={gmHealth(row.gm)} dense dot={false} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-content-subtle">
        Read-only: it changes no price. Uses the unit-costs.ts voice model (standard UK card fees), so with no change it shows the tested margins. Floor {percent(VOICE_GM_FLOOR, 0)}.
      </p>
    </div>
  );
}
