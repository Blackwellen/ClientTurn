"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Info,
  MessageSquare,
  Receipt,
  Rocket,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { nextPlanFor, PLANS } from "@/lib/billing/plans";
import { Badge, StatusBadge, SUBSCRIPTION_STATUS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { UpgradeNowButton } from "@/components/billing/upgrade-now-button";
import { SectionHeader } from "@/components/app/page-header";
import { formatDate, formatGbp } from "@/lib/dates";
import {
  cancelScheduledPlanChange,
  openBillingPortal,
  startPlanCheckout,
} from "@/lib/settings/actions";
import { previousSelfServePlan } from "@/lib/billing/plan-change";
import { invoiceStatusMeta, type InvoiceRow } from "@/lib/billing/types";
import {
  planLabel,
  usagePercent,
  usageTone,
  type BillingView,
} from "@/lib/settings/types";

/** The status dot beside the word, keyed to the same map the badge reads. */
const HELP_LINKS: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** No href means the Stripe portal, opened through a server-made session. */
  href?: string;
}[] = [
  { label: "How billing works", icon: Info, href: "/app/help/billing/plans-and-pricing" },
  { label: "Understanding your usage", icon: Gauge, href: "/app/help/billing/usage-and-limits" },
  { label: "Update payment method", icon: Wallet },
  { label: "View invoices", icon: Receipt },
  { label: "Contact support", icon: UserRound, href: "/app/support" },
];

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-success-500",
  TRIALING: "bg-info-500",
  PAST_DUE: "bg-warning-500",
  UNPAID: "bg-danger-500",
  CANCELLED: "bg-content-subtle",
  INCOMPLETE: "bg-warning-500",
};

const STATUS_COPY: Record<string, string> = {
  ACTIVE: "Your subscription is active and in good standing.",
  TRIALING:
    "You are on a free trial with a card on file. The first payment is taken when the trial ends unless you cancel before then; we email you three days before.",
  PAST_DUE:
    "The last payment failed. We retry it once a day for up to 30 days and stop as soon as it succeeds. Update your card to settle it now.",
  UNPAID: "An invoice is unpaid. Update your card in the billing portal to restore full access.",
  CANCELLED: "This subscription has ended. The workspace is read-only; your data is intact.",
  INCOMPLETE: "Checkout was not completed. Start your trial to activate the workspace.",
};

/** Lifecycle states that say more than the Stripe status alone. */
const STATE_COPY: Record<string, string> = {
  PAST_DUE_GRACE:
    "The last payment failed. Everything keeps running for three days while we retry daily; after that sending and AI pause until it is paid.",
  PAST_DUE_RESTRICTED:
    "Sending and AI are paused because the payment is still outstanding. Leads are still captured and nothing is deleted. We keep retrying daily for up to 30 days.",
  TRIAL_EXPIRED: "Your free trial has ended. Choose a plan to carry on.",
};

function UsageCard({
  icon: Icon,
  label,
  used,
  limit,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  limit: number;
  unit: string;
}) {
  const pct = usagePercent(used, limit);
  const remaining = Math.max(limit - used, 0);

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken text-content-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="text-[13px] font-semibold text-content">{label}</p>
      </div>

      <div className="mt-3">
        <Progress
          value={used}
          max={limit}
          tone={usageTone(used, limit)}
          label={`${label} usage`}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="lr-tabular text-[13px] text-content">
          {used.toLocaleString("en-GB")} of {limit.toLocaleString("en-GB")}
        </p>
        <p className="lr-tabular text-[13px] font-medium text-content-secondary">
          {pct}%
        </p>
      </div>
      <p className="lr-tabular text-[12px] text-content-muted">
        {remaining.toLocaleString("en-GB")} {unit} remaining
      </p>
    </div>
  );
}

export function BillingSettings({
  billing,
  invoices,
  invoicesError,
}: {
  billing: BillingView;
  invoices: InvoiceRow[];
  invoicesError: string | null;
}) {
  const { toast } = useToast();
  const [portalPending, setPortalPending] = React.useState(false);
  const router = useRouter();
  const [checkoutPending, setCheckoutPending] = React.useState(false);
  const upgradeTarget = nextPlanFor(billing.plan);
  const pending = billing.pendingPlanChange;
  const trialing = billing.status === "TRIALING";
  // Offered only on a live paid tier with nothing already scheduled.
  const downgradeTarget =
    billing.hasStripeCustomer &&
    !pending &&
    !billing.cancelAtPeriodEnd &&
    ["ACTIVE", "TRIALING"].includes(billing.status)
      ? previousSelfServePlan(billing.plan)
      : null;
  const [changePending, setChangePending] = React.useState(false);
  const [confirmDowngrade, setConfirmDowngrade] = React.useState(false);
  const annual = billing.billingInterval === "year";

  async function onPortal() {
    setPortalPending(true);
    toast({ variant: "info", title: "Opening Stripe billing portal" });
    const result = await openBillingPortal();
    setPortalPending(false);

    if (result.ok) {
      window.location.href = result.url;
    } else {
      toast({
        variant: "error",
        title: "Unable to open billing portal",
        description: result.error,
      });
    }
  }

  /**
   * Checks out the tier directly above the current one, rather than a fixed
   * plan: hard-coding one meant a Growth workspace was sent to buy Growth
   * again and Pro could not be bought in-app at all.
   */
  async function onUpgrade() {
    if (!upgradeTarget) return;

    // Enterprise has no public price, so it is a conversation, not a checkout.
    if (upgradeTarget === "enterprise") {
      router.push("/contact-sales");
      return;
    }

    setCheckoutPending(true);
    // No interval: the server keeps the subscription's own (annual stays annual).
    const result = await startPlanCheckout({ plan: upgradeTarget });
    setCheckoutPending(false);

    if (result.ok) {
      window.location.href = result.url;
    } else {
      toast({
        variant: "error",
        title: "Checkout could not start",
        description: result.error,
      });
    }
  }

  /**
   * One tier down. Takes effect at the end of the paid period (terms 6.3);
   * during a trial it applies straight away, since nothing has been charged.
   * Two clicks: the first shows what will happen and when.
   */
  async function onDowngrade() {
    if (!downgradeTarget) return;
    if (!confirmDowngrade) {
      setConfirmDowngrade(true);
      return;
    }
    setChangePending(true);
    const result = await startPlanCheckout({ plan: downgradeTarget });
    setChangePending(false);
    setConfirmDowngrade(false);
    if (result.ok) {
      router.push(result.url);
      router.refresh();
    } else {
      toast({ variant: "error", title: "Could not change plan", description: result.error });
    }
  }

  async function onCancelPending() {
    setChangePending(true);
    const result = await cancelScheduledPlanChange();
    setChangePending(false);
    if (result.ok) {
      toast({ variant: "success", title: "Scheduled change cancelled", description: `You stay on ${planLabel(billing.plan)}.` });
      router.refresh();
    } else {
      toast({ variant: "error", title: "Could not cancel the change", description: result.error });
    }
  }

  const period =
    billing.currentPeriodStart && billing.currentPeriodEnd
      ? `${formatDate(billing.currentPeriodStart)} – ${formatDate(billing.currentPeriodEnd)}`
      : "Not started yet";

  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <SectionHeader
              title="Current plan"
              description="Your plan and subscription details."
            />
          </CardHeader>
          <CardContent>
            <div className="grid overflow-hidden rounded-xl border border-line lg:grid-cols-[minmax(0,1fr)_296px]">
              <div className="bg-accent-50/50 px-5 py-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="text-[24px] font-semibold leading-none tracking-[-0.01em] text-content">
                    {planLabel(billing.plan)}
                  </p>
                  <StatusBadge kind="subscription" value={billing.status} />
                </div>

                <ul className="mt-4 space-y-2">
                  {billing.planFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-success-600"
                        aria-hidden
                      />
                      <span className="text-[13px] text-content-secondary">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-4 border-t border-line bg-surface px-5 py-5 lg:border-l lg:border-t-0">
                <div>
                  <p className="text-[12px] text-content-subtle">Billing period</p>
                  <p className="text-[13px] text-content">{period}</p>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="text-[12px] text-content-subtle">
                    {billing.cancelAtPeriodEnd ? "Access ends" : "Next billing date"}
                  </p>
                  <p className="text-[13px] text-content">
                    {billing.currentPeriodEnd
                      ? formatDate(billing.currentPeriodEnd)
                      : "—"}
                  </p>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="text-[12px] text-content-subtle">
                    {annual ? "Annual price" : "Monthly price"}
                  </p>
                  <p className="lr-tabular text-[13px] font-semibold text-content">
                    {annual
                      ? billing.yearlyPrice === null
                        ? "Agreed with sales"
                        : `${formatGbp(billing.yearlyPrice)} / year`
                      : billing.monthlyPrice === null
                        ? "Agreed with sales"
                        : `${formatGbp(billing.monthlyPrice)} / month`}
                  </p>
                </div>

                {pending ? (
                  <div className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5">
                    <p className="text-[13px] font-medium text-content">
                      Changes to {planLabel(pending.plan)} on {formatDate(pending.effectiveAt)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-content-muted">
                      You keep {planLabel(billing.plan)} and its limits until then. No refund is due
                      for the current period.
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1.5"
                      loading={changePending}
                      onClick={onCancelPending}
                    >
                      Keep {planLabel(billing.plan)} instead
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-2 pt-1">
                  {trialing ? (
                    <>
                      {/* In a trial the upgrade is instant: the trial ends today on
                          the card already on file (billing.end_trial_now), with
                          the plan switchable in the dialog. No new checkout. */}
                      <UpgradeNowButton
                        label="Upgrade now: start your plan today"
                        size="md"
                        fullWidth
                      />
                      <p className="text-[12px] text-content-muted">
                        Ends your trial today and charges the card on file for {planLabel(billing.plan)}, or another
                        plan you choose. You see the amount before anything is charged.
                      </p>
                    </>
                  ) : null}
                  {upgradeTarget && !trialing && (
                    <Button
                      fullWidth
                      size="md"
                      loading={checkoutPending}
                      onClick={onUpgrade}
                    >
                      <Rocket className="size-3.5" aria-hidden />
                      {upgradeTarget === "enterprise"
                        ? "Talk to sales about Enterprise"
                        : `Upgrade to ${PLANS[upgradeTarget].name}`}
                    </Button>
                  )}
                  <Button
                    fullWidth
                    size="md"
                    variant="secondary"
                    loading={portalPending}
                    disabled={!billing.hasStripeCustomer}
                    onClick={onPortal}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Manage billing (Stripe)
                  </Button>
                  {downgradeTarget ? (
                    <>
                      <Button
                        fullWidth
                        size="sm"
                        variant="ghost"
                        loading={changePending}
                        onClick={onDowngrade}
                      >
                        {confirmDowngrade
                          ? `Confirm: switch to ${PLANS[downgradeTarget].name}`
                          : `Downgrade to ${PLANS[downgradeTarget].name}`}
                      </Button>
                      {confirmDowngrade ? (
                        <p className="text-[12px] text-content-muted">
                          {trialing
                            ? `Your trial continues unchanged; ${PLANS[downgradeTarget].name} is what you are charged for when it ends.`
                            : `Takes effect on ${
                                billing.currentPeriodEnd
                                  ? formatDate(billing.currentPeriodEnd)
                                  : "your next renewal date"
                              }. You keep ${planLabel(billing.plan)} until then, with no refund for the current period.`}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {!billing.hasStripeCustomer && (
                    <p className="text-[12px] text-content-subtle">
                      The portal and invoices become available once billing starts.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader
              title="Usage this month"
              description={
                billing.currentPeriodEnd
                  ? `Your current usage and limits. Resets on ${formatDate(billing.currentPeriodEnd)}.`
                  : "Your current usage and limits."
              }
            />
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <UsageCard
                icon={Users}
                label="Leads"
                used={billing.leadsUsed}
                limit={billing.leadLimit}
                unit="leads"
              />
              {billing.smsSegmentsUsed === null ? (
                <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
                  <p className="text-[13px] font-semibold text-content">SMS segments</p>
                  <p className="mt-2 text-[13px] text-content-muted">
                    SMS usage could not be loaded just now. Your allowance of{" "}
                    {billing.smsSegmentAllowance.toLocaleString("en-GB")} segments is unaffected.
                  </p>
                </div>
              ) : (
                <UsageCard
                  icon={MessageSquare}
                  label="SMS segments"
                  used={billing.smsSegmentsUsed}
                  limit={billing.smsSegmentAllowance}
                  unit="segments"
                />
              )}
              <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken text-content-muted">
                    <Send className="size-4" aria-hidden />
                  </span>
                  <p className="text-[13px] font-semibold text-content">Messages sent</p>
                </div>
                <p className="lr-tabular mt-3 text-[20px] font-semibold leading-none text-content">
                  {billing.messagesSent.toLocaleString("en-GB")}
                </p>
                <p className="mt-2 text-[12px] text-content-muted">
                  All channels this period. Shown for reference; only SMS segments count
                  against the SMS allowance.
                </p>
              </div>
              <UsageCard
                icon={Users}
                label="Team members"
                used={billing.seatsUsed}
                limit={billing.userLimit}
                unit="seats"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader
              title="Recent invoices"
              description="Your latest invoices from Stripe."
              action={
                billing.hasStripeCustomer ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={portalPending}
                    onClick={onPortal}
                  >
                    View all invoices
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                ) : undefined
              }
            />
          </CardHeader>
          <CardContent className="p-0">
            {invoicesError ? (
              <div className="px-5 py-4">
                <p role="alert" className="text-[13px] text-danger-600">
                  {invoicesError}
                </p>
              </div>
            ) : invoices.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No invoices yet"
                description="Invoices appear here as soon as Stripe issues the first one for this workspace."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice number</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead align="right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const meta = invoiceStatusMeta(invoice.status);
                    const downloadUrl = invoice.pdfUrl ?? invoice.hostedUrl;
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell>{formatDate(invoice.created)}</TableCell>
                        <TableCell>
                          <span className="text-content-muted">
                            {invoice.number ?? invoice.id}
                          </span>
                        </TableCell>
                        <TableCell numeric>
                          {new Intl.NumberFormat("en-GB", {
                            style: "currency",
                            currency: invoice.currency,
                          }).format(invoice.amountDue)}
                        </TableCell>
                        <TableCell>
                          <Badge tone={meta.tone} dot>
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell align="right">
                          {downloadUrl ? (
                            <a
                              href={downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] font-medium text-content transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                            >
                              <Download className="size-3.5" aria-hidden />
                              Download
                            </a>
                          ) : (
                            <span className="text-[12px] text-content-subtle">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4" aria-label="Subscription and billing help">
        <Card>
          <CardHeader>
            <SectionHeader
              icon={ShieldCheck}
              title="Subscription status"
              tone="info"
            />
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={`size-2.5 rounded-full ${STATUS_DOT[billing.status] ?? "bg-content-subtle"}`}
              />
              <span className="text-[16px] font-semibold text-content">
                {SUBSCRIPTION_STATUS[
                  billing.status as keyof typeof SUBSCRIPTION_STATUS
                ]?.label ?? billing.status}
              </span>
            </p>
            <p className="text-[13px] text-content-muted">
              {STATE_COPY[billing.state] ??
                STATUS_COPY[billing.status] ??
                "Your subscription state is shown as Stripe reports it."}
            </p>
            {billing.status === "TRIALING" && billing.trialEndsAt ? (
              <p className="text-[13px] text-content">
                Trial ends {formatDate(billing.trialEndsAt)}
              </p>
            ) : null}
            {billing.paymentMethod ? (
              <p className="flex items-center gap-1.5 text-[13px] text-content-secondary">
                <CreditCard className="size-3.5" aria-hidden />
                <span className="capitalize">{billing.paymentMethod.brand}</span> ending{" "}
                {billing.paymentMethod.last4}, verified by Stripe
              </p>
            ) : null}
            {billing.retention.phase === "ending" && billing.retention.endsAt ? (
              <p className="text-[13px] text-content">
                Access ends {formatDate(billing.retention.endsAt)}. The workspace then stays read-only until{" "}
                {billing.retention.readOnlyUntil ? formatDate(billing.retention.readOnlyUntil) : "90 days later"}.
              </p>
            ) : null}
            {billing.retention.phase === "read_only" && billing.retention.readOnlyUntil ? (
              <p className="text-[13px] text-content">
                Read-only until {formatDate(billing.retention.readOnlyUntil)}. Export anything you need before then, or
                resubscribe to keep everything.
                {billing.retention.numberReleaseAt
                  ? ` A dedicated number is released on ${formatDate(billing.retention.numberReleaseAt)}.`
                  : ""}
              </p>
            ) : null}
            {billing.retention.phase === "deletion_due" ? (
              <p className="text-[13px] text-content">
                The read-only period has ended and this workspace is due for deletion under our privacy policy.
                Resubscribe now if you still need it.
              </p>
            ) : null}
            <p className="pt-1.5 text-[12px] text-content-muted">{billing.retention.policy}</p>
          </CardContent>
        </Card>

        {billing.overLimit.length > 0 ? (
          <Card>
            <CardHeader>
              <SectionHeader icon={Info} title="Over your plan's limits" tone="warning" />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[13px] text-content-muted">
                Nothing has been removed. Until you are back within the plan, adding more of these is refused.
              </p>
              <ul className="space-y-2">
                {billing.overLimit.map((item) => (
                  <li key={item.key} className="text-[13px]">
                    <p className="font-medium text-content">
                      {item.label}: {item.used} of {item.limit}
                    </p>
                    <p className="text-content-secondary">
                      {item.action}{" "}
                      <Link href={item.href} className="font-medium text-content-accent">
                        Manage
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* The "Need to make changes?" card opened the same Stripe portal as
            Manage billing (Stripe) in the plan card; one control is kept (8.8). */}
        <Card>
          <CardHeader>
            <SectionHeader icon={CircleHelp} title="Billing help" tone="info" />
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {HELP_LINKS.map((entry) => {
                const Icon = entry.icon;
                const body = (
                  <>
                    <Icon
                      className="size-4 shrink-0 text-info-600"
                      aria-hidden
                    />
                    {entry.label}
                  </>
                );
                const className =
                  "flex w-full items-center gap-2.5 rounded-md py-1 text-left text-[13px] font-medium text-content-accent transition-colors hover:text-content disabled:cursor-not-allowed disabled:text-content-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent";

                return (
                  <li key={entry.label}>
                    {entry.href ? (
                      <Link href={entry.href} className={className}>
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={onPortal}
                        disabled={!billing.hasStripeCustomer}
                        className={className}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
