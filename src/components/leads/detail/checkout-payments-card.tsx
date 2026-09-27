import "server-only";
import * as React from "react";
import { CreditCard } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { loadLeadCheckoutActivity } from "@/lib/payments/store";
import { formatMoney, sourceLabel } from "@/lib/payments/facts";

/**
 * The lead's checkout links and payments (the direct-sale loop): each link
 * the assistant sent, whether it was paid, and the payments received. The
 * page has already authenticated the viewer as a member of the workspace;
 * every read here is scoped to that workspace.
 */
export async function CheckoutPaymentsCard({ businessId, leadId }: { businessId: string; leadId: string }) {
  const result = await loadLeadCheckoutActivity(businessId, leadId);

  let body: React.ReactNode;
  if (result.state === "not_installed") {
    body = <Note>Payment tracking is not switched on for this workspace yet.</Note>;
  } else if (result.state === "error") {
    body = <Note>Checkout history could not be loaded right now.</Note>;
  } else if (result.data.attempts.length === 0 && result.data.payments.length === 0) {
    body = <Note>No checkout link sent and no payment received yet.</Note>;
  } else {
    const { attempts, payments } = result.data;
    body = (
      <ul className="divide-y divide-line-subtle">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium text-content">Checkout link: {attempt.linkId}</span>
              <StatusBadge kind="checkout_attempt" value={attempt.status} dense />
            </div>
            <p className="mt-1 text-[12px] leading-snug text-content-muted">
              Sent {new Date(attempt.sentAt).toLocaleString("en-GB")} by {attempt.channel}
              {attempt.nudgesSent > 0 ? ` · ${attempt.nudgesSent} reminder${attempt.nudgesSent === 1 ? "" : "s"}` : ""}
              {attempt.clickedAt ? ` · opened ${new Date(attempt.clickedAt).toLocaleString("en-GB")}` : ""}
              {attempt.paidAt && attempt.amountMinor !== null && attempt.currency
                ? ` · paid ${formatMoney(attempt.amountMinor, attempt.currency)}${attempt.recurring && attempt.interval ? ` per ${attempt.interval}` : ""}`
                : ""}
            </p>
          </li>
        ))}
        {payments.map((payment) => (
          <li key={payment.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium text-content">
                {formatMoney(payment.amountMinor, payment.currency)}
                {payment.recurring && payment.interval ? ` per ${payment.interval}` : ""}
              </span>
              <StatusBadge kind="payment" value={payment.status} dense />
            </div>
            <p className="mt-1 text-[12px] leading-snug text-content-muted">
              {payment.provider === "stripe" ? "Stripe" : sourceLabel(payment.source)} · {new Date(payment.paidAt).toLocaleString("en-GB")}
              {payment.status === "REVIEW" ? " · matched by email: confirm it in Settings, Connections" : ""}
            </p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface" aria-label="Checkout and payments">
      <header className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
        <CreditCard className="size-4 text-content-muted" aria-hidden />
        <h2 className="text-[13px] font-semibold text-content">Checkout and payments</h2>
      </header>
      {body}
      <p className="px-5 pb-3 text-[11px] text-content-subtle">Opened is shown only where the payment provider reports it.</p>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-4 text-[12.5px] text-content-muted" role="status">
      {children}
    </p>
  );
}

export function CheckoutPaymentsSkeleton() {
  return <Skeleton className="h-28 w-full rounded-xl" />;
}
