import "server-only";
import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { canStoreSecrets } from "@/lib/security/secret-box";
import { loadPaymentEndpoints, loadPaymentsNeedingReview } from "@/lib/payments/store";
import { Skeleton } from "@/components/ui/feedback";
import { PaymentsCards } from "./payments-cards";

/**
 * Settings -> Connections: payments (the direct-sale loop). Loads the two
 * endpoints (never their secrets) and the payments waiting for a person, and
 * hands them to the client cards. Every state is rendered: not installed
 * (0143 not applied), a read error, read-only for members, and empty.
 */
export async function PaymentsSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");
  const [endpoints, review] = await Promise.all([
    loadPaymentEndpoints(workspace.businessId),
    loadPaymentsNeedingReview(workspace.businessId),
  ]);

  const base = serverEnv.siteUrl.replace(/\/+$/, "");
  const stripe = endpoints.state === "ok" ? endpoints.data.find((e) => e.kind === "STRIPE") ?? null : null;
  const orderPaid = endpoints.state === "ok" ? endpoints.data.find((e) => e.kind === "ORDER_PAID") ?? null : null;

  return (
    <PaymentsCards
      state={endpoints.state === "ok" ? "ok" : endpoints.state}
      canManage={canManage}
      secretsAvailable={canStoreSecrets()}
      stripe={stripe ? { ...stripe, url: `${base}/api/webhooks/payments/stripe/${stripe.id}` } : null}
      orderPaid={orderPaid ? { ...orderPaid, url: `${base}/api/webhooks/payments/order-paid/${orderPaid.id}` } : null}
      review={review.state === "ok" ? review.data : null}
      reviewError={review.state === "error"}
    />
  );
}

export function PaymentsSectionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading payments">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
