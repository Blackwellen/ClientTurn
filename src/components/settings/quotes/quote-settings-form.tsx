"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import Link from "next/link";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { saveQuoteSettings } from "@/lib/quotes/settings-actions";
import { bpsToInput, minorToInput, parseMoneyInput, parsePercentInput } from "@/lib/quotes/money-input";
import type { QuoteSettings } from "@/lib/quotes/settings";
import type { ApprovalRule } from "@/lib/quotes/discount-policy";
import { INVOICE_PAY_MODE_LABEL, INVOICE_PAY_MODES, payLinkProblem, payLinkSettlementNote, type InvoicePayMode } from "@/lib/invoicing/pay-link";

type Capability = { allowed: boolean; message: string | null };

/**
 * Settings -> Quotes & invoices: the business on the document, the defaults
 * every new quote starts from, and (behind "More options") numbering,
 * signatures, reminders and approval rules. Owners and admins edit; everyone
 * else sees the same values read-only. The server re-validates everything
 * (quote_settings.update).
 */
export function QuoteSettingsForm({
  settings,
  business,
  canEdit,
  esign,
  approvals,
}: {
  settings: QuoteSettings;
  business: { name: string; logoUrl: string | null };
  canEdit: boolean;
  esign: Capability;
  approvals: Capability;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState(() => toDraft(settings));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [more, setMore] = React.useState(false);
  const initial = React.useMemo(() => JSON.stringify(toDraft(settings)), [settings]);
  const dirty = JSON.stringify(draft) !== initial;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setError(null);
    const payload = fromDraft(draft);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }
    setSaving(true);
    const result = await saveQuoteSettings(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({ variant: "success", title: "Quote settings saved", description: result.warnings[0] });
  }

  const disabled = !canEdit || saving;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Your business on quotes and invoices</CardTitle>
          <CardDescription>What every quote and invoice shows, and the defaults a new quote starts from.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="quote-brand" className="flex items-center gap-3 rounded-lg border border-line-subtle bg-surface-sunken/50 p-3">
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset
              <img src={business.logoUrl} alt="" className="size-full object-contain" />
            ) : (
              <span className="text-[15px] font-semibold text-content-muted">{business.name.slice(0, 1).toUpperCase() || "?"}</span>
            )}
          </span>
          <div className="min-w-0">
            <p id="quote-brand" className="truncate text-[13.5px] font-semibold text-content">{business.name || "Your business"}</p>
            <p className="text-[12.5px] text-content-muted">
              The logo comes from your business profile.{" "}
              <Link href="/app/settings?section=workspace" className="font-medium text-content-accent underline-offset-4 hover:underline">
                Change it in Workspace
              </Link>
            </p>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Legal name" htmlFor="qs-legal" hint="As registered, if different from your trading name.">
            <Input id="qs-legal" value={draft.legalName} onChange={(e) => set("legalName", e.target.value)} disabled={disabled} maxLength={200} />
          </FormField>
          <FormField label="Company number" htmlFor="qs-company" hint="Companies House, 8 characters.">
            <Input id="qs-company" value={draft.companyNumber} onChange={(e) => set("companyNumber", e.target.value)} disabled={disabled} maxLength={8} />
          </FormField>
          <FormField label="Business address" htmlFor="qs-address" hint="One line per row. Required on a VAT invoice." className="sm:col-span-2">
            <Textarea id="qs-address" rows={3} value={draft.address} onChange={(e) => set("address", e.target.value)} disabled={disabled} />
          </FormField>
        </div>

        <div className="space-y-3 rounded-lg border border-line-subtle p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13.5px] font-medium text-content">VAT registered</p>
              <p className="text-[12.5px] text-content-muted">Off: no VAT is charged or shown, and quotes say so.</p>
            </div>
            <Switch checked={draft.vatRegistered} onCheckedChange={(v) => set("vatRegistered", v)} disabled={disabled} label="VAT registered" />
          </div>
          {draft.vatRegistered && (
            <FormField label="VAT number" htmlFor="qs-vat" required hint="GB followed by 9 or 12 digits.">
              <Input id="qs-vat" value={draft.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} disabled={disabled} placeholder="GB123456789" />
            </FormField>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Quotes valid for (days)" htmlFor="qs-validity">
            <Input id="qs-validity" inputMode="numeric" value={draft.validityDays} onChange={(e) => set("validityDays", e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="Payment terms (days)" htmlFor="qs-terms-days" hint="From each invoice.">
            <Input id="qs-terms-days" inputMode="numeric" value={draft.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="Default deposit (%)" htmlFor="qs-deposit" hint="Blank for none.">
            <Input id="qs-deposit" inputMode="decimal" value={draft.deposit} onChange={(e) => set("deposit", e.target.value)} disabled={disabled} placeholder="e.g. 50" />
          </FormField>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-line-subtle p-4" aria-describedby="qs-pay-help">
          <legend className="px-1 text-[13.5px] font-semibold text-content">How invoices are paid</legend>
          <p id="qs-pay-help" className="text-[12.5px] text-content-muted">
            For invoices only. Customers pay you directly, through your own Stripe account; ClientTurn never holds the money. With a link set, each invoice email and the invoice on the quote page show a Pay now button, and a payment through it is recorded on the invoice automatically.
          </p>
          <p className="text-[12.5px] text-content-muted">
            Fixed-price checkout links (the ones the assistant sends when a lead is ready to buy, and the pay step straight after a quote is accepted) are set separately in{" "}
            <Link href="/app/settings?section=business-profile" className="font-medium text-content-accent underline-offset-4 hover:underline">
              Business Profile, Direct close
            </Link>
            .
          </p>
          <FormField label="Payment method" htmlFor="qs-pay-mode">
            <Select native id="qs-pay-mode" value={draft.payMode} onChange={(e) => set("payMode", e.target.value as InvoicePayMode)} disabled={disabled}>
              {INVOICE_PAY_MODES.map((mode) => (
                <option key={mode} value={mode}>{INVOICE_PAY_MODE_LABEL[mode]}</option>
              ))}
            </Select>
          </FormField>
          {draft.payMode === "WORKSPACE_LINK" && (
            <FormField
              label="Stripe Payment Link"
              htmlFor="qs-pay-link"
              required
              hint={'In your Stripe dashboard, create a Payment Link and choose "Let customers choose what to pay", so the customer enters the amount on the invoice.'}
            >
              <Input id="qs-pay-link" value={draft.payLink} onChange={(e) => set("payLink", e.target.value)} disabled={disabled} maxLength={2000} placeholder="https://buy.stripe.com/..." />
            </FormField>
          )}
          {draft.payMode === "PER_INVOICE" && (
            <p className="text-[12.5px] text-content-muted">Add a link to each invoice from the lead page (Quotes, then Add pay link). An invoice without one shows no pay button.</p>
          )}
          {draft.payMode === "WORKSPACE_LINK" && payLinkSettlementNote(draft.payLink.trim()) && (
            <p className="text-[12.5px] text-content-muted">{payLinkSettlementNote(draft.payLink.trim())}</p>
          )}
          {draft.payMode !== "NONE" && (
            <p className="text-[12.5px] text-content-muted">
              Payments are read from your Stripe webhook.{" "}
              <Link href="/app/settings?section=connections#payments" className="font-medium text-content-accent underline-offset-4 hover:underline">
                Connect it in Connections
              </Link>
              . A payment without the invoice&apos;s reference, or in another currency, waits for you to check it.
            </p>
          )}
        </fieldset>

        <FormField label="Quote terms" htmlFor="qs-terms" hint="Printed on every quote and its PDF. Frozen into each quote when it is sent.">
          <Textarea id="qs-terms" rows={4} value={draft.termsText} onChange={(e) => set("termsText", e.target.value)} disabled={disabled} maxLength={20000} />
        </FormField>

        <div>
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            className="inline-flex items-start gap-1.5 rounded-xs text-left text-[13px] font-medium text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
          >
            <ChevronDown className={cn("mt-0.5 size-4 shrink-0 transition-transform", more && "rotate-180")} aria-hidden />
            {more ? "Fewer options" : "More options: numbering, signatures, reminders, approvals"}
          </button>
        </div>

        {more && (
          <div className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="text-[13.5px] font-semibold text-content">Numbering</legend>
              <p className="text-[12.5px] text-content-muted">Numbers are allocated when a quote is created and when an invoice is issued. Gaps can occur; numbers are never reused.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Quote prefix" htmlFor="qs-pq">
                  <Input id="qs-pq" value={draft.prefixQuote} onChange={(e) => set("prefixQuote", e.target.value.toUpperCase())} disabled={disabled} maxLength={16} />
                </FormField>
                <FormField label="Invoice prefix" htmlFor="qs-pi">
                  <Input id="qs-pi" value={draft.prefixInvoice} onChange={(e) => set("prefixInvoice", e.target.value.toUpperCase())} disabled={disabled} maxLength={16} />
                </FormField>
                <FormField label="Credit note prefix" htmlFor="qs-pc">
                  <Input id="qs-pc" value={draft.prefixCredit} onChange={(e) => set("prefixCredit", e.target.value.toUpperCase())} disabled={disabled} maxLength={16} />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[13.5px] font-semibold text-content">Signatures</legend>
              {esign.allowed ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px] text-content-muted">
                    Customers always sign by typing their name and ticking the consent box (a simple electronic signature with audit trail). Turn this on to also ask for a drawn signature.
                  </p>
                  <Switch checked={draft.requireDrawn} onCheckedChange={(v) => set("requireDrawn", v)} disabled={disabled} label="Ask for a drawn signature" />
                </div>
              ) : (
                <p className="text-[12.5px] text-content-muted">{esign.message ?? "E-signatures are not on your plan."} Customers can still accept a quote with their name.</p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[13.5px] font-semibold text-content">Reminders</legend>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12.5px] text-content-muted">Remind a customer who has not accepted a sent quote (after 3 days, and 2 days before it expires). Reminders respect your contact-frequency limits.</p>
                <Switch checked={draft.nudges} onCheckedChange={(v) => set("nudges", v)} disabled={disabled} label="Quote reminders" />
              </div>
              <FormField label="Invoice reminders (days from the due date)" htmlFor="qs-rem" hint="Negative is before the due date, e.g. -3, 0, 3, 7, 14. Weekends move to Monday.">
                <Input id="qs-rem" value={draft.reminderOffsets} onChange={(e) => set("reminderOffsets", e.target.value)} disabled={disabled} />
              </FormField>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[13.5px] font-semibold text-content">Approvals</legend>
              {approvals.allowed ? (
                <ApprovalRules rules={draft.rules} onChange={(rules) => set("rules", rules)} disabled={disabled} />
              ) : (
                <p className="text-[12.5px] text-content-muted">{approvals.message ?? "Approval rules are not on your plan."}</p>
              )}
            </fieldset>
          </div>
        )}

        <FormError message={error} />
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-end">
          <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={() => setDraft(toDraft(settings))}>
            Discard
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save quote settings
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

type RuleDraft = { id: string; kind: "discount" | "value"; amount: string; role: "admin" | "owner" };

function ApprovalRules({ rules, onChange, disabled }: { rules: RuleDraft[]; onChange: (rules: RuleDraft[]) => void; disabled: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-content-muted">
        A quote that matches a rule waits for approval before it can be sent. Owners and admins whose role meets the rule are not held up by it; the assistant always is.
      </p>
      {rules.length === 0 && <p className="text-[12.5px] text-content-subtle">No rules. Any member can send any quote.</p>}
      {rules.map((rule, index) => (
        <div key={rule.id} className="flex flex-wrap items-end gap-2">
          <FormField label="When" htmlFor={`rule-kind-${index}`} className="min-w-40 flex-1">
            <Select
              native
              id={`rule-kind-${index}`}
              value={rule.kind}
              disabled={disabled}
              onChange={(e) => onChange(rules.map((r, i) => (i === index ? { ...r, kind: e.target.value as RuleDraft["kind"] } : r)))}
            >
              <option value="discount">Discount above (%)</option>
              <option value="value">Quote value above (£, before VAT)</option>
            </Select>
          </FormField>
          <FormField label={rule.kind === "discount" ? "Percent" : "Amount"} htmlFor={`rule-amount-${index}`} className="w-32">
            <Input
              id={`rule-amount-${index}`}
              inputMode="decimal"
              value={rule.amount}
              disabled={disabled}
              onChange={(e) => onChange(rules.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
            />
          </FormField>
          <FormField label="Approved by" htmlFor={`rule-role-${index}`} className="w-36">
            <Select
              native
              id={`rule-role-${index}`}
              value={rule.role}
              disabled={disabled}
              onChange={(e) => onChange(rules.map((r, i) => (i === index ? { ...r, role: e.target.value as RuleDraft["role"] } : r)))}
            >
              <option value="admin">Owner or admin</option>
              <option value="owner">Owner only</option>
            </Select>
          </FormField>
          <Button variant="ghost" size="sm" aria-label="Remove rule" disabled={disabled} onClick={() => onChange(rules.filter((_, i) => i !== index))}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      {rules.length < 10 && (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onChange([...rules, { id: `rule-${Date.now().toString(36)}`, kind: "discount", amount: "10", role: "admin" }])}>
          <Plus className="size-4" aria-hidden />
          Add rule
        </Button>
      )}
    </div>
  );
}

type Draft = {
  legalName: string;
  companyNumber: string;
  address: string;
  vatRegistered: boolean;
  vatNumber: string;
  validityDays: string;
  paymentTermsDays: string;
  deposit: string;
  termsText: string;
  prefixQuote: string;
  prefixInvoice: string;
  prefixCredit: string;
  requireDrawn: boolean;
  nudges: boolean;
  reminderOffsets: string;
  rules: RuleDraft[];
  payMode: InvoicePayMode;
  payLink: string;
  // Kept as-is: fields this form does not edit.
  keep: Pick<QuoteSettings, "currency" | "discountPolicy">;
};

function toDraft(s: QuoteSettings): Draft {
  return {
    legalName: s.legalName ?? "",
    companyNumber: s.companyNumber ?? "",
    address: s.addressLines.join("\n"),
    vatRegistered: s.vatRegistered,
    vatNumber: s.vatNumber ?? "",
    validityDays: String(s.validityDays),
    paymentTermsDays: String(s.paymentTermsDays),
    deposit: bpsToInput(s.defaultDepositBps),
    termsText: s.termsText,
    prefixQuote: s.prefixes.quote,
    prefixInvoice: s.prefixes.invoice,
    prefixCredit: s.prefixes.creditNote,
    requireDrawn: s.requireDrawnSignature,
    nudges: s.quoteNudgesEnabled,
    reminderOffsets: s.reminderOffsets.join(", "),
    payMode: s.invoicePayMode,
    payLink: s.invoicePayLinkUrl ?? "",
    rules: s.discountPolicy.approvalRules.map((rule) => ({
      id: rule.id,
      kind: rule.valueAboveMinor !== undefined ? "value" : "discount",
      amount: rule.valueAboveMinor !== undefined ? minorToInput(rule.valueAboveMinor) : bpsToInput(rule.discountAboveBps ?? 0),
      role: rule.role,
    })),
    keep: { currency: s.currency, discountPolicy: s.discountPolicy },
  };
}

/** The draft as the operation's input, or a sentence saying what is wrong. */
function fromDraft(d: Draft): Record<string, unknown> | string {
  const int = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN);
  const validityDays = int(d.validityDays);
  const paymentTermsDays = int(d.paymentTermsDays);
  if (!Number.isFinite(validityDays)) return "Quotes valid for: enter a whole number of days.";
  if (!Number.isFinite(paymentTermsDays)) return "Payment terms: enter a whole number of days.";
  const deposit = d.deposit.trim() === "" ? null : parsePercentInput(d.deposit);
  if (d.deposit.trim() !== "" && (deposit === null || deposit === 0)) return "Default deposit: enter a percentage, e.g. 50.";
  const offsets = d.reminderOffsets.split(",").map((part) => part.trim()).filter(Boolean).map(Number);
  if (offsets.some((n) => !Number.isInteger(n))) return "Invoice reminders: whole numbers separated by commas, e.g. -3, 0, 7.";
  const payLink = d.payLink.trim();
  if (d.payMode === "WORKSPACE_LINK" && !payLink) return "How invoices are paid: paste your Stripe Payment Link, or choose bank transfer only.";
  const payProblem = payLink ? payLinkProblem(payLink) : null;
  if (payProblem && d.payMode === "WORKSPACE_LINK") return `Payment link: ${payProblem}`;
  const rules: ApprovalRule[] = [];
  for (const rule of d.rules) {
    if (rule.kind === "discount") {
      const bps = parsePercentInput(rule.amount);
      if (bps === null) return "Approval rules: enter the discount as a percentage.";
      rules.push({ id: rule.id, discountAboveBps: bps, role: rule.role });
    } else {
      const minor = parseMoneyInput(rule.amount);
      if (minor === null) return "Approval rules: enter the quote value in pounds.";
      rules.push({ id: rule.id, valueAboveMinor: minor, role: rule.role });
    }
  }
  return {
    currency: d.keep.currency,
    vatRegistered: d.vatRegistered,
    vatNumber: d.vatRegistered ? d.vatNumber.trim() || null : null,
    legalName: d.legalName.trim() || null,
    companyNumber: d.companyNumber.trim() || null,
    addressLines: d.address.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 6),
    validityDays,
    paymentTermsDays,
    defaultDepositBps: deposit,
    termsText: d.termsText,
    reminderOffsets: offsets,
    discountPolicy: { ...d.keep.discountPolicy, approvalRules: rules },
    requireDrawnSignature: d.requireDrawn,
    quoteNudgesEnabled: d.nudges,
    invoicePayMode: d.payMode,
    // A link that is not valid is not kept once the mode no longer uses it.
    invoicePayLinkUrl: payLink && !payProblem ? payLink : null,
    prefixes: { quote: d.prefixQuote.trim(), invoice: d.prefixInvoice.trim(), creditNote: d.prefixCredit.trim() },
  };
}
