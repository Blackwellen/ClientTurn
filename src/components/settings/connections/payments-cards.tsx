"use client";

import { friendlyErrorMessage } from "@/lib/errors/friendly";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, CreditCard, Link2, Lock, Receipt, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import {
  createStripePaymentEndpoint,
  linkPaymentToLeadAction,
  rotateOrderPaidSecret,
  saveStripeSigningSecret,
  searchLeadsForPayment,
  setPaymentEndpointActive,
} from "@/lib/payments/actions";
import { formatMoney, sourceLabel } from "@/lib/payments/facts";
import { formatInZone } from "@/lib/dates";

type Endpoint = {
  id: string;
  active: boolean;
  hasSecret: boolean;
  lastReceivedAt: string | null;
  lastError: string | null;
  url: string;
};

type ReviewPayment = {
  id: string;
  provider: string;
  source: string | null;
  orderId: string;
  email: string | null;
  amountMinor: number;
  currency: string;
  recurring: boolean;
  interval: string | null;
  status: string;
  leadId: string | null;
  leadName: string | null;
  paidAt: string;
};

/**
 * Payments: confirm a sale the assistant closed (the direct-sale loop).
 *
 *   * Stripe -- the customer's OWN Stripe account (no Connect): a unique URL
 *     for this workspace to add in Stripe, and the endpoint's signing secret.
 *   * Order paid -- a signed webhook for Shopify, WooCommerce, GoCardless,
 *     Paddle or Zapier; the secret is shown once when generated.
 *   * Payments needing a lead -- email-only matches to confirm and payments
 *     with no lead, each linkable (payment.link_to_lead, confirmed, audited).
 */
export function PaymentsCards(props: {
  state: "ok" | "not_installed" | "error";
  canManage: boolean;
  secretsAvailable: boolean;
  stripe: Endpoint | null;
  orderPaid: Endpoint | null;
  review: ReviewPayment[] | null;
  reviewError: boolean;
}) {
  if (props.state !== "ok") {
    return (
      <Card id="payments">
        <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
          <SectionHeader icon={CreditCard} tone="info" title="Payments" description="Confirm sales the assistant closes with a checkout link." />
        </CardHeader>
        <CardContent className="px-5 pt-3 pb-5">
          <p className="text-[12.5px] text-content-muted" role="status">
            {props.state === "not_installed"
              ? "Payment confirmation needs a database update (0143) before it can be switched on for this workspace. Checkout links keep working; payments are not matched to leads until then."
              : "Payment settings could not be loaded right now. Refresh to try again; payments already received are safe."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div id="payments" className="space-y-4">
      <StripeCard endpoint={props.stripe} canManage={props.canManage} secretsAvailable={props.secretsAvailable} />
      <OrderPaidCard endpoint={props.orderPaid} canManage={props.canManage} secretsAvailable={props.secretsAvailable} />
      <ReviewCard payments={props.review} error={props.reviewError} canManage={props.canManage} />
    </div>
  );
}

function useCopy() {
  const { toast } = useToast();
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ variant: "success", title: `${what} copied` });
    } catch {
      toast({ variant: "error", title: `Could not copy the ${what.toLowerCase()}. Select it and copy by hand.` });
    }
  };
}

function Health({ endpoint }: { endpoint: Endpoint | null }) {
  if (!endpoint) return <StatusBadge kind="integration" value="DISCONNECTED" dense />;
  if (!endpoint.active) return <StatusBadge kind="integration" value="DISCONNECTED" dense />;
  if (!endpoint.hasSecret) return <StatusBadge kind="integration" value="ACTION_REQUIRED" dense />;
  if (endpoint.lastError) return <StatusBadge kind="integration" value="DEGRADED" dense />;
  return <StatusBadge kind="integration" value="HEALTHY" dense />;
}

function UrlRow({ url }: { url: string }) {
  const copy = useCopy();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-sunken px-2 py-1.5 text-[12px]">{url}</code>
      <Button variant="secondary" size="sm" onClick={() => copy(url, "Endpoint URL")}>
        <Copy className="size-3.5" aria-hidden />
        Copy
      </Button>
    </div>
  );
}

function LastDelivery({ endpoint }: { endpoint: Endpoint }) {
  return (
    <p className="text-[11.5px] text-content-muted">
      {endpoint.lastReceivedAt
        ? `Last delivery ${formatInZone(endpoint.lastReceivedAt, "datetime")}.`
        : "No deliveries yet."}
      {endpoint.lastError ? ` Last problem: ${friendlyErrorMessage(endpoint.lastError, "a payment event could not be processed").replace(/\.$/, "")}.` : ""}
    </p>
  );
}

function StripeCard({ endpoint, canManage, secretsAvailable }: { endpoint: Endpoint | null; canManage: boolean; secretsAvailable: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>, success: string) {
    setBusy(true);
    try {
      const result = await action();
      toast(result.ok ? { variant: "success", title: result.message ?? success } : { variant: "error", title: result.error ?? "That did not work." });
      if (result.ok) {
        setSecret("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
        <div className="flex w-full items-start justify-between gap-3">
          <SectionHeader
            icon={CreditCard}
            tone="info"
            title="Payments: Stripe"
            description="Your own Stripe account tells ClientTurn when a lead pays a checkout link. No Stripe Connect."
          />
          <Health endpoint={endpoint} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pt-3 pb-5">
        {!endpoint ? (
          canManage ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-content-muted">
                Create this workspace&apos;s endpoint, then add it in Stripe under Developers, Webhooks with the events
                checkout.session.completed, checkout.session.async_payment_succeeded and invoice.paid. Add charge.refunded and
                charge.dispute.created too, so a refund or dispute on an invoice payment is flagged for you.
              </p>
              <Button size="sm" loading={busy} onClick={() => run(createStripePaymentEndpoint, "Stripe endpoint created")}>
                <Webhook className="size-3.5" aria-hidden />
                Create Stripe endpoint
              </Button>
            </div>
          ) : (
            <PermissionNote />
          )
        ) : (
          <>
            <div className="space-y-1">
              <Label>Endpoint URL for Stripe</Label>
              <UrlRow url={endpoint.url} />
            </div>
            <LastDelivery endpoint={endpoint} />
            {canManage ? (
              secretsAvailable ? (
                <form
                  className="space-y-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => saveStripeSigningSecret(secret), "Signing secret saved");
                  }}
                >
                  <Label htmlFor="stripe-whsec">{endpoint.hasSecret ? "Replace the signing secret" : "Signing secret"}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="stripe-whsec"
                      type="password"
                      autoComplete="off"
                      placeholder="whsec_..."
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                    <Button type="submit" size="sm" loading={busy} disabled={!secret.trim()}>
                      Save
                    </Button>
                  </div>
                  <p className="text-[11.5px] text-content-muted">
                    From the endpoint&apos;s page in Stripe (&quot;Signing secret&quot;). Stored encrypted and never shown again.
                    {endpoint.hasSecret ? " A secret is saved." : " Deliveries are refused until one is saved."}
                  </p>
                </form>
              ) : (
                <p className="text-[12px] text-warning-700">This deployment cannot store secrets yet. Ask your administrator to set CREDENTIAL_ENCRYPTION_KEY.</p>
              )
            ) : (
              <PermissionNote />
            )}
            {canManage && (
              <ToggleEndpoint kind="STRIPE" active={endpoint.active} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OrderPaidCard({ endpoint, canManage, secretsAvailable }: { endpoint: Endpoint | null; canManage: boolean; secretsAvailable: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const copy = useCopy();
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  async function generate() {
    setBusy(true);
    try {
      const result = await rotateOrderPaidSecret();
      if (result.ok && result.secret) {
        setRevealed(result.secret);
        router.refresh();
      } else if (!result.ok) {
        toast({ variant: "error", title: result.error });
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
        <div className="flex w-full items-start justify-between gap-3">
          <SectionHeader
            icon={Receipt}
            tone="info"
            title="Payments: order paid webhook"
            description="For Shopify, WooCommerce, GoCardless, Paddle or Zapier: send a signed request when an order is paid."
          />
          <Health endpoint={endpoint} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pt-3 pb-5">
        {endpoint && (
          <>
            <div className="space-y-1">
              <Label>Endpoint URL</Label>
              <UrlRow url={endpoint.url} />
            </div>
            <LastDelivery endpoint={endpoint} />
          </>
        )}
        <p className="text-[12px] text-content-muted">
          POST JSON with order_id, amount (e.g. 49.99), currency and, when your shop can pass it through, reference (the
          tracking value from the checkout link), plus email. Sign it with X-ClientTurn-Timestamp and
          X-ClientTurn-Signature (HMAC-SHA256 of timestamp.body). Shopify and WooCommerce cannot sign this themselves:
          send it from Zapier, Make or your own server. The full contract is in the help centre.
        </p>
        {revealed && (
          <div className="space-y-1 rounded-lg border border-warning-100 bg-warning-50 p-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-warning-700">
              <Lock className="size-3.5" aria-hidden />
              Copy this secret now. It will not be shown again.
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[12px]">{revealed}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(revealed, "Secret")}>
                <Copy className="size-3.5" aria-hidden />
                Copy
              </Button>
            </div>
          </div>
        )}
        {canManage ? (
          secretsAvailable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={endpoint ? "secondary" : "primary"}
                loading={busy}
                onClick={() => (endpoint?.hasSecret ? setConfirming(true) : void generate())}
              >
                {endpoint?.hasSecret ? "Rotate secret" : "Create endpoint and secret"}
              </Button>
              {endpoint && <ToggleEndpoint kind="ORDER_PAID" active={endpoint.active} />}
            </div>
          ) : (
            <p className="text-[12px] text-warning-700">This deployment cannot store secrets yet. Ask your administrator to set CREDENTIAL_ENCRYPTION_KEY.</p>
          )
        ) : (
          <PermissionNote />
        )}
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={generate}
          loading={busy}
          title="Rotate the order paid secret?"
          scope="The signing secret for this workspace's order paid webhook."
          consequence="The current secret stops working immediately. Update it wherever you send order paid requests from, or those payments will be refused."
          confirmLabel="Rotate secret"
        />
      </CardContent>
    </Card>
  );
}

function ToggleEndpoint({ kind, active }: { kind: "STRIPE" | "ORDER_PAID"; active: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await setPaymentEndpointActive({ kind, active: !active });
          toast(result.ok ? { variant: "success", title: active ? "Endpoint paused" : "Endpoint resumed" } : { variant: "error", title: result.error });
          if (result.ok) router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {active ? "Pause endpoint" : "Resume endpoint"}
    </Button>
  );
}

function PermissionNote() {
  return <p className="text-[12px] text-content-muted">Only an owner or admin can set up payment confirmation.</p>;
}

function ReviewCard({ payments, error, canManage }: { payments: ReviewPayment[] | null; error: boolean; canManage: boolean }) {
  return (
    <Card>
      <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          icon={Link2}
          tone="warning"
          title="Payments needing a lead"
          description="Payments matched by email only, or not matched at all. Nothing is marked won until you confirm who paid."
        />
      </CardHeader>
      <CardContent className="px-5 pt-3 pb-5">
        {error || !payments ? (
          <p className="text-[12.5px] text-content-muted" role="status">These payments could not be loaded right now. Refresh to try again.</p>
        ) : payments.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">Nothing to review. Every payment so far matched its lead.</p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {payments.map((payment) => (
              <ReviewRow key={payment.id} payment={payment} canManage={canManage} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewRow({ payment, canManage }: { payment: ReviewPayment; canManage: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [query, setQuery] = React.useState(payment.email ?? "");
  const [options, setOptions] = React.useState<{ id: string; name: string; email: string | null }[]>(
    payment.leadId && payment.leadName ? [{ id: payment.leadId, name: payment.leadName, email: payment.email }] : [],
  );
  const [chosen, setChosen] = React.useState<string | null>(payment.leadId);
  const [searching, setSearching] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const chosenName = options.find((option) => option.id === chosen)?.name ?? "this lead";

  async function search() {
    setSearching(true);
    try {
      const result = await searchLeadsForPayment(query);
      if (result.ok) setOptions(result.leads);
      else toast({ variant: "error", title: result.error });
    } finally {
      setSearching(false);
    }
  }

  async function link() {
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await linkPaymentToLeadAction({ paymentId: payment.id, leadId: chosen });
      toast(result.ok ? { variant: "success", title: result.message ?? "Payment linked" } : { variant: "error", title: result.error });
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const cadence = payment.recurring ? (payment.interval ? ` per ${payment.interval}` : " recurring") : "";
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-content">
            {formatMoney(payment.amountMinor, payment.currency)}
            {cadence} via {payment.provider === "stripe" ? "Stripe" : sourceLabel(payment.source)}
          </p>
          <p className="truncate text-[12px] text-content-muted">
            {formatInZone(payment.paidAt, "datetime")} · order {payment.orderId}
            {payment.email ? ` · ${payment.email}` : ""}
          </p>
        </div>
        <StatusBadge kind="payment" value={payment.status} dense />
      </div>
      {payment.status === "REVIEW" && payment.leadName && (
        <p className="text-[12px] text-content-muted">Same email as {payment.leadName}. Confirm if they are the person who paid.</p>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1 space-y-1">
            <Label htmlFor={`pay-search-${payment.id}`}>Find the lead</Label>
            <div className="flex gap-2">
              <Input id={`pay-search-${payment.id}`} value={query} placeholder="Name or email" onChange={(event) => setQuery(event.target.value)} />
              <Button variant="secondary" size="sm" loading={searching} onClick={search} disabled={query.trim().length < 2}>
                Search
              </Button>
            </div>
          </div>
          <div className="min-w-[180px] flex-1 space-y-1">
            <Label htmlFor={`pay-lead-${payment.id}`}>Lead who paid</Label>
            <select
              id={`pay-lead-${payment.id}`}
              className="h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-content"
              value={chosen ?? ""}
              onChange={(event) => setChosen(event.target.value || null)}
            >
              <option value="">{options.length ? "Choose a lead" : "Search first"}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.email ? ` (${option.email})` : ""}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" disabled={!chosen} loading={busy} onClick={() => setConfirming(true)}>
            {payment.status === "REVIEW" && chosen === payment.leadId ? "Confirm" : "Link to lead"}
          </Button>
        </div>
      ) : (
        <PermissionNote />
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={link}
        loading={busy}
        title="Link this payment?"
        scope={`${formatMoney(payment.amountMinor, payment.currency)} from order ${payment.orderId}, to ${chosenName}.`}
        consequence="Their open opportunity is closed as won with this amount, their follow-up stops, and the assistant sends them a thank-you with your next steps."
        confirmLabel="Link and mark won"
      />
    </li>
  );
}
