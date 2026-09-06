"use client";

import * as React from "react";
import {
  BarChart3,
  CircleCheck,
  CircleX,
  Database,
  FileText,
  Flag,
  Info,
  Mail,
  Rocket,
  ShieldCheck,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import {
  PROMOTION_RULES,
  PROSPECT_SOURCES,
  conversionGoalMeta,
  estimateResults,
  formatCount,
  formatMoneyMinor,
  successEventLabel,
  type CampaignDraft,
  type WizardStepKey,
} from "@/lib/outreach/campaign-draft";
import type { LaunchCheck } from "@/lib/outreach/campaign-validation";
import type { CampaignWizardOptions } from "@/lib/outreach/campaigns/audience";
import type { SenderHealth } from "@/lib/outreach/campaigns/sender";
import { RadioRow, RailCard } from "./pieces";

/**
 * Step 6 — Review & Launch.
 *
 * The rail is the gate. Its rows are exactly the array the server refuses on,
 * so the Launch button being disabled always has a named reason above it —
 * there is no path where the button is dead and the page cannot say why.
 */
export function ReviewStep({
  draft,
  options,
  senders,
  checks,
  validating,
  startMode,
  onStartModeChange,
  onEdit,
}: {
  draft: CampaignDraft;
  options: CampaignWizardOptions;
  senders: SenderHealth[];
  checks: LaunchCheck[] | null;
  validating: boolean;
  startMode: "MANUAL_REVIEW" | "IMMEDIATE";
  onStartModeChange: (mode: "MANUAL_REVIEW" | "IMMEDIATE") => void;
  onEdit: (step: WizardStepKey) => void;
}) {
  const goal = draft.goal.conversionGoal ? conversionGoalMeta(draft.goal.conversionGoal) : null;
  const service = options.services.find((row) => row.id === draft.goal.primaryServiceId);
  const icp = options.icpProfiles.find((row) => row.id === draft.audience.icpProfileId);
  const search = options.savedSearches.find((row) => row.id === draft.audience.savedSearchId);
  const sender = senders.find((row) => row.id === draft.outreach.senderIdentityId);
  const categoryNames = draft.intentScore.intentCategoryIds
    .map((id) => options.intentCategories.find((row) => row.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const enabledSteps = draft.outreach.steps.filter((step) => step.enabled);
  const estimates = estimateResults(
    Math.min(draft.budget.prospectsPerRun, draft.budget.monthlyContacts),
  );

  const blocked = checks?.some((check) => check.state === "BLOCK") ?? false;
  const warned = checks?.filter((check) => check.state === "WARN") ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-line bg-surface shadow-xs">
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-success-50 text-success-600"
            >
              <FileText className="size-[18px]" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold leading-tight text-content">
                Campaign summary
              </h2>
              <p className="mt-1 text-[12.5px] text-content-muted">
                Review your campaign configuration. You can go back and edit any step before
                launching.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onEdit("goal")}>
            Edit campaign
          </Button>
        </header>

        <div className="grid gap-4 border-t border-line-subtle p-5 lg:grid-cols-3">
          <SummaryCard icon={Flag} title="Goal" onEdit={() => onEdit("goal")}>
            <Detail label="Campaign name" value={draft.goal.campaignName || "Not set"} />
            <Detail label="Conversion goal" value={goal?.label ?? "Not set"} />
            <Detail label="Primary service / product" value={service?.name ?? "Not set"} />
            <Detail
              label="Success event"
              value={
                draft.goal.successEvent ? successEventLabel(draft.goal.successEvent) : "Not set"
              }
            />
          </SummaryCard>

          <SummaryCard icon={Users} title="Audience" onEdit={() => onEdit("audience")}>
            <Detail
              label="Saved search / ICP"
              value={search?.title ?? icp?.name ?? "None"}
            />
            <Detail
              label="Locations"
              value={
                draft.audience.locations.length > 0
                  ? `${draft.audience.locations.join(", ")}${
                      draft.audience.radiusMiles
                        ? ` + ${draft.audience.radiusMiles} miles`
                        : ""
                    }`
                  : "Anywhere"
              }
            />
            <Detail
              label="Company size"
              value={draft.audience.companySizes.join(", ") || "Any"}
            />
            <Detail label="Industry" value={draft.audience.industries.join(", ") || "Any"} />
            <Detail label="Roles" value={draft.audience.roles.join(", ") || "Any"} />
            <Detail
              label="Source"
              value={
                draft.audience.source === "BOTH"
                  ? "Existing + New sourcing"
                  : (PROSPECT_SOURCES.find((s) => s.value === draft.audience.source)?.label ??
                    "—")
              }
            />
            <Detail
              label="Exclusions"
              value={
                [
                  draft.audience.exclusions.existingCustomers ? "Customers" : null,
                  draft.audience.exclusions.existingLeads ? "Leads" : null,
                  "Global suppression",
                ]
                  .filter(Boolean)
                  .join(", ")
              }
            />
          </SummaryCard>

          <SummaryCard icon={Target} title="Intent & Score" onEdit={() => onEdit("intent")}>
            <Detail label="Minimum grade" value={draft.intentScore.minimumGrade} />
            <div className="mb-2.5">
              <p className="text-[11.5px] text-content-muted">Intent categories</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {categoryNames.length > 0 ? (
                  categoryNames.map((name) => (
                    <Badge key={name} tone="success" dense>
                      {name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[12.5px] font-medium text-content">None</span>
                )}
              </div>
            </div>
            <Detail
              label="Intent requirement"
              value={draft.intentScore.intentRequired ? "Intent required" : "Intent optional"}
            />
            <Detail
              label="Maximum intent age"
              value={`Last ${draft.intentScore.maxIntentAgeDays} days`}
            />
            <Detail
              label="Review threshold"
              value={`${draft.intentScore.reviewThreshold} / 100`}
            />
          </SummaryCard>

          <SummaryCard icon={Mail} title="Outreach" onEdit={() => onEdit("outreach")} tone="info">
            <div className="mb-2.5">
              <p className="text-[11.5px] text-content-muted">Sender identity</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-content">
                  {sender?.email ?? "Not set"}
                </span>
                {sender && (
                  <Badge
                    tone={
                      sender.state === "HEALTHY"
                        ? "success"
                        : sender.state === "WARNING"
                          ? "warning"
                          : "danger"
                    }
                    dense
                  >
                    {sender.state === "HEALTHY" ? "Verified" : "Check setup"}
                  </Badge>
                )}
              </div>
            </div>
            <Detail
              label="Email sequence"
              value={`${enabledSteps.length} step${enabledSteps.length === 1 ? "" : "s"} (${enabledSteps
                .map((step) => step.delayDays)
                .join(" / ")} days)`}
            />
            <Detail
              label="Message variants"
              value={
                draft.outreach.variantsEnabled
                  ? `${draft.outreach.variantsPerStep} variants (A/B)`
                  : "Off"
              }
            />
            <Detail label="Reply classification" value="Auto-classify with team alerts" />
            <Detail
              label="Promotion to lead"
              value={
                PROMOTION_RULES.find((rule) => rule.value === draft.outreach.promotionRule)
                  ?.label ?? "Manual"
              }
            />
            <Detail
              label="Campaign start"
              value={
                draft.outreach.startMode === "MANUAL_REVIEW"
                  ? "Start after manual review"
                  : "Start automatically"
              }
            />
          </SummaryCard>

          <SummaryCard
            icon={Database}
            title="Budget & Limits"
            onEdit={() => onEdit("budget")}
            tone="purple"
          >
            <Detail
              label="Prospects per month"
              value={formatCount(draft.budget.prospectsPerRun)}
            />
            <Detail label="Daily contacts" value={formatCount(draft.budget.dailyContacts)} />
            <Detail
              label="Monthly contacts"
              value={formatCount(draft.budget.monthlyContacts)}
            />
            <Detail
              label="Provider cost ceiling"
              value={formatMoneyMinor(draft.budget.providerCostCeilingMinor)}
            />
            <Detail
              label="Communication allowance"
              value={formatCount(draft.budget.communicationAllowance)}
            />
            <Detail label="Auto overage" value={draft.budget.autoOverage ? "On" : "Off"} />
            <Detail label="Auto optimize" value={draft.budget.autoOptimize ? "On" : "Off"} />
          </SummaryCard>

          <SummaryCard icon={BarChart3} title="Estimated results" tone="warning">
            <p className="mb-2.5 text-[11.5px] leading-snug text-content-muted">
              Based on your settings and historical performance.
            </p>
            <Detail
              label="Prospects to contact"
              value={formatCount(estimates.prospectsToContact)}
            />
            <Detail
              label="Estimated replies (15–25%)"
              value={`${formatCount(estimates.replies.low)} – ${formatCount(estimates.replies.high)}`}
            />
            <Detail
              label="Estimated qualified (5–10%)"
              value={`${formatCount(estimates.qualified.low)} – ${formatCount(estimates.qualified.high)}`}
            />
            <Detail
              label={`Estimated ${goal?.label.toLowerCase() ?? "conversions"} (3–7%)`}
              value={`${formatCount(estimates.conversions.low)} – ${formatCount(estimates.conversions.high)}`}
            />
            {/* Ranges, and said plainly. A point forecast reads as a promise. */}
            <div className="mt-2 flex gap-1.5 rounded-lg bg-info-50 px-3 py-2 text-[11.5px] leading-snug text-content-secondary">
              <Info className="mt-px size-3.5 shrink-0 text-info-600" aria-hidden />
              <span>
                Estimates are based on typical performance and may vary. They are not a
                forecast for this campaign.
              </span>
            </div>
          </SummaryCard>
        </div>
      </section>

      <aside className="space-y-4">
        <RailCard
          icon={ShieldCheck}
          title="Launch validation"
          description="We'll check everything is ready before launch."
        >
          {validating || !checks ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-5 w-full rounded" />
              ))}
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {checks.map((check) => (
                  <li key={check.key} className="flex items-start gap-2">
                    <CheckIcon state={check.state} />
                    <span className="min-w-0 flex-1 text-[12.5px] text-content">
                      {check.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-right text-[11.5px] leading-snug",
                        check.state === "BLOCK"
                          ? "text-danger-700"
                          : check.state === "WARN"
                            ? "text-warning-700"
                            : "text-content-muted",
                      )}
                    >
                      {check.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {checks.some((check) => check.fix) && blocked && (
                <div className="mt-3 space-y-1.5">
                  {checks
                    .filter((check) => check.state === "BLOCK" && check.fix)
                    .map((check) => (
                      <Link
                        key={check.key}
                        href={check.fix!.href}
                        className="block text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
                      >
                        {check.fix!.label} →
                      </Link>
                    ))}
                </div>
              )}

              <div
                className={cn(
                  "mt-3 flex items-start gap-2.5 rounded-lg px-3.5 py-3",
                  blocked
                    ? "bg-danger-50"
                    : warned.length > 0
                      ? "bg-warning-50"
                      : "bg-success-50",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    blocked
                      ? "bg-danger-500"
                      : warned.length > 0
                        ? "bg-warning-500"
                        : "bg-success-500",
                  )}
                >
                  {blocked ? (
                    <CircleX className="size-3.5" />
                  ) : (
                    <CircleCheck className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-content">
                    {blocked
                      ? `${checks.filter((c) => c.state === "BLOCK").length} check${
                          checks.filter((c) => c.state === "BLOCK").length === 1 ? "" : "s"
                        } need attention`
                      : warned.length > 0
                        ? "Ready to launch, with warnings"
                        : "All checks passed"}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-content-secondary">
                    {blocked
                      ? "Fix these before launching."
                      : warned.length > 0
                        ? warned.map((check) => check.detail).join(". ")
                        : "Your campaign is ready to launch."}
                  </p>
                </div>
              </div>
            </>
          )}
        </RailCard>

        <RailCard
          icon={Rocket}
          title="Ready to launch?"
          description={
            startMode === "MANUAL_REVIEW"
              ? "Your campaign will be created in READY state for final review. You can choose to start manually or activate immediately."
              : "Your campaign will be activated as soon as it passes final checks."
          }
          tone="info"
        >
          <div className="space-y-3">
            <RadioRow
              name="launch-mode"
              value="MANUAL_REVIEW"
              checked={startMode === "MANUAL_REVIEW"}
              onChange={() => onStartModeChange("MANUAL_REVIEW")}
              title="Create and start after manual review"
              description="Recommended for new campaigns."
            />
            <RadioRow
              name="launch-mode"
              value="IMMEDIATE"
              checked={startMode === "IMMEDIATE"}
              onChange={() => onStartModeChange("IMMEDIATE")}
              title="Create and start immediately"
              description="Campaign will be activated as soon as it passes final checks."
              disabled={sender?.state !== "HEALTHY"}
              disabledReason={
                sender?.state !== "HEALTHY"
                  ? "Available once the sending identity is healthy."
                  : undefined
              }
            />
          </div>
        </RailCard>

        {blocked && (
          <div className="flex gap-2 rounded-xl border border-danger-100 bg-danger-50 p-3.5 text-[12px] leading-snug text-danger-700">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              Launching is blocked until every check above passes. Nothing has been sent and
              nothing has been reserved.
            </span>
          </div>
        )}
      </aside>
    </div>
  );
}

function CheckIcon({ state }: { state: LaunchCheck["state"] }) {
  if (state === "BLOCK") {
    return <CircleX className="mt-px size-4 shrink-0 text-danger-500" aria-label="Failed" />;
  }
  if (state === "WARN") {
    return (
      <TriangleAlert className="mt-px size-4 shrink-0 text-warning-500" aria-label="Warning" />
    );
  }
  return <CircleCheck className="mt-px size-4 shrink-0 text-success-500" aria-label="Passed" />;
}

function SummaryCard({
  icon: Icon,
  title,
  tone = "accent",
  onEdit,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone?: "accent" | "info" | "purple" | "warning";
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  const tones = {
    accent: "bg-success-50 text-success-600",
    info: "bg-info-50 text-info-600",
    purple: "bg-purple-50 text-purple-600",
    warning: "bg-warning-50 text-warning-600",
  } as const;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("flex size-7 items-center justify-center rounded-md", tones[tone])}
          >
            <Icon className="size-4" />
          </span>
          <h3 className="text-[13.5px] font-semibold text-content">{title}</h3>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-content transition-colors hover:bg-surface-hover"
          >
            Edit
          </button>
        )}
      </header>
      <dl>{children}</dl>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <dt className="text-[11.5px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] font-medium leading-snug text-content">{value}</dd>
    </div>
  );
}
