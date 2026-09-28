"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, FileSignature, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatMinor } from "@/lib/quotes/money";
import { parseMoneyInput } from "@/lib/quotes/money-input";
import { formatDocumentDate } from "@/lib/quotes/document";
import {
  invoiceQuoteAction,
  issueInvoiceAction,
  quoteStepAction,
  recordPaymentAction,
  sendQuoteAction,
  setInvoicePayLinkAction,
  withdrawQuoteAction,
} from "@/lib/quotes/actions";
import type { CatalogueBundle, CatalogueItem } from "@/lib/catalogue/types";
import type { getQuote } from "@/lib/quotes/service-core";
import type { CapabilityView, LeadInvoiceView, LeadOpportunityOption } from "@/lib/quotes/queries";
import { payLinkProblem, type InvoicePayMode } from "@/lib/invoicing/pay-link";
import { QuoteEditor } from "./quote-editor";

export type QuoteDetail = Awaited<ReturnType<typeof getQuote>>;

export type QuoteCardData = {
  leadId: string;
  currency: string;
  role: "owner" | "admin" | "member" | "viewer";
  canWrite: boolean;
  capabilities: { builder: CapabilityView; esign: CapabilityView; approvals: CapabilityView; invoicing: CapabilityView; directClose: CapabilityView };
  opportunities: LeadOpportunityOption[];
  items: CatalogueItem[];
  bundles: CatalogueBundle[];
  quotes: QuoteDetail[];
  invoices: LeadInvoiceView[];
  defaultDepositBps: number | null;
  /** 0173: how invoices are paid online (Settings -> Quotes & invoices). */
  invoicePayMode: InvoicePayMode;
};

const EVENT_LABEL: Record<string, string> = {
  "quote.requested": "Requested by the lead",
  "quote.created": "Created",
  "quote.approval_requested": "Sent for approval",
  "quote.approved": "Approved",
  "quote.approval_rejected": "Approval rejected",
  "quote.sent": "Sent to the customer",
  "quote.viewed": "Opened by the customer",
  "quote.accepted": "Accepted",
  "quote.declined": "Declined",
  "quote.signed": "Signed",
  "quote.expired": "Expired",
  "quote.revised": "Revised",
  "quote.withdrawn": "Withdrawn",
  "quote.reminded": "Reminder sent",
  "quote.deposit_paid": "Deposit paid",
  "quote.paid": "Paid in full",
  "quote.won": "Won",
};

const INVOICEABLE = ["ACCEPTED", "SIGNED", "DEPOSIT_PAID", "PAID"];

/**
 * The Quotes card on the lead page (client half). Every button runs one
 * service operation through a server action; the ones that leave the
 * building or cannot be undone (send, withdraw, invoicing, payments) are
 * behind a confirmation dialog, which is the only place `confirmed` is set.
 */
export function LeadQuotesPanel({ data }: { data: QuoteCardData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<QuoteDetail | "new" | null>(null);
  const [open, setOpen] = React.useState<string | null>(data.quotes[0]?.quote.id ?? null);
  const [sending, setSending] = React.useState<QuoteDetail | null>(null);
  const [channel, setChannel] = React.useState<"email" | "link">("email");
  const [sentLink, setSentLink] = React.useState<{ quoteId: string; url: string } | null>(null);
  const [withdrawing, setWithdrawing] = React.useState<QuoteDetail | null>(null);
  const [reason, setReason] = React.useState("");
  const [invoicing, setInvoicing] = React.useState<QuoteDetail | null>(null);
  const [autoIssue, setAutoIssue] = React.useState(true);
  const [issuing, setIssuing] = React.useState<LeadInvoiceView | null>(null);
  const [paying, setPaying] = React.useState<LeadInvoiceView | null>(null);
  const [linking, setLinking] = React.useState<LeadInvoiceView | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const isAdmin = data.role === "owner" || data.role === "admin";
  const openOpportunities = data.opportunities.filter((o) => o.outcome === "OPEN");
  const canCreate = data.canWrite && openOpportunities.length > 0 && data.items.length > 0;

  function done(result: { ok: boolean; error?: string; warnings?: string[] }, success: string) {
    if (result.ok) {
      toast({ variant: "success", title: success, description: result.warnings?.[0] });
      router.refresh();
    } else {
      toast({ variant: "error", title: "That did not work", description: result.error });
    }
  }

  async function step(quote: QuoteDetail, name: "submit_for_approval" | "approve" | "reject" | "revise", success: string) {
    setBusy(`${quote.quote.id}:${name}`);
    const result = await quoteStepAction({ leadId: data.leadId, quoteId: quote.quote.id, step: name });
    setBusy(null);
    done(result, success);
    if (result.ok && name === "revise") {
      router.refresh();
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface" aria-label="Quotes">
      <header className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
        <FileSignature className="size-4 text-content-muted" aria-hidden />
        <h2 className="flex-1 text-[13px] font-semibold text-content">Quotes</h2>
        {canCreate && (
          <Button size="xs" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden />
            New quote
          </Button>
        )}
      </header>

      {data.items.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="status">
          Your catalogue is empty, so there is nothing to quote from yet.{" "}
          <Link href="/app/settings?section=quotes" className="font-medium text-content-accent underline-offset-4 hover:underline">
            {isAdmin ? "Add your products and prices" : "Ask an owner or admin to add products"}
          </Link>
        </p>
      ) : data.quotes.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="status">
          {openOpportunities.length === 0
            ? "This lead has no open opportunity to quote for."
            : data.canWrite
              ? "No quotes yet. Build one from your catalogue; totals and VAT are calculated for you."
              : "No quotes yet."}
        </p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {data.quotes.map((detail) => {
            const q = detail.quote;
            const current = detail.current;
            const expanded = open === q.id;
            const totals = current?.calculation.totals;
            const invoices = data.invoices.filter((inv) => inv.quoteId === q.id);
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : q.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-2 px-5 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-content">
                        {q.number} · {q.title}
                      </span>
                      <StatusBadge kind="quote" value={q.status} dense />
                    </div>
                    <p className="mt-0.5 text-[12px] text-content-muted">
                      {totals ? formatMinor(totals.grossMinor, q.currency) : ""}
                      {current && current.revisionNo > 1 ? ` · revision ${current.revisionNo}` : ""}
                      {current?.validUntil ? ` · valid until ${formatDocumentDate(current.validUntil)}` : ""}
                    </p>
                  </div>
                  <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-content-muted transition-transform", expanded && "rotate-180")} aria-hidden />
                </button>

                {expanded && current && (
                  <div className="space-y-3 px-5 pb-4">
                    <ul className="space-y-1 text-[12.5px] text-content-secondary">
                      {current.calculation.lines.slice(0, 6).map((line) => (
                        <li key={line.lineId} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">{line.description}</span>
                          <span className="tabular-nums">{formatMinor(line.netMinor, q.currency)}</span>
                        </li>
                      ))}
                      {current.calculation.lines.length > 6 && <li className="text-content-subtle">and {current.calculation.lines.length - 6} more</li>}
                    </ul>
                    {current.approvalRequired && q.status === "DRAFT" && (
                      <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-[12px] text-warning-700" role="status">
                        This quote needs approval before it can be sent.
                      </p>
                    )}
                    {sentLink?.quoteId === q.id && (
                      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-2 py-1.5">
                        <code className="min-w-0 flex-1 truncate text-[11.5px]">{sentLink.url}</code>
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label="Copy the quote link"
                          onClick={async () => {
                            await navigator.clipboard.writeText(sentLink.url).catch(() => undefined);
                            toast({ variant: "success", title: "Link copied" });
                          }}
                        >
                          <Copy className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    )}

                    {data.canWrite && (
                      <div className="flex flex-wrap gap-2">
                        {q.status === "DRAFT" && (
                          <Button size="xs" variant="secondary" onClick={() => setEditing(detail)}>Edit</Button>
                        )}
                        {q.status === "DRAFT" && current.approvalRequired && (
                          <Button size="xs" loading={busy === `${q.id}:submit_for_approval`} onClick={() => step(detail, "submit_for_approval", "Sent for approval")}>
                            Request approval
                          </Button>
                        )}
                        {((q.status === "DRAFT" && !current.approvalRequired) || q.status === "APPROVED") && (
                          <Button size="xs" onClick={() => setSending(detail)}>Send</Button>
                        )}
                        {(q.status === "SENT" || q.status === "VIEWED") && (
                          <Button size="xs" variant="secondary" onClick={() => setSending(detail)}>Resend link</Button>
                        )}
                        {q.status === "PENDING_APPROVAL" && isAdmin && (
                          <>
                            <Button size="xs" variant="success" loading={busy === `${q.id}:approve`} onClick={() => step(detail, "approve", "Approved")}>Approve</Button>
                            <Button size="xs" variant="secondary" loading={busy === `${q.id}:reject`} onClick={() => step(detail, "reject", "Returned to draft")}>Reject</Button>
                          </>
                        )}
                        {["PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED"].includes(q.status) && (
                          <Button size="xs" variant="secondary" loading={busy === `${q.id}:revise`} onClick={() => step(detail, "revise", "New revision started")}>Revise</Button>
                        )}
                        {INVOICEABLE.includes(q.status) && isAdmin && data.capabilities.invoicing.allowed && invoices.length === 0 && (
                          <Button size="xs" onClick={() => setInvoicing(detail)}>Create invoices</Button>
                        )}
                        {["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED"].includes(q.status) && (
                          <Button size="xs" variant="ghost" onClick={() => setWithdrawing(detail)}>Withdraw</Button>
                        )}
                      </div>
                    )}

                    {invoices.length > 0 && (
                      <div>
                        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Invoices</h3>
                        <ul className="mt-1.5 space-y-1.5">
                          {invoices.map((inv) => (
                            <li key={inv.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                              <span className="min-w-0 flex-1 truncate text-content-secondary">
                                {inv.number ?? `${inv.kind.toLowerCase()} (draft)`} · {formatMinor(inv.totalMinor, inv.currency)}
                                {inv.dueDate ? ` · due ${formatDocumentDate(inv.dueDate)}` : ""}
                              </span>
                              <StatusBadge kind="invoice" value={inv.status} dense />
                              {isAdmin && inv.status === "DRAFT" && <Button size="xs" variant="secondary" onClick={() => setIssuing(inv)}>Issue</Button>}
                              {isAdmin && (inv.status === "OPEN" || inv.status === "PARTIALLY_PAID") && (
                                <Button size="xs" variant="secondary" onClick={() => setPaying(inv)}>Record payment</Button>
                              )}
                              {isAdmin && data.invoicePayMode === "PER_INVOICE" && ["DRAFT", "OPEN", "PARTIALLY_PAID"].includes(inv.status) && (
                                <Button size="xs" variant="secondary" onClick={() => setLinking(inv)}>
                                  {inv.payLinkUrl ? "Change pay link" : "Add pay link"}
                                </Button>
                              )}
                              {inv.payUrl && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(inv.payUrl!);
                                      toast({ variant: "success", title: "Pay link copied", description: "It carries this invoice's reference, so the payment is recorded on it." });
                                    } catch {
                                      toast({ variant: "error", title: "Could not copy the link" });
                                    }
                                  }}
                                >
                                  <Copy className="size-3.5" aria-hidden />
                                  Copy pay link
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Timeline</h3>
                      <ol className="mt-1.5 space-y-1 border-l border-line pl-3">
                        {detail.events.slice(-8).map((event, i) => (
                          <li key={`${event.type}-${i}`} className="text-[12px] text-content-secondary">
                            <span className="text-content">{EVENT_LABEL[event.type] ?? event.type}</span>{" "}
                            <span className="text-content-subtle">{new Date(event.occurredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                          </li>
                        ))}
                      </ol>
                      {detail.revisions.length > 1 && (
                        <p className="mt-2 text-[12px] text-content-muted">
                          Revisions: {detail.revisions.map((r) => `#${r.revisionNo} ${formatMinor(r.totalGrossMinor, q.currency)}`).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <QuoteEditor
          leadId={data.leadId}
          currency={data.currency}
          items={data.items}
          bundles={data.bundles}
          opportunities={openOpportunities}
          existing={editing === "new" ? null : editing}
          defaultDepositBps={data.defaultDepositBps}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={sending !== null}
        onClose={() => setSending(null)}
        title={sending && (sending.quote.status === "SENT" || sending.quote.status === "VIEWED") ? `Resend ${sending.quote.number}?` : `Send ${sending?.quote.number ?? ""}?`}
        scope="The quote is frozen as it stands and a private link is created for the customer."
        consequence="After this it can only be changed by issuing a new revision. An email goes out through your normal sending rules (quiet hours and opt-outs are re-checked first)."
        confirmLabel={channel === "email" ? "Send by email" : "Create link"}
        onConfirm={async () => {
          if (!sending) return;
          const result = await sendQuoteAction({ leadId: data.leadId, quoteId: sending.quote.id, channel });
          if (result.ok) setSentLink({ quoteId: sending.quote.id, url: (result.data as { publicUrl: string }).publicUrl });
          setSending(null);
          done(result, channel === "email" ? "Quote sent" : "Link created");
        }}
      >
        <fieldset className="mt-3 space-y-1.5 text-[13px]">
          <legend className="sr-only">How to send</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="quote-channel" checked={channel === "email"} onChange={() => setChannel("email")} />
            Email it to the customer
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="quote-channel" checked={channel === "link"} onChange={() => setChannel("link")} />
            Just give me the link to share
          </label>
        </fieldset>
      </ConfirmDialog>

      <ConfirmDialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        title={`Withdraw ${withdrawing?.quote.number ?? ""}?`}
        scope="The customer's link stops working straight away."
        consequence="A withdrawn quote cannot be reopened; you would create a new one."
        confirmLabel="Withdraw quote"
        variant="danger"
        onConfirm={async () => {
          if (!withdrawing) return;
          const result = await withdrawQuoteAction({ leadId: data.leadId, quoteId: withdrawing.quote.id, reason: reason.trim() || "Withdrawn by the sender" });
          setWithdrawing(null);
          setReason("");
          done(result, "Quote withdrawn");
        }}
      >
        <FormField label="Reason (for your records)" htmlFor="withdraw-reason" className="mt-3">
          <Input id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={invoicing !== null}
        onClose={() => setInvoicing(null)}
        title={`Create invoices for ${invoicing?.quote.number ?? ""}?`}
        scope="One invoice is drafted for each payment in the quote's schedule (deposit, balance or instalments)."
        consequence="With automatic issue on, each is numbered and emailed on its date, starting with anything due on acceptance. An issued invoice can only be voided or credited."
        confirmLabel="Create invoices"
        onConfirm={async () => {
          if (!invoicing) return;
          const result = await invoiceQuoteAction({ leadId: data.leadId, quoteId: invoicing.quote.id, autoIssue });
          setInvoicing(null);
          done(result, "Invoices created");
        }}
      >
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <Checkbox checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} />
          Issue and email each invoice automatically on its date
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={issuing !== null}
        onClose={() => setIssuing(null)}
        title="Issue this invoice?"
        scope="It gets its number and dates and is emailed to the customer. Payment reminders are scheduled."
        consequence="An issued invoice cannot be edited, only voided (if unpaid) or credited."
        confirmLabel="Issue invoice"
        onConfirm={async () => {
          if (!issuing) return;
          const result = await issueInvoiceAction({ leadId: data.leadId, invoiceId: issuing.id });
          setIssuing(null);
          done(result, "Invoice issued");
        }}
      />

      {paying && <PaymentDialog invoice={paying} leadId={data.leadId} onClose={() => setPaying(null)} onDone={done} />}
      {linking && <PayLinkDialog invoice={linking} leadId={data.leadId} onClose={() => setLinking(null)} onDone={done} />}
    </section>
  );
}

function PaymentDialog({
  invoice,
  leadId,
  onClose,
  onDone,
}: {
  invoice: LeadInvoiceView;
  leadId: string;
  onClose: () => void;
  onDone: (result: { ok: boolean; error?: string; warnings?: string[] }, success: string) => void;
}) {
  const due = invoice.totalMinor - invoice.paidMinor;
  const [amount, setAmount] = React.useState((due / 100).toFixed(2));
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Record a payment on ${invoice.number}`}
      description={`${formatMinor(due, invoice.currency)} is still due. A payment is permanent; a mistake is corrected with a credit note.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={saving}
            onClick={async () => {
              const minor = parseMoneyInput(amount);
              if (minor === null || minor <= 0) return setError("Enter the amount received.");
              if (!reference.trim()) return setError("Enter the bank reference or receipt number.");
              setSaving(true);
              const result = await recordPaymentAction({ leadId, invoiceId: invoice.id, amountMinor: minor, receivedOn: date, reference: reference.trim() });
              setSaving(false);
              if (!result.ok) return setError(result.error);
              onClose();
              onDone(result, "Payment recorded");
            }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label={`Amount (${invoice.currency})`} htmlFor="pay-amount">
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Received on" htmlFor="pay-date">
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Reference" htmlFor="pay-ref" hint="Recorded once: the same reference is never counted twice.">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </FormField>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

/** 0173: paste the Stripe Payment Link for one invoice (PER_INVOICE mode). */
function PayLinkDialog({
  invoice,
  leadId,
  onClose,
  onDone,
}: {
  invoice: LeadInvoiceView;
  leadId: string;
  onClose: () => void;
  onDone: (result: { ok: boolean; error?: string; warnings?: string[] }, success: string) => void;
}) {
  const [url, setUrl] = React.useState(invoice.payLinkUrl ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState<"save" | "remove" | null>(null);
  const due = invoice.totalMinor - invoice.paidMinor;
  async function submit(value: string | null) {
    setError(null);
    if (value !== null) {
      const problem = payLinkProblem(value);
      if (problem) return setError(problem);
    }
    setSaving(value === null ? "remove" : "save");
    const result = await setInvoicePayLinkAction({ leadId, invoiceId: invoice.id, url: value });
    setSaving(null);
    if (!result.ok) return setError(result.error);
    onClose();
    onDone(result, value === null ? "Pay link removed" : "Pay link saved");
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Payment link for ${invoice.number ?? "this invoice"}`}
      description={`Create a Payment Link for ${formatMinor(due, invoice.currency)} in your own Stripe dashboard and paste it here. The invoice email and the quote page then show a Pay now button, and the payment is recorded on this invoice automatically.`}
      footer={
        <>
          {invoice.payLinkUrl && (
            <Button variant="ghost" loading={saving === "remove"} disabled={saving !== null} onClick={() => submit(null)}>
              Remove link
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving === "save"} disabled={saving !== null} onClick={() => submit(url.trim())}>
            Save link
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="Stripe Payment Link" htmlFor="inv-pay-link" hint="Starts with https://buy.stripe.com/. ClientTurn adds this invoice's reference when it sends it.">
          <Input id="inv-pay-link" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} placeholder="https://buy.stripe.com/..." />
        </FormField>
        <FormError message={error} />
      </div>
    </Modal>
  );
}
