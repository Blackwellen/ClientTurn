import * as React from "react";
import Link from "next/link";
import { Clock, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_STATE_TONE,
  describeCommission,
  describeAttribution,
  describePayout,
} from "@/lib/affiliates/programme";
import type { AffiliateAccount } from "@/lib/affiliates/portal";

/**
 * What a partner sees before they are earning (V4 §29).
 *
 * Deliberately not an empty dashboard. Eight zeroed KPI cards and five empty
 * tables read as "something is broken", when the truth is "a person is reading
 * your application". So the portal shows the state, what happens next, and the
 * programme terms they signed up to — which is the one genuinely useful thing
 * to read while waiting.
 */
export function ApplicationStatusPanel({
  affiliate,
}: {
  affiliate: AffiliateAccount;
}) {
  const copy = STATE_COPY[affiliate.status] ?? STATE_COPY.APPLIED;
  const Icon = copy.icon;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-[14px] border border-line bg-surface p-6 shadow-xs sm:p-8">
        <div className="flex items-start gap-4">
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-[12px] ${copy.iconClass}`}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold text-content">{copy.title}</h1>
              <Badge tone={ACCOUNT_STATE_TONE[affiliate.status]} dot>
                {ACCOUNT_STATE_LABEL[affiliate.status]}
              </Badge>
            </div>
            <p className="mt-2 text-[14.5px] leading-relaxed text-content-secondary">
              {copy.body}
            </p>
            {affiliate.statusReason && (
              <p className="mt-3 rounded-[9px] border border-line bg-surface-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-content-secondary">
                {affiliate.statusReason}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-7 grid gap-3 border-t border-line-subtle pt-6 sm:grid-cols-2">
          <Term label="Reference" value={affiliate.reference} />
          <Term
            label="Applied"
            value={new Date(affiliate.joinedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          />
        </dl>

        <div className="mt-6 space-y-3 rounded-[11px] border border-line-subtle bg-surface-sunken/60 p-4">
          <h2 className="text-[13.5px] font-semibold text-content">
            The programme terms
          </h2>
          <ul className="space-y-2 text-[13px] leading-relaxed text-content-secondary">
            <li>{describeCommission(affiliate.policy)}</li>
            <li>{describeAttribution(affiliate.policy)}</li>
            <li>{describePayout(affiliate.policy)}</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link
            href="/affiliates/app/settings"
            className="inline-flex h-10 items-center rounded-[9px] border border-line bg-surface px-4 text-[13.5px] font-medium text-content hover:bg-surface-hover"
          >
            Account settings
          </Link>
          <Link
            href="/affiliates"
            className="inline-flex h-10 items-center rounded-[9px] px-4 text-[13.5px] font-medium text-content-muted hover:text-content"
          >
            About the programme
          </Link>
        </div>
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-medium text-content">{value}</dd>
    </div>
  );
}

const STATE_COPY: Record<
  string,
  {
    title: string;
    body: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
  }
> = {
  APPLIED: {
    title: "Your application is with us",
    body: "We review new partners within two working days. As soon as you are approved, your referral links, resources and reporting all unlock here.",
    icon: Clock,
    iconClass: "bg-warning-50 text-warning-700",
  },
  PENDING_REVIEW: {
    title: "Your application is under review",
    body: "Someone is reading it now. We will email you at the address on your application as soon as there is a decision.",
    icon: Clock,
    iconClass: "bg-warning-50 text-warning-700",
  },
  APPROVED: {
    title: "You are approved",
    body: "Your account is being set up and will be ready to earn shortly. Nothing further is needed from you.",
    icon: Clock,
    iconClass: "bg-info-50 text-info-700",
  },
  SUSPENDED: {
    title: "Your account is suspended",
    body: "Referral links are paused and no new commission is accruing. Any commission already approved is unaffected. Reply to your last email from us and we will pick it up.",
    icon: ShieldAlert,
    iconClass: "bg-danger-50 text-danger-700",
  },
  REJECTED: {
    title: "We could not accept this application",
    body: "That is not always permanent. If your audience or plans have changed since you applied, get in touch and we will take another look.",
    icon: XCircle,
    iconClass: "bg-surface-sunken text-content-muted",
  },
  CLOSED: {
    title: "This account is closed",
    body: "Your historical referrals and payout records are kept for your records. Contact us if you would like to rejoin.",
    icon: XCircle,
    iconClass: "bg-surface-sunken text-content-muted",
  },
};
