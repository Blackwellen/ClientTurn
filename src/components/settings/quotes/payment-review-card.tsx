"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/payments/facts";
import {
  RESOLUTION_LABEL,
  REVIEW_KIND_GUIDANCE,
  REVIEW_KIND_LABEL,
  type DismissResolution,
} from "@/lib/invoicing/payment-review";
import type { OpenInvoiceOption, PaymentReviewItem } from "@/lib/invoicing/payment-review-store";
import { applyReviewPaymentAction, dismissReviewPaymentAction } from "@/lib/invoicing/payment-review-actions";

/**
 * Settings -> Quotes & invoices -> Payments to review (0175). Payments the
 * invoice settlement flagged (over-paid, wrong currency, already paid,
 * refunded, disputed) or that carried no invoice reference. A person applies
 * one to an open invoice or says what was done with it. Nothing here moves
 * money: refunds happen in the workspace's own payment provider.
 */
export function PaymentReviewCard(props: {
  state: "ok" | "not_installed" | "error";
  items: PaymentReviewItem[];
  openInvoices: OpenInvoiceOption[];
  canManage: boolean;
}) {
  return (
    <Card id="payment-review">
      <CardHeader>
        <div>
          <CardTitle>Payments to review</CardTitle>
          <CardDescription>
            Invoice payments that need a person: paid twice, over-paid, in another currency, refunded, disputed, or sent without an invoice reference.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.state === "not_installed" ? (
          <p role="status" className="text-[12.5px] text-content-muted">
            The review queue needs a database update (0175) that has not been applied yet. Flagged payments are still recorded and you are still notified.
          </p>
        ) : props.state === "error" ? (
          <p role="alert" className="text-[12.5px] text-danger-700">
            Payments to review could not be loaded right now. Refresh to try again.
          </p>
        ) : props.items.length === 0 ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-line bg-surface-sunken px-4 py-3 text-[12.5px] text-content-muted">
            <Receipt className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Nothing to review. Every invoice payment so far settled on its own.</p>
          </div>
        ) : (
          <>
            {!props.canManage && (
              <p className="text-[12px] text-content-muted">Only an owner or admin can resolve these. You can see what is waiting.</p>
            )}
            <ul className="divide-y divide-line-subtle" aria-label="Payments to review">
              {props.items.map((item) => (
                <ReviewItemRow key={item.id} item={item} openInvoices={props.openInvoices} canManage={props.canManage} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewItemRow({ item, openInvoices, canManage }: { item: PaymentReviewItem; openInvoices: OpenInvoiceOption[]; canManage: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const candidates = openInvoices.filter((invoice) => invoice.currency === item.currency && invoice.id !== item.invoiceId);
  const [invoiceId, setInvoiceId] = React.useState<string>("");
  const [resolution, setResolution] = React.useState<DismissResolution | "">("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState<"apply" | "dismiss" | null>(null);
  const chosen = candidates.find((invoice) => invoice.id === invoiceId) ?? null;

  async function apply() {
    if (!chosen) return;
    setBusy("apply");
    try {
      const result = await applyReviewPaymentAction({ paymentId: item.id, invoiceId: chosen.id });
      if (result.ok) {
        toast({ variant: "success", title: result.warnings[0] ?? `Recorded on invoice ${chosen.number}.` });
        router.refresh();
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  async function dismiss() {
    if (!resolution) return;
    setBusy("dismiss");
    try {
      const result = await dismissReviewPaymentAction({ paymentId: item.id, resolution });
      if (result.ok) {
        toast({ variant: "success", title: result.warnings[0] ?? "Marked as dealt with." });
        router.refresh();
      } else {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setBusy(null);
    }
  }

  const tone = item.kind === "DISPUTED" || item.kind === "REFUNDED" ? "danger" : "warning";
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-content">
            {formatMoney(item.amountMinor, item.currency)} via {item.provider === "stripe" ? "Stripe" : "your checkout"}
            {item.invoiceNumber ? ` for invoice ${item.invoiceNumber}` : ""}
          </p>
          <p className="truncate text-[12px] text-content-muted">
            {new Date(item.paidAt).toLocaleString("en-GB")} · order {item.orderId}
            {item.leadName ? ` · ${item.leadName}` : item.email ? ` · ${item.email}` : ""}
          </p>
        </div>
        <Badge tone={tone} dense>
          {REVIEW_KIND_LABEL[item.kind]}
        </Badge>
      </div>
      <p className="text-[12px] text-content-secondary">{REVIEW_KIND_GUIDANCE[item.kind]}</p>

      {canManage && (
        <div className="flex flex-wrap items-end gap-3">
          {item.canApply && (
            <div className="flex min-w-[220px] flex-1 items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`review-invoice-${item.id}`}>Apply to invoice</Label>
                <select
                  id={`review-invoice-${item.id}`}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-content"
                  value={invoiceId}
                  onChange={(event) => setInvoiceId(event.target.value)}
                  disabled={candidates.length === 0}
                >
                  <option value="">{candidates.length ? "Choose an open invoice" : `No open ${item.currency} invoice`}</option>
                  {candidates.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.number} ({formatMoney(invoice.dueMinor, invoice.currency)} due)
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" variant="secondary" disabled={!chosen || busy !== null} loading={busy === "apply"} onClick={() => setConfirming(true)}>
                Apply
              </Button>
            </div>
          )}
          <div className="flex min-w-[220px] flex-1 items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={`review-outcome-${item.id}`}>Or mark as dealt with</Label>
              <select
                id={`review-outcome-${item.id}`}
                className="h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-content"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as DismissResolution | "")}
              >
                <option value="">Choose what happened</option>
                {item.resolutions.map((value) => (
                  <option key={value} value={value}>
                    {RESOLUTION_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" variant="ghost" disabled={!resolution || busy !== null} loading={busy === "dismiss"} onClick={dismiss}>
              Done
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={apply}
        loading={busy === "apply"}
        title="Record this payment on the invoice?"
        scope={chosen ? `${formatMoney(item.amountMinor, item.currency)} from order ${item.orderId}, on invoice ${chosen.number}.` : ""}
        consequence="It is recorded permanently, up to the amount due. Anything over stays here for you to refund or keep as credit. A mistake is corrected with a credit note."
        confirmLabel="Record payment"
      />
    </li>
  );
}
