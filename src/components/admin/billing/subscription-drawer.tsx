"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Ban,
  CircleDollarSign,
  ExternalLink,
  Sparkles,
  Timer,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody } from "@/components/ui/drawer";
import { Input, Select } from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
} from "@/lib/admin/format";
import {
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_TONE,
  type SubscriptionDetail,
} from "@/lib/admin/billing-types";

const TABS = ["Overview", "Billing", "Entitlements", "Usage", "Events"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-words text-content">
        {children}
      </dd>
    </div>
  );
}

/**
 * The subscription drawer. Every action here changes Stripe and lets the
 * webhook update our mirror — none of them writes a plan or a period directly,
 * which is why each one reports "as soon as the webhook lands" rather than
 * pretending the change is already reflected locally.
 */
export function SubscriptionDrawer({
  subscription,
  plans,
  pending,
  onClose,
  onChangePlan,
  onCancel,
  onRevertCancellation,
  onApplyCredit,
  onGrantEntitlement,
  onExtendTrial,
}: {
  subscription: SubscriptionDetail;
  plans: { value: string; label: string }[];
  pending: string | null;
  onClose: () => void;
  onChangePlan: (plan: string, interval?: "month" | "year") => void;
  onCancel: (reason: string) => void;
  onRevertCancellation: () => void;
  onApplyCredit: (amount: number, reason: string, supportReference?: string) => void;
  onGrantEntitlement: (
    key: string,
    value: number,
    reason: string,
    expiresAt: string,
  ) => void;
  onExtendTrial: (trialEndsAt: string, reason: string) => void;
}) {
  // Mounted under `key={subscription.id}`. The remount matters for more than
  // the tab: the action forms below seed their state from props, and a
  // `useState` initialiser does not re-run, so without it a half-typed credit
  // for one customer would carry over to the next one opened.
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [panel, setPanel] = React.useState<null | "plan" | "credit" | "grant" | "trial">(
    null,
  );

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={subscription.businessName}
      header={
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[16px] font-semibold text-content">
              {subscription.businessName}
            </h2>
            <Badge tone={SUBSCRIPTION_STATUS_TONE[subscription.status]} dot>
              {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-content-muted">
            {subscription.domain ?? "No domain recorded"} · Customer since{" "}
            {formatDate(subscription.createdAt)}
          </p>
        </div>
      }
    >
      <div className="border-b border-line px-5">
        <div role="tablist" aria-label="Subscription detail" className="flex gap-1 overflow-x-auto">
          {TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                tab === option
                  ? "border-accent-500 text-content-accent"
                  : "border-transparent text-content-muted hover:text-content",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <DrawerBody className="space-y-4">
        {tab === "Overview" && (
          <>
            <section className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-content">
                  Subscription details
                </h3>
                {subscription.stripeDashboardUrl && (
                  <Link
                    href={subscription.stripeDashboardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent hover:underline"
                  >
                    View in Stripe
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                )}
              </div>
              <dl className="divide-y divide-line-subtle">
                <Row label="Subscription ID">
                  <span className="lr-tabular break-all">
                    {subscription.stripeSubscriptionId ?? "Not in Stripe"}
                  </span>
                </Row>
                <Row label="Plan">{subscription.planLabel}</Row>
                <Row label="Status">
                  {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
                </Row>
                <Row label="Price">
                  {subscription.price ? `${formatMoney(subscription.price)} / month` : "—"}
                </Row>
                <Row label="Billing cycle">{subscription.billingCycle}</Row>
                <Row label="Current period">
                  {subscription.currentPeriodStart && subscription.currentPeriodEnd
                    ? `${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`
                    : "—"}
                </Row>
                <Row label="Next billing date">
                  {subscription.cancelAtPeriodEnd
                    ? `Cancels ${formatDate(subscription.cancellationEffectiveOn)}`
                    : subscription.nextBillingDate
                      ? formatDate(subscription.nextBillingDate)
                      : "—"}
                </Row>
                <Row label="Payment method">
                  <span className="text-content-muted">
                    Held by Stripe — never read here
                  </span>
                </Row>
                {subscription.trialEndsAt && (
                  <Row label="Trial ends">{formatDate(subscription.trialEndsAt)}</Row>
                )}
              </dl>
            </section>

            {subscription.actionBlockedReason && (
              <p className="rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-[12.5px] text-warning-700">
                {subscription.actionBlockedReason}
              </p>
            )}

            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-[13px] font-semibold text-content">
                Subscription actions
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <ActionButton
                  icon={ArrowLeftRight}
                  title="Change plan"
                  subtitle="Upgrade or downgrade"
                  disabled={!subscription.canChangePlan}
                  active={panel === "plan"}
                  onClick={() => setPanel(panel === "plan" ? null : "plan")}
                />
                {subscription.canRevertCancellation ? (
                  <ActionButton
                    icon={Undo2}
                    title="Remove cancellation"
                    subtitle={`Currently cancels ${formatDate(subscription.cancellationEffectiveOn)}`}
                    disabled={pending === `revert:${subscription.id}`}
                    onClick={onRevertCancellation}
                  />
                ) : (
                  <ActionButton
                    icon={Ban}
                    title="Cancel at period end"
                    subtitle="Keeps access until the period ends"
                    destructive
                    disabled={!subscription.canCancelAtPeriodEnd}
                    onClick={() => {
                      const reason = window.prompt(
                        "Why is this subscription being cancelled? Recorded against your account.",
                      );
                      if (reason && reason.trim().length >= 5) onCancel(reason.trim());
                    }}
                  />
                )}
                <ActionButton
                  icon={CircleDollarSign}
                  title="Apply account credit"
                  subtitle="Posts to the Stripe balance"
                  active={panel === "credit"}
                  onClick={() => setPanel(panel === "credit" ? null : "credit")}
                />
                <ActionButton
                  icon={Sparkles}
                  title="Grant entitlement"
                  subtitle="Temporary, and expires on its own"
                  active={panel === "grant"}
                  onClick={() => setPanel(panel === "grant" ? null : "grant")}
                />
                <ActionButton
                  icon={Timer}
                  title="Extend trial"
                  subtitle="Set a new trial end date"
                  disabled={subscription.status !== "TRIALING"}
                  active={panel === "trial"}
                  onClick={() => setPanel(panel === "trial" ? null : "trial")}
                />
              </div>

              {panel === "plan" && (
                <PlanForm
                  plans={plans}
                  currentPlan={subscription.plan}
                  pending={pending === `plan:${subscription.id}`}
                  onSubmit={onChangePlan}
                />
              )}
              {panel === "credit" && (
                <CreditForm
                  pending={pending === `credit:${subscription.id}`}
                  onSubmit={onApplyCredit}
                />
              )}
              {panel === "grant" && (
                <GrantForm
                  pending={pending === `grant:${subscription.id}`}
                  onSubmit={onGrantEntitlement}
                />
              )}
              {panel === "trial" && (
                <TrialForm
                  currentEnd={subscription.trialEndsAt}
                  pending={pending === `trial:${subscription.id}`}
                  onSubmit={onExtendTrial}
                />
              )}
            </section>
          </>
        )}

        {tab === "Billing" && (
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-content">
              Invoices
            </h3>
            {subscription.invoices.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-content-muted">
                Stripe holds no invoices for this customer yet.
              </p>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {subscription.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="lr-tabular block truncate text-[12.5px] text-content">
                        {invoice.number ?? invoice.id.slice(0, 16)}
                      </span>
                      <span className="block text-[11.5px] text-content-subtle">
                        {formatDate(invoice.createdAt)}
                      </span>
                    </span>
                    <span className="lr-tabular shrink-0 text-[12.5px] text-content">
                      {formatMoneyPrecise(invoice.amount)}
                    </span>
                    <Badge
                      tone={invoice.status === "paid" ? "success" : "warning"}
                      dot
                    >
                      {invoice.status}
                    </Badge>
                    {invoice.hostedUrl && (
                      <Link
                        href={invoice.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open invoice in Stripe"
                        className="text-content-subtle hover:text-content"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="border-y border-line px-4 py-2.5 text-[13px] font-semibold text-content">
              Credits &amp; adjustments
            </h3>
            {subscription.credits.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-content-muted">
                No credits have been applied to this workspace.
              </p>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {subscription.credits.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-content">
                        {entry.reason}
                      </span>
                      <span className="block text-[11.5px] text-content-subtle">
                        {formatDate(entry.createdAt)} · {entry.createdBy ?? "—"}
                      </span>
                    </span>
                    <span className="lr-tabular shrink-0 text-[12.5px] text-content">
                      {formatMoneyPrecise(entry.amount)}
                    </span>
                    <Badge
                      tone={entry.state === "APPLIED" ? "success" : "neutral"}
                      dot
                    >
                      {entry.state.charAt(0) + entry.state.slice(1).toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "Entitlements" && (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-content">
              Active grants
            </h3>
            {subscription.entitlements.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-content-muted">
                This workspace runs on its plan entitlements with no overrides.
              </p>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {subscription.entitlements.map((row) => (
                  <li key={row.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] font-medium text-content">
                        {row.keyLabel}
                      </span>
                      <span className="lr-tabular text-[12.5px] text-content">
                        {row.override !== null
                          ? formatNumber(row.override)
                          : row.booleanValue
                            ? "Enabled"
                            : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-content-subtle">
                      {row.reason} ·{" "}
                      {row.expiresAt
                        ? `${row.expired ? "expired" : "expires"} ${formatDate(row.expiresAt)}`
                        : "no expiry"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "Usage" && (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-content">
              Usage this period
            </h3>
            <ul className="space-y-3">
              {subscription.usage.map((metric) => (
                <li key={metric.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] text-content-secondary">
                      {metric.label}
                    </span>
                    <span className="lr-tabular text-[12.5px] text-content">
                      {formatNumber(metric.used)}
                      {metric.limit !== null ? ` / ${formatNumber(metric.limit)}` : ""}
                    </span>
                  </div>
                  {metric.limit !== null && (
                    <Progress
                      className="mt-1.5 h-1"
                      value={metric.used}
                      max={metric.limit}
                      tone={
                        metric.used >= metric.limit
                          ? "danger"
                          : metric.used / metric.limit >= 0.8
                            ? "warning"
                            : "success"
                      }
                      label={metric.label}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "Events" && (
          <ol className="space-y-3">
            {subscription.events.length === 0 ? (
              <li className="text-[12.5px] text-content-muted">
                No billing events have been recorded for this workspace.
              </li>
            ) : (
              subscription.events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success-500"
                  />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-content">{event.summary}</p>
                    <p className="lr-tabular text-[11.5px] text-content-subtle">
                      {formatDateTime(event.at)}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ol>
        )}
      </DrawerBody>
    </Drawer>
  );
}

/* ----------------------------------------------------------- sub-forms --- */

function ActionButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled,
  destructive,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-accent-500 bg-accent-50/60"
          : destructive
            ? "border-danger-100 bg-danger-50/60 hover:bg-danger-50"
            : "border-line bg-surface hover:bg-surface-hover",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          destructive ? "text-danger-600" : "text-content-accent",
        )}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-content">{title}</span>
        <span className="block text-[11.5px] text-content-muted">{subtitle}</span>
      </span>
    </button>
  );
}

function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-surface-sunken p-3">
      {children}
    </div>
  );
}

function PlanForm({
  plans,
  currentPlan,
  pending,
  onSubmit,
}: {
  plans: { value: string; label: string }[];
  currentPlan: string;
  pending: boolean;
  onSubmit: (plan: string, interval?: "month" | "year") => void;
}) {
  const [plan, setPlan] = React.useState("");
  const [interval, setInterval] = React.useState<"month" | "year">("month");

  return (
    <FormShell>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          New plan
        </span>
        <Select value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="">Choose a plan…</option>
          {plans
            .filter((option) => option.value !== "trial" && option.value !== currentPlan)
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </Select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Billing interval
        </span>
        <Select
          value={interval}
          onChange={(event) => setInterval(event.target.value as "month" | "year")}
        >
          <option value="month">Monthly</option>
          <option value="year">Annual</option>
        </Select>
      </label>
      <p className="text-[11.5px] text-content-muted">
        Stripe calculates the proration. Entitlements follow once the subscription
        webhook lands.
      </p>
      <Button
        size="sm"
        disabled={!plan || pending}
        onClick={() => onSubmit(plan, interval)}
      >
        Change plan
      </Button>
    </FormShell>
  );
}

function CreditForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (amount: number, reason: string, supportReference?: string) => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= 10_000 && reason.trim().length >= 5;

  return (
    <FormShell>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Amount (£)
        </span>
        <Input
          type="number"
          min="0.01"
          max="10000"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Reason
        </span>
        <Input
          value={reason}
          placeholder="Why is this credit being issued?"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Support reference (optional)
        </span>
        <Input value={reference} onChange={(event) => setReference(event.target.value)} />
      </label>
      <Button
        size="sm"
        disabled={!valid || pending}
        onClick={() => onSubmit(value, reason.trim(), reference.trim() || undefined)}
      >
        Apply credit
      </Button>
    </FormShell>
  );
}

const GRANTABLE = [
  { value: "lead_limit", label: "Lead allowance" },
  { value: "user_limit", label: "Users" },
  { value: "sms_segments", label: "SMS segments" },
  { value: "ai_tokens", label: "AI tokens" },
  { value: "sourcing_credits", label: "Sourcing allowance" },
];

function GrantForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (key: string, value: number, reason: string, expiresAt: string) => void;
}) {
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const numeric = Number(value);
  const valid =
    !!key && Number.isFinite(numeric) && numeric >= 0 && reason.trim().length >= 5 && !!expiresAt;

  return (
    <FormShell>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Entitlement
        </span>
        <Select value={key} onChange={(event) => setKey(event.target.value)}>
          <option value="">Choose…</option>
          {GRANTABLE.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Value
        </span>
        <Input
          type="number"
          min="0"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Expires on
        </span>
        <Input
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Reason
        </span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <p className="text-[11.5px] text-content-muted">
        A grant may run for at most 180 days and expires without anyone having to
        remember it.
      </p>
      <Button
        size="sm"
        disabled={!valid || pending}
        onClick={() => onSubmit(key, numeric, reason.trim(), expiresAt)}
      >
        Grant entitlement
      </Button>
    </FormShell>
  );
}

function TrialForm({
  currentEnd,
  pending,
  onSubmit,
}: {
  currentEnd: string | null;
  pending: boolean;
  onSubmit: (trialEndsAt: string, reason: string) => void;
}) {
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const valid = !!date && reason.trim().length >= 5;

  return (
    <FormShell>
      <p className="text-[12px] text-content-muted">
        Current trial ends {currentEnd ? formatDate(currentEnd) : "— not set"}.
      </p>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          New trial end
        </span>
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-content-muted">
          Reason
        </span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <Button
        size="sm"
        disabled={!valid || pending}
        onClick={() => onSubmit(date, reason.trim())}
      >
        Extend trial
      </Button>
    </FormShell>
  );
}
