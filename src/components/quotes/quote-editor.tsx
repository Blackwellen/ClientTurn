"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { calculateQuoteAction, createQuoteAction, updateQuoteDraftAction } from "@/lib/quotes/actions";
import { formatMinor } from "@/lib/quotes/money";
import { bpsToInput, parsePercentInput } from "@/lib/quotes/money-input";
import type { CatalogueBundle, CatalogueItem } from "@/lib/catalogue/types";
import type { LeadOpportunityOption } from "@/lib/quotes/queries";
import type { PaymentTerms, QuoteCalculation, QuoteLineInput } from "@/lib/quotes/types";
import type { QuoteDetail } from "./lead-quotes-panel";

type LineDraft = { lineId: string; ref: string; quantity: string; discount: string; parentLineId: string };
type Balance = "ON_ACCEPTANCE" | "ON_COMPLETION" | "DAYS_30";

let counter = 0;
const nextLineId = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * The draft quote editor. Lines come only from the catalogue (an item or a
 * bundle, a quantity, an optional line discount); every total on screen is
 * from `quote.calculate` (the one price engine), recalculated as the draft
 * changes. Nothing here computes a price.
 */
export function QuoteEditor({
  leadId,
  currency,
  items,
  bundles,
  opportunities,
  existing,
  defaultDepositBps,
  onClose,
  onSaved,
}: {
  leadId: string;
  currency: string;
  items: CatalogueItem[];
  bundles: CatalogueBundle[];
  opportunities: LeadOpportunityOption[];
  existing: QuoteDetail | null;
  defaultDepositBps: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const requestId = React.useMemo(() => crypto.randomUUID(), []);
  const content = existing?.current?.content;
  const [title, setTitle] = React.useState(existing?.quote.title ?? opportunities[0]?.name ?? "");
  const [opportunityId, setOpportunityId] = React.useState(existing?.quote.opportunityId ?? opportunities[0]?.id ?? "");
  const [lines, setLines] = React.useState<LineDraft[]>(() =>
    content
      ? content.lines.map((line) => ({
          lineId: line.lineId,
          ref: line.kind === "ITEM" ? `item:${line.itemId}` : `bundle:${line.bundleId}`,
          quantity: String(line.quantity),
          discount: line.discount?.type === "PERCENT" ? bpsToInput(line.discount.bps) : "",
          parentLineId: line.kind === "ITEM" ? (line.parentLineId ?? "") : "",
        }))
      : [{ lineId: nextLineId(), ref: items[0] ? `item:${items[0].id}` : "", quantity: "1", discount: "", parentLineId: "" }],
  );
  const [quoteDiscount, setQuoteDiscount] = React.useState(content?.quoteDiscount?.type === "PERCENT" ? bpsToInput(content.quoteDiscount.bps) : "");
  const [deposit, setDeposit] = React.useState(
    content?.payment?.deposit?.type === "PERCENT" ? bpsToInput(content.payment.deposit.bps) : content ? "" : bpsToInput(defaultDepositBps),
  );
  const [balance, setBalance] = React.useState<Balance>(() => {
    const due = content?.payment?.remainder.type === "SINGLE" ? content.payment.remainder.due : null;
    if (due?.type === "ON_COMPLETION") return "ON_COMPLETION";
    if (due?.type === "DAYS_AFTER_ACCEPTANCE") return "DAYS_30";
    return "ON_ACCEPTANCE";
  });
  const [note, setNote] = React.useState(content?.customerNote ?? "");
  const [calc, setCalc] = React.useState<{ calculation: QuoteCalculation; approval: { required: boolean; detail: string } } | null>(null);
  const [serverCalcError, setCalcError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const itemById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const built = React.useMemo(() => build(lines, quoteDiscount, deposit, balance), [lines, quoteDiscount, deposit, balance]);

  const calcError = typeof built === "string" ? built : serverCalcError;

  React.useEffect(() => {
    if (typeof built === "string") return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await calculateQuoteAction({ ...built, customerNote: note || null });
      if (cancelled) return;
      if (!result.ok) {
        setCalc(null);
        setCalcError(result.error);
        return;
      }
      const data = result.data as { ok: boolean; issues?: { message: string }[]; calculation?: QuoteCalculation; approval?: { required: boolean; detail: string } };
      if (!data.ok || !data.calculation || !data.approval) {
        setCalc(null);
        setCalcError(data.issues?.[0]?.message ?? "Those lines could not be priced.");
        return;
      }
      setCalcError(null);
      setCalc({ calculation: data.calculation, approval: data.approval });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [built, note]);

  async function save() {
    if (typeof built === "string") return;
    if (!title.trim()) return setCalcError("Give the quote a title.");
    setSaving(true);
    const result = existing
      ? await updateQuoteDraftAction({
          leadId,
          quoteId: existing.quote.id,
          title: title.trim(),
          lines: built.lines,
          quoteDiscount: built.quoteDiscount ?? null,
          payment: built.payment ?? null,
          customerNote: note.trim() || null,
          expectedRevisionId: existing.current?.id,
        })
      : await createQuoteAction({
          leadId,
          opportunityId,
          title: title.trim(),
          lines: built.lines,
          ...(built.quoteDiscount ? { quoteDiscount: built.quoteDiscount } : {}),
          ...(built.payment ? { payment: built.payment } : {}),
          customerNote: note.trim() || null,
          requestId,
        });
    setSaving(false);
    if (!result.ok) {
      setCalcError(result.error);
      return;
    }
    toast({ variant: "success", title: existing ? "Draft saved" : "Draft quote created", description: result.warnings[0] });
    onSaved();
  }

  const t = typeof built === "string" ? undefined : calc?.calculation;
  const parentOptions = lines.filter((l) => l.ref.startsWith("item:") && (itemById.get(l.ref.slice(5))?.addOnItemIds.length ?? 0) > 0);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={existing ? `Edit ${existing.quote.number}` : "New quote"}
      description="Prices, VAT and totals come from your catalogue and are calculated for you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={typeof built === "string" || !calc}>
            {existing ? "Save draft" : "Create draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Title" htmlFor="qe-title" required>
            <Input id="qe-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </FormField>
          {!existing && opportunities.length > 1 && (
            <FormField label="For" htmlFor="qe-opp">
              <Select native id="qe-opp" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </FormField>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-content">Lines</legend>
          {lines.map((line, index) => {
            const item = line.ref.startsWith("item:") ? itemById.get(line.ref.slice(5)) : undefined;
            const isAddOnCandidate = item && parentOptions.some((p) => p.lineId !== line.lineId && itemById.get(p.ref.slice(5))?.addOnItemIds.includes(item.id));
            return (
              <div key={line.lineId} className="grid grid-cols-[minmax(0,1fr)_72px_76px_auto] items-end gap-2 rounded-lg border border-line-subtle p-2 sm:grid-cols-[minmax(0,1fr)_80px_90px_auto]">
                <FormField label={index === 0 ? "Item" : ""} htmlFor={`qe-ref-${index}`}>
                  <Select native id={`qe-ref-${index}`} aria-label="Item" value={line.ref} onChange={(e) => setLines(lines.map((l) => (l.lineId === line.lineId ? { ...l, ref: e.target.value, parentLineId: "" } : l)))}>
                    {items.map((i) => (
                      <option key={i.id} value={`item:${i.id}`}>{i.name} ({formatMinor(i.unitPriceMinor, currency)} / {i.unit})</option>
                    ))}
                    {bundles.map((b) => (
                      <option key={b.id} value={`bundle:${b.id}`}>Bundle: {b.name}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={index === 0 ? "Qty" : ""} htmlFor={`qe-qty-${index}`}>
                  <Input id={`qe-qty-${index}`} aria-label="Quantity" inputMode="decimal" value={line.quantity} onChange={(e) => setLines(lines.map((l) => (l.lineId === line.lineId ? { ...l, quantity: e.target.value } : l)))} />
                </FormField>
                <FormField label={index === 0 ? "Disc. %" : ""} htmlFor={`qe-disc-${index}`}>
                  <Input id={`qe-disc-${index}`} aria-label="Line discount percent" inputMode="decimal" placeholder="0" value={line.discount} onChange={(e) => setLines(lines.map((l) => (l.lineId === line.lineId ? { ...l, discount: e.target.value } : l)))} />
                </FormField>
                <Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((l) => l.lineId !== line.lineId).map((l) => (l.parentLineId === line.lineId ? { ...l, parentLineId: "" } : l)))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
                {(isAddOnCandidate || item?.addOnOnly) && (
                  <div className="col-span-4">
                    <Select native aria-label="Add-on to" value={line.parentLineId} onChange={(e) => setLines(lines.map((l) => (l.lineId === line.lineId ? { ...l, parentLineId: e.target.value } : l)))}>
                      <option value="">Not an add-on</option>
                      {parentOptions.filter((p) => p.lineId !== line.lineId).map((p) => (
                        <option key={p.lineId} value={p.lineId}>Add-on to {itemById.get(p.ref.slice(5))?.name}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
          <Button variant="secondary" size="xs" onClick={() => setLines([...lines, { lineId: nextLineId(), ref: items[0] ? `item:${items[0].id}` : "", quantity: "1", discount: "", parentLineId: "" }])} disabled={lines.length >= 50}>
            <Plus className="size-3.5" aria-hidden /> Add line
          </Button>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Quote discount (%)" htmlFor="qe-qd" hint="On the whole quote.">
            <Input id="qe-qd" inputMode="decimal" placeholder="0" value={quoteDiscount} onChange={(e) => setQuoteDiscount(e.target.value)} />
          </FormField>
          <FormField label="Deposit (%)" htmlFor="qe-dep" hint="Of the one-off total.">
            <Input id="qe-dep" inputMode="decimal" placeholder="None" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </FormField>
          <FormField label={deposit.trim() ? "Balance due" : "Payment due"} htmlFor="qe-bal">
            <Select native id="qe-bal" value={balance} onChange={(e) => setBalance(e.target.value as Balance)}>
              <option value="ON_ACCEPTANCE">On acceptance</option>
              <option value="ON_COMPLETION">On completion</option>
              <option value="DAYS_30">30 days after acceptance</option>
            </Select>
          </FormField>
        </div>

        <FormField label="Note to the customer" htmlFor="qe-note" hint="Optional. Shown on the quote.">
          <Textarea id="qe-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </FormField>

        <div className="rounded-lg border border-line bg-surface-sunken/60 p-3" aria-live="polite">
          {calcError ? (
            <p role="alert" className="text-[13px] text-danger-700">{calcError}</p>
          ) : !t ? (
            <p className="text-[13px] text-content-muted">Calculating…</p>
          ) : (
            <dl className="space-y-1 text-[13px]">
              <Row label="List price" value={formatMinor(t.totals.listMinor, currency)} />
              {t.totals.discountMinor > 0 && <Row label="Discounts" value={`−${formatMinor(t.totals.discountMinor, currency)}`} />}
              <Row label="Net" value={formatMinor(t.totals.netMinor, currency)} />
              {t.vatRegistered && <Row label="VAT" value={formatMinor(t.totals.vatMinor, currency)} />}
              <Row label={t.recurring.length ? "Total (incl. first period)" : "Total"} value={formatMinor(t.totals.grossMinor, currency)} strong />
              {t.depositMinor > 0 && <Row label="Deposit on acceptance" value={formatMinor(t.depositMinor, currency)} />}
              <Row label="Due on acceptance" value={formatMinor(t.firstPaymentMinor, currency)} />
              {t.margin && typeof t.margin.marginBps === "number" && <Row label="Margin (internal)" value={`${(t.margin.marginBps / 100).toFixed(1)}%${t.margin.complete ? "" : " (some costs unknown)"}`} />}
              {calc?.approval.required && (
                <p className="pt-1 text-[12.5px] text-warning-700" role="status">Needs approval before sending: {calc.approval.detail}</p>
              )}
            </dl>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "font-semibold text-content" : "text-content-secondary"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-content" : "text-content"}`}>{value}</dd>
    </div>
  );
}

/** The editor's fields as the calculator's input, or a sentence saying what is wrong. */
function build(lines: LineDraft[], quoteDiscount: string, deposit: string, balance: Balance): { lines: QuoteLineInput[]; quoteDiscount?: { type: "PERCENT"; bps: number; scope: "ALL" }; payment?: PaymentTerms } | string {
  const out: QuoteLineInput[] = [];
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!line.ref) return "Choose an item for every line.";
    if (!(quantity > 0)) return "Every line needs a quantity above zero.";
    const discountBps = line.discount.trim() ? parsePercentInput(line.discount) : null;
    if (line.discount.trim() && discountBps === null) return "Line discounts are percentages, e.g. 10.";
    const discount = discountBps ? { type: "PERCENT" as const, bps: discountBps } : undefined;
    if (line.ref.startsWith("bundle:")) {
      if (!Number.isInteger(quantity)) return "Bundles are sold in whole numbers.";
      out.push({ lineId: line.lineId, kind: "BUNDLE", bundleId: line.ref.slice(7), quantity, ...(discount ? { discount } : {}) });
    } else {
      out.push({
        lineId: line.lineId,
        kind: "ITEM",
        itemId: line.ref.slice(5),
        quantity,
        optionIds: [],
        ...(line.parentLineId ? { parentLineId: line.parentLineId } : {}),
        ...(discount ? { discount } : {}),
      });
    }
  }
  const qd = quoteDiscount.trim() ? parsePercentInput(quoteDiscount) : null;
  if (quoteDiscount.trim() && qd === null) return "The quote discount is a percentage, e.g. 5.";
  const dep = deposit.trim() ? parsePercentInput(deposit) : null;
  if (deposit.trim() && (dep === null || dep === 0)) return "The deposit is a percentage, e.g. 50.";
  const due =
    balance === "ON_COMPLETION" ? { type: "ON_COMPLETION" as const } : balance === "DAYS_30" ? { type: "DAYS_AFTER_ACCEPTANCE" as const, days: 30 } : { type: "ON_ACCEPTANCE" as const };
  const payment: PaymentTerms | undefined =
    dep || balance !== "ON_ACCEPTANCE"
      ? { ...(dep ? { deposit: { type: "PERCENT" as const, bps: dep } } : {}), remainder: { type: "SINGLE", due }, recurringBilledUpfront: true }
      : undefined;
  return {
    lines: out,
    ...(qd ? { quoteDiscount: { type: "PERCENT" as const, bps: qd, scope: "ALL" as const } } : {}),
    ...(payment ? { payment } : {}),
  };
}
