import * as React from "react";
import Link from "next/link";
import { CreditCard, Gauge, LayoutGrid } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/session";
import { getBillingView } from "@/lib/settings/queries";
import { planLabel } from "@/lib/settings/types";
import { planOrder, PLANS, type PlanId } from "@/lib/billing/plans";
import { formatDate, formatGbp } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { UsageMeter } from "@/components/ui/progress";
import { SectionHeader } from "@/components/app/page-header";
import {
  ManageBillingButton,
  UpgradeButton,
} from "@/components/settings/billing-actions";
import { PermissionDenied } from "@/components/settings/notices";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const workspace = await requireWorkspace();

  if (workspace.role !== "owner") {
    return (
      <PermissionDenied
        title="Billing is owner-only"
        description="Only the workspace owner can see plan details, usage against limits and invoices. Ask them if you need a change to the plan."
      />
    );
  }

  const billing = await getBillingView(workspace.businessId);
  const currentPlan = billing.plan as PlanId;
  const currentIndex = planOrder().findIndex((plan) => plan.id === currentPlan);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <SectionHeader
            icon={CreditCard}
            title="Current plan"
            action={<StatusBadge kind="subscription" value={billing.status} />}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-content text-[24px] font-semibold leading-none">
              {planLabel(billing.plan)}
            </p>
            {currentPlan !== "trial" && PLANS[currentPlan as Exclude<PlanId, "trial">]?.monthlyPrice !== null && (
              <p className="text-content-muted text-[13px]">
                {formatGbp(
                  PLANS[currentPlan as Exclude<PlanId, "trial">].monthlyPrice ?? 0,
                )}{" "}
                per month
              </p>
            )}
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            {billing.trialEndsAt && billing.status === "TRIALING" && (
              <div>
                <dt className="text-content-subtle text-[12px]">Trial ends</dt>
                <dd className="text-content text-[13px]">
                  {formatDate(billing.trialEndsAt)}
                </dd>
              </div>
            )}
            {billing.currentPeriodEnd && (
              <div>
                <dt className="text-content-subtle text-[12px]">
                  {billing.cancelAtPeriodEnd ? "Access ends" : "Renews"}
                </dt>
                <dd className="text-content text-[13px]">
                  {formatDate(billing.currentPeriodEnd)}
                </dd>
              </div>
            )}
            {billing.billingInterval && (
              <div>
                <dt className="text-content-subtle text-[12px]">Billed</dt>
                <dd className="text-content text-[13px]">
                  {billing.billingInterval === "year" ? "Yearly" : "Monthly"}
                </dd>
              </div>
            )}
          </dl>

          <div className="border-line flex flex-wrap items-center gap-3 border-t pt-4">
            <ManageBillingButton
              disabled={!billing.hasStripeCustomer}
              disabledReason="Choose a paid plan first — the portal and invoices become available once billing starts."
            />
            {billing.hasStripeCustomer && (
              <p className="text-content-muted text-[12px]">
                Invoices, payment method and cancellation are all handled in the
                Stripe billing portal.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={Gauge}
            title="Usage this period"
            description="Counted against the allowance included in your plan."
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <UsageMeter
            label="Leads processed"
            used={billing.leadsUsed}
            limit={billing.leadLimit}
          />
          <UsageMeter
            label="Team seats"
            used={billing.seatsUsed}
            limit={billing.userLimit}
          />
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-content text-[13px] font-medium">Messages sent</p>
              <p className="text-content-muted lr-tabular text-[12px]">
                {billing.messagesUsed.toLocaleString("en-GB")}
              </p>
            </div>
            <p className="text-content-muted mt-1 text-[12px]">
              Messages are not capped by your plan. They are shown so you can see
              the volume behind your leads.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            icon={LayoutGrid}
            title="Plans"
            description="Change plan at any time. Limits apply from the moment the change takes effect."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {planOrder().map((plan, index) => {
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className="border-line flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-content text-[13px] font-semibold">
                    {plan.name}
                    {isCurrent && (
                      <span className="text-content-subtle ml-2 text-[12px] font-normal">
                        Current plan
                      </span>
                    )}
                  </p>
                  <p className="text-content-muted mt-0.5 text-[13px]">
                    {plan.tagline}
                  </p>
                  <p className="text-content-secondary mt-1 text-[12px]">
                    {plan.leadLimit.toLocaleString("en-GB")} leads ·{" "}
                    {plan.userLimit} {plan.userLimit === 1 ? "user" : "users"}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <p className="text-content lr-tabular text-[13px] font-semibold">
                    {plan.monthlyPrice === null
                      ? "Contact sales"
                      : `${formatGbp(plan.monthlyPrice)}/mo`}
                  </p>
                  {isCurrent ? null : plan.selfServe ? (
                    <UpgradeButton
                      plan={plan.id}
                      label={index > currentIndex ? "Upgrade" : "Switch"}
                      variant={index > currentIndex ? "primary" : "secondary"}
                    />
                  ) : (
                    <Link
                      href="/contact-sales"
                      className="text-content-accent focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Contact sales
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
