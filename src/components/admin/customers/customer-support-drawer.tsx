"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, Building2, Mail, RotateCw, Undo2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer, DrawerHeader } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ConnectionHealthBadge,
  InitialAvatar,
  SeverityBadge,
} from "@/components/admin/ui";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatRelative,
  formatUsagePercent,
  hasRelativePhrase,
  initialsOf,
} from "@/lib/admin/format";
import { formatTimezoneLabel } from "@/lib/dates";
import type { CustomerDetail, UsageCell } from "@/lib/admin/types";

/* --------------------------------------------------------------- sections */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-subtle px-5 py-4 first:border-t-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-content">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[3px]">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-words text-content">
        {children}
      </dd>
    </div>
  );
}

function UsageBlock({ label, usage }: { label: string; usage: UsageCell }) {
  const ratio = usage.ratio ?? 0;
  const tone = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : "success";
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-sunken/50 px-3 py-2.5">
      <p className="text-[11.5px] font-medium text-content-muted">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="lr-tabular text-[13px] font-medium text-content">
          {formatNumber(usage.used)}
          {usage.limit !== null && ` / ${formatNumber(usage.limit)}`}
        </span>
        <span className="lr-tabular text-[11.5px] text-content-muted">
          {usage.limit === null ? "Unlimited" : formatUsagePercent(usage.ratio)}
        </span>
      </div>
      {usage.limit !== null && (
        <Progress
          className="mt-2 h-1"
          value={usage.used}
          max={usage.limit}
          tone={tone}
          label={`${label} usage`}
        />
      )}
    </div>
  );
}

const CONNECTION_TONE: Record<string, string> = {
  HEALTHY: "text-success-700 bg-success-50 border-success-100",
  TESTING: "text-info-700 bg-info-50 border-info-100",
  DEGRADED: "text-warning-700 bg-warning-50 border-warning-100",
  ACTION_REQUIRED: "text-danger-700 bg-danger-50 border-danger-100",
  DISCONNECTED: "text-content-secondary bg-surface-sunken border-line",
};

const CONNECTION_LABEL: Record<string, string> = {
  HEALTHY: "Connected",
  TESTING: "Testing",
  DEGRADED: "Needs attention",
  ACTION_REQUIRED: "Action required",
  DISCONNECTED: "Not connected",
};

/* ----------------------------------------------------------------- drawer */

/**
 * One scrollable support view. Deliberately not tabbed: an operator triaging a
 * live problem should be able to read identity, plan, connections and recent
 * failures in a single pass rather than hunting across five panes.
 */
export function CustomerSupportDrawer({
  detail,
  pending,
  onClose,
  onResendOnboarding,
  onRunHealthCheck,
  onSuspend,
  onUnsuspend,
}: {
  detail: CustomerDetail;
  pending: string | null;
  onClose: () => void;
  onResendOnboarding: () => void;
  onRunHealthCheck: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
}) {
  const suspended = detail.status === "suspended";

  return (
    <Drawer
      open
      onClose={onClose}
      size="panel"
      anchor="content"
      title={`Customer support — ${detail.name}`}
      bodyClassName="px-0 py-0"
      header={
        <DrawerHeader className="flex-col items-stretch gap-0 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-content">
                Customer support
              </h2>
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                View customer details, usage, connections and recent activity.
              </p>
            </div>
            <IconButton size="sm" label="Close support panel" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>

          <div className="mt-4 flex items-start gap-3 pb-4">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-sunken text-content-muted"
            >
              <Building2 className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold text-content">
                {detail.name}
              </p>
              {detail.domain && (
                <p className="truncate text-[12.5px] text-content-subtle">
                  {detail.domain}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="subscription" value={detail.subscriptionStatus} />
                <ConnectionHealthBadge health={detail.connectionHealth} />
                {suspended && (
                  <span className="inline-flex items-center rounded-full border border-danger-100 bg-danger-50 px-2 py-0.5 text-[11px] font-medium text-danger-700">
                    Suspended
                  </span>
                )}
              </div>
            </div>
          </div>
        </DrawerHeader>
      }
    >
      {/* Quick actions. No impersonation: assuming a customer identity is out
          of scope for V1 and deliberately not built. */}
      <div className="grid grid-cols-1 gap-2 border-b border-line px-5 py-4 sm:grid-cols-3">
        <ActionButton
          icon={Mail}
          label="Resend onboarding"
          tone="accent"
          loading={pending === "onboarding"}
          onClick={onResendOnboarding}
        />
        <ActionButton
          icon={RotateCw}
          label="Run health check"
          tone="accent"
          loading={pending === "health"}
          onClick={onRunHealthCheck}
        />
        {suspended ? (
          <ActionButton
            icon={Undo2}
            label="Restore workspace"
            tone="accent"
            loading={pending === "unsuspend"}
            onClick={onUnsuspend}
          />
        ) : (
          <ActionButton
            icon={Ban}
            label="Suspend workspace"
            tone="danger"
            loading={pending === "suspend"}
            onClick={onSuspend}
          />
        )}
      </div>

      <Section title="Business information">
        <dl>
          <Field label="Business name">{detail.name}</Field>
          <Field label="Domain">{detail.domain ?? "Not supplied"}</Field>
          <Field label="Industry">{detail.industry ?? "Not supplied"}</Field>
          <Field label="Phone">{detail.phone ?? "Not supplied"}</Field>
          {/* Derived from the stored IANA identifier, so the offset follows
              DST on its own instead of going stale twice a year. */}
          <Field label="Timezone">
            {formatTimezoneLabel(detail.timezone)}
          </Field>
          <Field label="Joined">
            {formatDate(detail.createdAt)}
            {hasRelativePhrase(detail.createdAt) && (
              <span className="text-content-muted">
                {" "}
                ({formatRelative(detail.createdAt)})
              </span>
            )}
          </Field>
          <Field label="Onboarding step">{detail.onboardingStep}</Field>
          <Field label="Last health check">
            {detail.lastHealthCheckAt
              ? formatRelative(detail.lastHealthCheckAt)
              : "Never run"}
          </Field>
        </dl>
      </Section>

      <Section title={`Team members (${detail.members.length})`}>
        {detail.members.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">
            No members on this workspace.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {detail.members.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5">
                <InitialAvatar initials={initialsOf(member.name)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-content">
                    {member.name}
                  </p>
                  <p className="truncate text-[11.5px] text-content-subtle">
                    {member.email}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
                    member.role === "owner"
                      ? "border-accent-200/60 bg-accent-50 text-content-accent"
                      : "border-line bg-surface-sunken text-content-secondary",
                  )}
                >
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Plan &amp; usage">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-content">
              {detail.planLabel}
            </p>
            <p className="text-[12px] text-content-muted">
              {detail.planMonthlyPrice === null
                ? "Custom pricing"
                : `${formatMoney(detail.planMonthlyPrice)} / month`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11.5px] text-content-muted">Current period</p>
            <p className="lr-tabular text-[12.5px] text-content">
              {detail.currentPeriodStart
                ? `${formatDate(detail.currentPeriodStart)} – ${formatDate(detail.currentPeriodEnd)}`
                : detail.trialEndsAt
                  ? `Trial ends ${formatDate(detail.trialEndsAt)}`
                  : "Not started"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UsageBlock label="Leads" usage={detail.leadUsage} />
          <UsageBlock label="Messages" usage={detail.messageUsage} />
        </div>
        <p className="mt-2 text-[11.5px] text-content-subtle">
          Plan state mirrors Stripe, which remains the source of truth for
          billing.
        </p>
      </Section>

      <Section title={`Connections (${detail.integrations.length})`}>
        {detail.integrations.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">
            Nothing connected on this workspace yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.integrations.map((integration) => (
              <li
                key={integration.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium text-content">
                    {integration.label}
                  </p>
                  {integration.lastErrorMessage ? (
                    <p className="truncate text-[11.5px] text-danger-600">
                      {integration.lastErrorMessage}
                    </p>
                  ) : (
                    <p className="truncate text-[11.5px] text-content-subtle">
                      Last sync {formatRelative(integration.lastSuccessAt)}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    CONNECTION_TONE[integration.status] ??
                      CONNECTION_TONE.DISCONNECTED,
                  )}
                >
                  {CONNECTION_LABEL[integration.status] ?? integration.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] text-content-subtle">
          Access tokens, API keys and webhook secrets are never read by this
          view.
        </p>
      </Section>

      <Section
        title="Recent events"
        action={
          <Link
            href={`/admin/system?view=events&q=${encodeURIComponent(detail.name)}`}
            className="text-[12px] font-medium text-content-accent hover:underline"
          >
            View all
          </Link>
        }
      >
        {detail.events.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">
            No recorded activity for this workspace.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.events.map((event) => (
              <li key={event.id} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-success-500"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
                  {event.label}
                </span>
                <span className="shrink-0 text-[11.5px] whitespace-nowrap text-content-muted">
                  {formatRelative(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Recent errors"
        action={
          <Link
            href={`/admin/system?view=errors&q=${encodeURIComponent(detail.name)}`}
            className="text-[12px] font-medium text-content-accent hover:underline"
          >
            View all
          </Link>
        }
      >
        {detail.errors.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">
            No errors recorded for this workspace.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {detail.errors.map((error) => (
              <li key={error.id} className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-content">
                    {error.message}
                  </p>
                  <p className="text-[11.5px] text-content-subtle">
                    {error.area} · {formatRelative(error.occurredAt)}
                  </p>
                </div>
                <SeverityBadge severity={error.severity} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Drawer>
  );
}

function ActionButton({
  icon: Icon,
  label,
  tone,
  loading,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "accent" | "danger";
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3",
        "text-[12px] font-medium transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-60",
        tone === "danger"
          ? "border-danger-100 bg-danger-50 text-danger-700 hover:bg-danger-100/60"
          : "border-line bg-surface-sunken/60 text-content-secondary hover:bg-surface-hover hover:text-content",
      )}
    >
      <Icon className={cn("size-4", loading && "animate-spin")} aria-hidden />
      {label}
    </button>
  );
}
