import * as React from "react";
import Link from "next/link";
import { CircleAlert, Mail, Megaphone, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PlanLimitState } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  campaignStatusLabel,
  campaignStatusTone,
  formatRate,
  launchBlockers,
  ratio,
  type CampaignRow,
} from "@/lib/outreach/types";
import type { CampaignListData } from "@/lib/outreach/queries";

/**
 * The acquisition Campaigns view (V4 §16).
 *
 * Shows what each campaign is actually doing, and — for anything not running —
 * exactly what is stopping it. A campaign stuck in DRAFT because no sender is
 * attached is the most common state on this page, and it must say so rather
 * than looking like an empty list.
 */
export function CampaignsView({
  data,
  canManage,
}: {
  data: CampaignListData;
  canManage: boolean;
}) {
  const { campaigns, unassignedReady, hasSender } = data;

  return (
    <div className="space-y-5">
      {!hasSender && (
        <PlanLimitState
          title="No verified sending identity"
          description="Cold email needs a connected mailbox with a verified sender before any campaign can run. Nothing will be sent until one exists."
          action={
            <Link
              href="/app/settings?view=connections"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Connect a mailbox
            </Link>
          }
        />
      )}

      {unassignedReady > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-200/60 bg-accent-50/40 px-4 py-3">
          <p className="text-[12.5px] text-content-secondary">
            <strong className="font-semibold text-content">
              {unassignedReady.toLocaleString("en-GB")}
            </strong>{" "}
            approved prospect{unassignedReady === 1 ? "" : "s"} are not in a campaign yet.
          </p>
          <Link
            href="/app/find-leads?view=prospects&quick=ready"
            className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Review them
          </Link>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState
            icon={Megaphone}
            title="No acquisition campaigns yet"
            description="A campaign takes approved prospects and works a permitted email sequence, with daily caps and contact rules enforced on every send."
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} canManage={canManage} />
          ))}
        </ul>
      )}

      {/* Said on the surface where someone would otherwise expect to pick SMS. */}
      <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken/50 px-4 py-3 text-[12px] text-content-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-content-accent" aria-hidden />
        <span>
          Cold outreach is email only. SMS, WhatsApp and social are blocked for cold contact
          by the policy pack for each country, and cannot be enabled from here. Warm leads
          who reply move to Follow-Up, where the other channels are available.
        </span>
      </p>
    </div>
  );
}

function CampaignCard({
  campaign,
  canManage,
}: {
  campaign: CampaignRow;
  canManage: boolean;
}) {
  const blockers = launchBlockers(campaign);
  const running = campaign.status === "ACTIVE" || campaign.status === "OPTIMIZING";
  const { funnel } = campaign;

  return (
    <li className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-content">{campaign.name}</h3>
            <Badge tone={campaignStatusTone(campaign.status)} dot>
              {campaignStatusLabel(campaign.status)}
            </Badge>
            {campaign.autoOptimize && (
              <Tooltip content="Bounded optimisation is on: send times and message variants may change within your limits. It can never raise spend or weaken contact rules.">
                <Badge tone="purple" dense>
                  auto-optimise
                </Badge>
              </Tooltip>
            )}
            {campaign.reviewBeforeOutreach && (
              <Badge tone="neutral" dense>
                review first
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-content-muted">
            {campaign.description ||
              [campaign.icpProfileName, campaign.conversionGoalName]
                .filter(Boolean)
                .join(" → ") ||
              "No audience or goal set"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] text-content-muted">Minimum grade</p>
          <p className="text-[15px] font-semibold tabular-nums text-content">
            {campaign.minimumGrade}
          </p>
        </div>
      </div>

      <dl className="my-4 grid grid-cols-2 gap-3 border-y border-line-subtle py-4 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Audience" value={funnel.audience} />
        <Metric label="Contacted" value={funnel.contacted} />
        <Metric label="Replies" value={funnel.replies} rate={ratio(funnel.replies, funnel.contacted)} />
        <Metric
          label="Positive"
          value={funnel.positiveReplies}
          rate={ratio(funnel.positiveReplies, funnel.replies)}
        />
        <Metric label="To Leads" value={funnel.promoted} />
        <Metric
          label="Bounced"
          value={funnel.bounced}
          rate={ratio(funnel.bounced, funnel.contacted)}
          tone={funnel.bounced > 0 ? "danger" : undefined}
        />
      </dl>

      {blockers.length > 0 && !running ? (
        <div className="rounded-lg border border-warning-100 bg-warning-50 px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-warning-700">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            Not ready to launch
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {blockers.map((blocker) => (
              <li key={blocker} className="text-[12px] text-content-secondary">
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-content-subtle">
          <span className="flex items-center gap-1">
            <Mail className="size-3.5" aria-hidden />
            {campaign.sequenceStepCount} step
            {campaign.sequenceStepCount === 1 ? "" : "s"}
          </span>
          <span>
            Caps: {campaign.dailyContactCap}/day · {campaign.monthlyContactCap}/month
          </span>
          {funnel.optOuts > 0 && (
            <span className={cn(funnel.optOuts > 0 && "text-warning-700")}>
              {funnel.optOuts} opt-out{funnel.optOuts === 1 ? "" : "s"} (
              {formatRate(ratio(funnel.optOuts, funnel.contacted))})
            </span>
          )}
          {campaign.launchedAt && (
            <span>Launched {new Date(campaign.launchedAt).toLocaleDateString("en-GB")}</span>
          )}
        </div>
      )}

      {!canManage && (
        <p className="mt-3 text-[11.5px] text-content-subtle">
          You have view-only access to this workspace.
        </p>
      )}
    </li>
  );
}

function Metric({
  label,
  value,
  rate,
  tone,
}: {
  label: string;
  value: number;
  rate?: number | null;
  tone?: "danger";
}) {
  return (
    <div className="min-w-0">
      <dd
        className={cn(
          "text-[17px] font-semibold leading-none tabular-nums",
          tone === "danger" ? "text-danger-600" : "text-content",
        )}
      >
        {value.toLocaleString("en-GB")}
      </dd>
      <dt className="mt-1 truncate text-[11px] text-content-muted">
        {label}
        {rate !== undefined && (
          <span className="text-content-subtle"> · {formatRate(rate)}</span>
        )}
      </dt>
    </div>
  );
}
