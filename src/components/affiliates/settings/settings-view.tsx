"use client";

import * as React from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Bell,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Info,
  Settings2,
  ShieldCheck,
  User,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Panel } from "@/components/affiliates/portal-ui";
import {
  AFFILIATE_SETTINGS_SECTIONS,
  type AffiliateSettingsSection,
} from "@/lib/affiliates/nav";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_STATE_TONE,
  CONNECT_STATE_LABEL,
  IDENTITY_STATE_LABEL,
  IDENTITY_STATE_TONE,
  NOTIFICATION_PREFS,
  RANGE_LABEL,
  RANGE_KEYS,
  TAX_ENTITY_TYPES,
  TAX_STATE_LABEL,
  TAX_STATE_TONE,
  TIER_EXPLANATION,
  TIER_LABEL,
  maskIdentifier,
  type NotificationPrefKey,
  type RangeKey,
} from "@/lib/affiliates/programme";
import { formatMinor, ALLOWED_DESTINATIONS } from "@/lib/affiliates/types";
import {
  openStripeDashboard,
  startStripeOnboarding,
  syncStripeState,
  updateAffiliatePreferences,
  updateAffiliateProfile,
  updateNotificationPreferences,
  updateTaxInformation,
} from "@/lib/affiliates/settings-actions";
import type { AffiliateAccount } from "@/lib/affiliates/portal";
import type { ReadinessCheck } from "@/lib/affiliates/payouts";

const SECTION_ICON: Record<AffiliateSettingsSection, React.ComponentType<{ className?: string }>> = {
  account: User,
  payments: CreditCard,
  identity: ShieldCheck,
  tax: FileText,
  notifications: Bell,
  preferences: Settings2,
};

/**
 * Affiliate settings (V4 §36).
 *
 * Six sections behind one sidebar destination. They are card navigation rather
 * than six rail entries deliberately: a rail that grows a row per settings page
 * stops being navigation and becomes a table of contents.
 *
 * The section lives in the URL so a link into "payments" works — which matters,
 * because half the prompts in this product point a partner at their payout
 * setup.
 */
export function AffiliateSettingsView({
  affiliate,
  section,
  readinessChecks,
  totals,
  justConnected,
}: {
  affiliate: AffiliateAccount;
  section: AffiliateSettingsSection;
  readinessChecks: ReadinessCheck[];
  totals: { referrals: number; lifetimeMinor: number; nextPayoutMinor: number };
  justConnected: boolean;
}) {
  return (
    <>
      <nav aria-label="Settings sections" className="mb-4">
        <ul className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {AFFILIATE_SETTINGS_SECTIONS.map((entry) => {
            const Icon = SECTION_ICON[entry.key];
            const active = section === entry.key;
            return (
              <li key={entry.key}>
                <Link
                  href={`/affiliates/app/settings?section=${entry.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[11px] border bg-surface px-3 py-3 transition-colors",
                    active
                      ? "border-accent-500 ring-1 ring-accent-500"
                      : "border-line hover:bg-surface-hover",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-[9px]",
                      active ? "bg-accent-50" : "bg-surface-sunken",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4",
                        active ? "text-content-accent" : "text-content-muted",
                      )}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-content">
                      {entry.label}
                    </span>
                    <span className="block truncate text-[11.5px] text-content-muted">
                      {entry.caption}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {justConnected && (
        <div className="mb-3 flex items-start gap-2.5 rounded-[11px] border border-success-100 bg-success-50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
          <p className="text-[13px] leading-relaxed text-success-700">
            You&rsquo;re back from Stripe. We&rsquo;ve refreshed your payout
            status below — if Stripe still needs anything, it will say so.
          </p>
        </div>
      )}

      {section === "account" && (
        <AccountSection affiliate={affiliate} totals={totals} />
      )}
      {section === "payments" && (
        <PaymentsSection affiliate={affiliate} checks={readinessChecks} />
      )}
      {section === "identity" && <IdentitySection affiliate={affiliate} />}
      {section === "tax" && <TaxSection affiliate={affiliate} />}
      {section === "notifications" && (
        <NotificationsSection affiliate={affiliate} />
      )}
      {section === "preferences" && <PreferencesSection affiliate={affiliate} />}
    </>
  );
}

/* --------------------------------------------------------------- account -- */

function AccountSection({
  affiliate,
  totals,
}: {
  affiliate: AffiliateAccount;
  totals: { referrals: number; lifetimeMinor: number; nextPayoutMinor: number };
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    displayName: affiliate.displayName,
    contactEmail: affiliate.contactEmail,
    companyName: affiliate.companyName ?? "",
    websiteUrl: affiliate.websiteUrl ?? "",
    country: affiliate.country ?? "",
    timezone: affiliate.timezone,
    phone: affiliate.phone ?? "",
    preferredLanguage: affiliate.preferredLanguage,
  });

  function onSave() {
    startTransition(async () => {
      const result = await updateAffiliateProfile(form);
      if (result.ok) {
        toast({ variant: "success", title: result.message ?? "Saved." });
        setEditing(false);
      } else {
        toast({ variant: "error", title: "Not saved", description: result.error });
      }
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={User}
        title="Profile Information"
        description="Keep your information up to date. This will be used for payments and communication."
        action={
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            className="rounded-[8px] border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        }
      >
        <div className="px-4 pb-4">
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Full name"
                value={form.displayName}
                onChange={(value) => setForm({ ...form, displayName: value })}
              />
              <TextField
                label="Email address"
                type="email"
                value={form.contactEmail}
                onChange={(value) => setForm({ ...form, contactEmail: value })}
              />
              <TextField
                label="Business name (optional)"
                value={form.companyName}
                onChange={(value) => setForm({ ...form, companyName: value })}
              />
              <TextField
                label="Website (optional)"
                value={form.websiteUrl}
                onChange={(value) => setForm({ ...form, websiteUrl: value })}
                placeholder="https://"
              />
              <TextField
                label="Country"
                value={form.country}
                onChange={(value) => setForm({ ...form, country: value })}
              />
              <TextField
                label="Time zone"
                value={form.timezone}
                onChange={(value) => setForm({ ...form, timezone: value })}
              />
              <TextField
                label="Phone number (optional)"
                value={form.phone}
                onChange={(value) => setForm({ ...form, phone: value })}
              />
              <TextField
                label="Preferred language"
                value={form.preferredLanguage}
                onChange={(value) =>
                  setForm({ ...form, preferredLanguage: value })
                }
              />
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={pending}
                  className="inline-flex h-10 items-center rounded-[9px] bg-accent-500 px-4 text-[13.5px] font-semibold text-brand-midnight disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <ReadField label="Full name" value={affiliate.displayName} />
              <ReadField label="Email address" value={affiliate.contactEmail} />
              <ReadField
                label="Business name (optional)"
                value={affiliate.companyName ?? "—"}
              />
              <ReadField
                label="Website (optional)"
                value={affiliate.websiteUrl ?? "—"}
              />
              <ReadField label="Country" value={affiliate.country ?? "—"} />
              <ReadField label="Time zone" value={affiliate.timezone} />
              <ReadField label="Phone number (optional)" value={affiliate.phone ?? "—"} />
              <ReadField
                label="Preferred language"
                value={affiliate.preferredLanguage}
              />
            </dl>
          )}
        </div>
      </Panel>

      <div className="min-w-0 space-y-3">
        <Panel
          icon={User}
          title="Affiliate Status"
          description="Your affiliate account status and standing."
          action={
            <Badge tone={ACCOUNT_STATE_TONE[affiliate.status]} dot>
              {ACCOUNT_STATE_LABEL[affiliate.status]}
            </Badge>
          }
        >
          <div className="px-4 pb-4">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-[12px] text-content-muted">Affiliate ID</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[14px] font-medium tabular-nums text-content">
                    {affiliate.reference}
                  </span>
                  <CopyReference value={affiliate.reference} />
                </dd>
              </div>
              <ReadField
                label="Joined"
                value={new Date(affiliate.joinedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
              <div>
                <dt className="text-[12px] text-content-muted">Affiliate tier</dt>
                <dd className="mt-1 flex items-center gap-1.5">
                  <Badge tone="info" dense>
                    {TIER_LABEL[affiliate.tier]}
                  </Badge>
                  {/* The tier changes nothing about the rate today, and the
                      tooltip says so rather than implying benefits. */}
                  <span title={TIER_EXPLANATION}>
                    <Info className="size-3.5 text-content-subtle" aria-hidden />
                    <span className="sr-only">{TIER_EXPLANATION}</span>
                  </span>
                </dd>
              </div>
              <ReadField
                label="Total referrals"
                value={totals.referrals.toLocaleString("en-GB")}
              />
              <ReadField
                label="Total commission earned"
                value={formatMinor(totals.lifetimeMinor, affiliate.policy.currency)}
              />
              <ReadField
                label="Next payout"
                value={formatMinor(
                  totals.nextPayoutMinor,
                  affiliate.policy.currency,
                )}
              />
            </dl>
          </div>
        </Panel>

        {affiliate.status === "ACTIVE" && (
          <div className="flex items-start gap-2.5 rounded-[11px] border border-success-100 bg-success-50 px-4 py-3.5">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden />
            <div>
              <p className="text-[13.5px] font-semibold text-success-700">
                You&rsquo;re all set!
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-success-700">
                Your account is active and you can continue referring customers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- payments -- */

function PaymentsSection({
  affiliate,
  checks,
}: {
  affiliate: AffiliateAccount;
  checks: ReadinessCheck[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function connect() {
    startTransition(async () => {
      const result = await startStripeOnboarding();
      if (result.ok && result.redirectUrl) {
        // A hosted Stripe page, not an in-app route: full navigation.
        window.location.href = result.redirectUrl;
      } else if (!result.ok) {
        toast({ variant: "error", title: "Could not start setup", description: result.error });
      }
    });
  }

  function manage() {
    startTransition(async () => {
      const result = await openStripeDashboard();
      if (result.ok && result.redirectUrl) {
        window.open(result.redirectUrl, "_blank", "noopener,noreferrer");
      } else if (!result.ok) {
        toast({ variant: "error", title: "Could not open Stripe", description: result.error });
      }
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await syncStripeState();
      toast(
        result.ok
          ? { variant: "success", title: result.message ?? "Refreshed." }
          : { variant: "error", title: "Not refreshed", description: result.error },
      );
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={CreditCard}
        title="Payment Method"
        description="Connect your Stripe account to receive payouts securely."
        action={
          <a
            href="https://stripe.com/gb/connect"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent hover:underline"
          >
            Why we use Stripe
            <ExternalLink className="size-3" aria-hidden />
          </a>
        }
      >
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-line bg-surface-sunken/50 p-3.5">
            <div className="min-w-0">
              <p className="text-[15px] font-bold tracking-tight text-[#635bff]">
                stripe
              </p>
              <p className="mt-1 text-[13.5px] text-content">
                Your Stripe account is{" "}
                <span
                  className={cn(
                    "font-semibold",
                    affiliate.connectState === "READY"
                      ? "text-success-700"
                      : "text-content-secondary",
                  )}
                >
                  {CONNECT_STATE_LABEL[affiliate.connectState].toLowerCase()}
                </span>
              </p>
              <p className="mt-0.5 text-[12px] text-content-muted">
                {affiliate.hasConnectAccount
                  ? "Payouts are sent to your connected Stripe account."
                  : "Connect an account so we can send your commission."}
              </p>
            </div>

            {affiliate.hasConnectAccount ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={manage}
                  disabled={pending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3.5 text-[12.5px] font-medium text-content hover:bg-surface-hover disabled:opacity-60"
                >
                  Manage in Stripe
                  <ExternalLink className="size-3.5" aria-hidden />
                </button>
                {affiliate.connectState !== "READY" && (
                  <button
                    type="button"
                    onClick={connect}
                    disabled={pending}
                    className="inline-flex h-9 items-center rounded-[9px] bg-accent-500 px-3.5 text-[12.5px] font-semibold text-brand-midnight disabled:opacity-60"
                  >
                    Finish setup
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={connect}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-[9px] bg-accent-500 px-4 text-[13px] font-semibold text-brand-midnight disabled:opacity-60"
              >
                {pending ? "Opening Stripe…" : "Connect Stripe"}
              </button>
            )}
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <StateTile
              done={affiliate.hasConnectAccount}
              title="Account connected"
              body={
                affiliate.connectSyncedAt
                  ? `Last checked ${new Date(affiliate.connectSyncedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                  : "Not connected yet"
              }
            />
            <StateTile
              done={affiliate.payoutsEnabled}
              title="Payouts enabled"
              body={
                affiliate.payoutsEnabled
                  ? "You'll receive payouts automatically once you reach the minimum threshold."
                  : "Stripe has not enabled payouts on this account yet."
              }
            />
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="mt-3 text-[12.5px] font-medium text-content-accent underline underline-offset-4 disabled:opacity-60"
          >
            Refresh Stripe status
          </button>
        </div>
      </Panel>

      <Panel
        icon={BadgeCheck}
        title="Payout readiness"
        description="Everything that has to be true before money can be sent."
      >
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {checks.map((check) => (
            <li key={check.key} className="flex items-start gap-3 px-4 py-3">
              {check.state === "complete" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
              ) : check.state === "pending" ? (
                <Info className="mt-0.5 size-4 shrink-0 text-info-600" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-content">{check.label}</p>
                <p className="text-[12px] leading-relaxed text-content-muted">
                  {check.description}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px] font-medium text-content-muted">
                {check.state === "complete"
                  ? "Done"
                  : check.state === "pending"
                    ? "In progress"
                    : "Outstanding"}
              </span>
            </li>
          ))}
        </ul>
        <p className="px-4 py-3 text-[12px] leading-relaxed text-content-muted">
          Payouts run monthly. Commission is confirmed{" "}
          {affiliate.policy.holdDays} days after the payment clears, then paid
          once your approved balance reaches{" "}
          {formatMinor(affiliate.policy.minimumPayoutMinor, affiliate.policy.currency)}.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- identity -- */

function IdentitySection({ affiliate }: { affiliate: AffiliateAccount }) {
  const rows = [
    {
      label: "Identity document",
      caption:
        affiliate.identityDocument === "Verified"
          ? "Document verified"
          : "Awaiting a document",
      state: affiliate.identityDocument,
    },
    {
      label: "Selfie verification",
      caption:
        affiliate.identitySelfie === "Verified"
          ? "Identity confirmed"
          : "Awaiting confirmation",
      state: affiliate.identitySelfie,
    },
    {
      label: "Address verification",
      caption:
        affiliate.identityAddress === "Verified"
          ? "Proof of address verified"
          : "Awaiting proof of address",
      state: affiliate.identityAddress,
    },
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={ShieldCheck}
        title="Identity Verification"
        description="Complete identity verification to enable payouts."
        action={
          <Badge tone={IDENTITY_STATE_TONE[affiliate.identityStatus]} dot>
            {IDENTITY_STATE_LABEL[affiliate.identityStatus]}
          </Badge>
        }
      >
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 px-4 py-3">
              {row.state === "Verified" ? (
                <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden />
              ) : (
                <AlertTriangle className="size-4 shrink-0 text-warning-600" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-content">{row.label}</p>
                <p className="text-[12px] text-content-muted">{row.caption}</p>
              </div>
              <span className="shrink-0 text-[11.5px] tabular-nums text-content-muted">
                {affiliate.identityCheckedAt
                  ? new Date(affiliate.identityCheckedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </span>
            </li>
          ))}
        </ul>

        {/* No document numbers, no images, no expiry dates. Stripe holds the
            documents; we hold only whether it is satisfied. */}
        <p className="px-4 py-3 text-[12px] leading-relaxed text-content-muted">
          Verification is handled by Stripe. We never see or store your identity
          documents — only whether Stripe has completed its checks.
        </p>
      </Panel>

      <Panel icon={Info} title="What happens next">
        <div className="space-y-3 px-4 pb-4 text-[13px] leading-relaxed text-content-secondary">
          {affiliate.identityStatus === "VERIFIED" ? (
            <p>
              Nothing to do. Your identity is verified and payouts can be sent
              once the rest of your setup is complete.
            </p>
          ) : affiliate.identityStatus === "PENDING" ? (
            <p>
              Stripe is reviewing what you submitted. This usually takes a day or
              two, and we&rsquo;ll update this page automatically.
            </p>
          ) : (
            <>
              <p>
                Stripe still needs to verify who you are before any money can be
                sent. Continue in Stripe to finish the checks.
              </p>
              <Link
                href="/affiliates/app/settings?section=payments"
                className="inline-flex h-10 items-center rounded-[9px] bg-accent-500 px-4 text-[13.5px] font-semibold text-brand-midnight"
              >
                Continue verification
              </Link>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------- tax -- */

function TaxSection({ affiliate }: { affiliate: AffiliateAccount }) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(
    affiliate.taxStatus === "NOT_PROVIDED",
  );
  const [reveal, setReveal] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    country: affiliate.taxCountry ?? affiliate.country ?? "United Kingdom",
    entityType: affiliate.taxEntityType ?? "INDIVIDUAL",
    identifier: "",
  });

  function onSave() {
    startTransition(async () => {
      const result = await updateTaxInformation(form);
      if (result.ok) {
        toast({ variant: "success", title: result.message ?? "Saved." });
        setEditing(false);
        setForm({ ...form, identifier: "" });
      } else {
        toast({ variant: "error", title: "Not saved", description: result.error });
      }
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={FileText}
        title="Tax Information"
        description="Provide your tax information for compliance and to avoid withholding."
        action={
          <Badge tone={TAX_STATE_TONE[affiliate.taxStatus]} dot>
            {TAX_STATE_LABEL[affiliate.taxStatus]}
          </Badge>
        }
      >
        <div className="px-4 pb-4">
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Tax country"
                value={form.country}
                onChange={(value) => setForm({ ...form, country: value })}
              />
              <div>
                <label
                  htmlFor="tax-entity"
                  className="text-[12px] font-medium text-content-secondary"
                >
                  Entity type
                </label>
                <select
                  id="tax-entity"
                  value={form.entityType}
                  onChange={(event) =>
                    setForm({ ...form, entityType: event.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content"
                >
                  {TAX_ENTITY_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <TextField
                  label="Tax identification (UTR or company tax reference)"
                  value={form.identifier}
                  onChange={(value) => setForm({ ...form, identifier: value })}
                  placeholder="1234567890"
                />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-content-muted">
                  We store only the last four characters. The full reference is
                  never saved, logged or shown again.
                </p>
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={pending}
                  className="inline-flex h-10 items-center rounded-[9px] bg-accent-500 px-4 text-[13.5px] font-semibold text-brand-midnight disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Submit tax information"}
                </button>
                {affiliate.taxStatus !== "NOT_PROVIDED" && (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="inline-flex h-10 items-center rounded-[9px] border border-line px-4 text-[13.5px] font-medium text-content"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                <ReadField
                  label="Tax country"
                  value={affiliate.taxCountry ?? "—"}
                />
                <div>
                  <dt className="text-[12px] text-content-muted">
                    Tax identification
                  </dt>
                  <dd className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-[14px] font-medium tabular-nums text-content">
                      {/* Even "reveal" only ever shows the stored last four —
                          the full identifier does not exist on this server. */}
                      {reveal
                        ? (affiliate.taxIdentifierLast4 ?? "—")
                        : maskIdentifier(affiliate.taxIdentifierLast4)}
                    </span>
                    {affiliate.taxIdentifierLast4 && (
                      <button
                        type="button"
                        onClick={() => setReveal((open) => !open)}
                        aria-label={
                          reveal
                            ? "Hide the last four characters"
                            : "Show the last four characters"
                        }
                        className="text-content-subtle hover:text-content"
                      >
                        {reveal ? (
                          <EyeOff className="size-3.5" aria-hidden />
                        ) : (
                          <Eye className="size-3.5" aria-hidden />
                        )}
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-content-muted">Form status</dt>
                  <dd className="mt-1">
                    <Badge tone={TAX_STATE_TONE[affiliate.taxStatus]} dense>
                      {TAX_STATE_LABEL[affiliate.taxStatus]}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-4 inline-flex h-10 items-center rounded-[9px] border border-line bg-surface px-4 text-[13.5px] font-medium text-content hover:bg-surface-hover"
              >
                Update tax information
              </button>
            </>
          )}
        </div>
      </Panel>

      <Panel icon={Info} title="How we handle your tax details">
        <ul className="space-y-2.5 px-4 pb-4 text-[13px] leading-relaxed text-content-secondary">
          <li>
            Only your country, entity type and the last four characters of your
            reference are stored.
          </li>
          <li>
            The full reference is used once to derive that suffix and is then
            discarded. It is never written to our database or logs.
          </li>
          <li>Access to these fields is restricted and audited.</li>
          <li>
            {affiliate.taxStatus === "VERIFIED"
              ? "Your tax information is complete. We'll notify you if any updates are required."
              : "We'll let you know if anything else is needed."}
          </li>
        </ul>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------- notifications -- */

function NotificationsSection({ affiliate }: { affiliate: AffiliateAccount }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = React.useState(affiliate.notificationPrefs);
  const [pending, startTransition] = React.useTransition();

  function toggle(key: NotificationPrefKey) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    startTransition(async () => {
      const result = await updateNotificationPreferences(next);
      if (!result.ok) {
        setPrefs(prefs);
        toast({ variant: "error", title: "Not saved", description: result.error });
      }
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={Bell}
        title="Notification Preferences"
        description="Choose what you'd like to be notified about."
      >
        <ul className="divide-y divide-line-subtle border-t border-line-subtle">
          {NOTIFICATION_PREFS.map((pref) => (
            <li key={pref.key} className="flex items-center gap-3 px-4 py-3">
              <Info className="size-4 shrink-0 text-content-subtle" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-content">{pref.label}</p>
                <p className="text-[12px] leading-relaxed text-content-muted">
                  {pref.description}
                </p>
              </div>
              <Toggle
                checked={prefs[pref.key]}
                label={pref.label}
                disabled={pending}
                onChange={() => toggle(pref.key)}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel icon={Info} title="About these notifications">
        <p className="px-4 pb-4 text-[13px] leading-relaxed text-content-secondary">
          Turning one of these off stops the notification being created at all —
          it is not simply hidden. Money-related notifications (commission and
          payouts) are the ones most partners keep on, because they are how you
          find out a payout failed.
        </p>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------- preferences -- */

function PreferencesSection({ affiliate }: { affiliate: AffiliateAccount }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = React.useState(affiliate.preferences);
  const [pending, startTransition] = React.useTransition();

  function save(next: typeof prefs) {
    setPrefs(next);
    startTransition(async () => {
      const result = await updateAffiliatePreferences({
        defaultRange: next.defaultRange,
        defaultDestination: next.defaultDestination,
        resourceUpdates: next.resourceUpdates,
      });
      if (!result.ok) {
        setPrefs(prefs);
        toast({ variant: "error", title: "Not saved", description: result.error });
      }
    });
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        icon={Settings2}
        title="Reporting & tracking defaults"
        description="How your dashboard and links behave by default."
      >
        <div className="space-y-4 px-4 pb-4">
          <div>
            <label
              htmlFor="pref-range"
              className="text-[12px] font-medium text-content-secondary"
            >
              Default reporting range
            </label>
            <select
              id="pref-range"
              value={prefs.defaultRange}
              onChange={(event) =>
                save({ ...prefs, defaultRange: event.target.value as RangeKey })
              }
              disabled={pending}
              className="mt-1 h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content"
            >
              {RANGE_KEYS.filter((key) => key !== "custom").map((key) => (
                <option key={key} value={key}>
                  {RANGE_LABEL[key]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="pref-destination"
              className="text-[12px] font-medium text-content-secondary"
            >
              Default referral landing page
            </label>
            <select
              id="pref-destination"
              value={prefs.defaultDestination}
              onChange={(event) =>
                save({ ...prefs, defaultDestination: event.target.value })
              }
              disabled={pending}
              className="mt-1 h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content"
            >
              {ALLOWED_DESTINATIONS.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-content">
                Resource update alerts
              </p>
              <p className="text-[12px] text-content-muted">
                Tell me when brand assets and campaign packs are updated.
              </p>
            </div>
            <Toggle
              checked={prefs.resourceUpdates}
              label="Resource update alerts"
              disabled={pending}
              onChange={() =>
                save({ ...prefs, resourceUpdates: !prefs.resourceUpdates })
              }
            />
          </div>
        </div>
      </Panel>

      <Panel icon={Info} title="Account defaults">
        <dl className="divide-y divide-line-subtle border-t border-line-subtle">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <dt className="text-[13px] font-medium text-content">
                Currency display
              </dt>
              <dd className="text-[12px] leading-relaxed text-content-muted">
                Your ledger is denominated in {affiliate.policy.currency} and this
                cannot be changed — a converted figure is not what you will be
                paid.
              </dd>
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-content">
              {affiliate.policy.currency}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <dt className="text-[13px] font-medium text-content">Time zone</dt>
              <dd className="text-[12px] text-content-muted">
                Change this under Account.
              </dd>
            </div>
            <span className="shrink-0 text-[13px] text-content-secondary">
              {affiliate.timezone}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <dt className="text-[13px] font-medium text-content">
                Attribution window
              </dt>
              <dd className="text-[12px] text-content-muted">
                Set by the programme, not by you.
              </dd>
            </div>
            <span className="shrink-0 text-[13px] text-content-secondary">
              {affiliate.policy.attributionWindowDays} days
            </span>
          </div>
        </dl>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- fragments -- */

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content placeholder:text-content-subtle"
      />
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[14px] font-medium text-content">
        {value}
      </dd>
    </div>
  );
}

function StateTile({
  done,
  title,
  body,
}: {
  done: boolean;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-surface p-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-content">{title}</p>
        <p className="text-[12px] leading-relaxed text-content-muted">{body}</p>
      </div>
    </div>
  );
}

/** A switch with a real checkbox behind it, so it is keyboard and SR native. */
function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        checked ? "bg-info-600" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function CopyReference({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast({ variant: "success", title: "Affiliate ID copied" });
        } catch {
          toast({ variant: "error", title: "Could not copy" });
        }
      }}
      aria-label={`Copy affiliate ID ${value}`}
      className="text-content-subtle hover:text-content"
    >
      <Copy className="size-3.5" aria-hidden />
    </button>
  );
}
