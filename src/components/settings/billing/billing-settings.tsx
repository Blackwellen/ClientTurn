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
import { SectionHeader } from "@/components/app/page-header";
import { formatDate, formatGbp } from "@/lib/dates";
import { openBillingPortal, startPlanCheckout } from "@/lib/settings/actions";
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
  { label: "How billing works", icon: Info, href: "/app/help" },
  { label: "Understanding your usage", icon: Gauge, href: "/app/help" },
  { label: "Update payment method", icon: Wallet },
  { label: "View invoices", icon: Receipt },
  { label: "Contact support", icon: UserRound, href: "/contact-sales" },
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
  TRIALING: "You are on a free trial. Choose a plan before it ends to keep working.",
  PAST_DUE:
    "The last payment failed. Update your payment method in the Stripe portal to avoid interruption.",
  UNPAID: "An invoice is unpaid. Settle it in the Stripe portal to restore full access.",
  CANCELLED: "This subscription has been cancelled.",
  INCOMPLETE: "Checkout was not completed. Start it again to activate your plan.",
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
    const result = await startPlanCheckout({
      plan: upgradeTarget,
      interval: "month",
    });
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

  const period =
    billing.currentPeriodStart && billing.currentPeriodEnd
      ? `${formatDate(billing.currentPeriodStart)} – ${formatDate(billing.currentPeriodEnd)}`
      : "Not started yet";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                  <p className="text-[12px] text-content-subtle">Monthly price</p>
                  <p className="lr-tabular text-[13px] font-semibold text-content">
                    {billing.monthlyPrice === null
                      ? "Agreed with sales"
                      : `${formatGbp(billing.monthlyPrice)} / month`}
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  {upgradeTarget && (
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <UsageCard
                icon={Users}
                label="Leads"
                used={billing.leadsUsed}
                limit={billing.leadLimit}
                unit="leads"
              />
              <UsageCard
                icon={MessageSquare}
                label="Messages"
                used={billing.messagesUsed}
                limit={billing.messageAllowance}
                unit="messages"
              />
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
              {STATUS_COPY[billing.status] ??
                "Your subscription state is shown as Stripe reports it."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader icon={CreditCard} title="Need to make changes?" tone="danger" />
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] text-content-muted">
              Manage your subscription, payment method and invoices in the secure
              Stripe customer portal.
            </p>
            <Button
              fullWidth
              size="sm"
              variant="secondary"
              loading={portalPending}
              disabled={!billing.hasStripeCustomer}
              onClick={onPortal}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Open Stripe portal
            </Button>
          </CardContent>
        </Card>

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
