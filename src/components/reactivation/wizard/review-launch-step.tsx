"use client";

import * as React from "react";
import {
  AlertTriangle,
  BarChart3,
  Ban,
  Check,
  ClipboardList,
  Eye,
  FileText,
  Info,
  MessageSquare,
  Rocket,
} from "lucide-react";
import { Skeleton } from "@/components/ui/feedback";
import {
  fullSuppressionBreakdown,
  previewTemplate,
  segmentInfo,
  type AudiencePreview,
} from "@/lib/campaigns/types";
import { estimateMessages } from "@/lib/campaigns/reactivation-audience";
import { sanitizeEmailHtml } from "@/lib/email/rich-text";
import {
  CHANNEL_LABELS,
  launchChecklist,
  resolvedAudienceLabel,
  scheduledInstant,
  splitTags,
  type WizardState,
} from "./state";
import type { FilterOptions } from "./audience-step";
import type { QuietHours } from "./message-timing-step";
import {
  Banner,
  BigFigure,
  CheckItem,
  IconTile,
  RailCard,
  StatTile,
  StepSection,
  SummaryRow,
  SummaryTable,
  formatCount,
} from "./pieces";

function formatQuietWindow(quiet: QuietHours) {
  if (!quiet.enabled) return "Off";
  const to12 = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    const suffix = hours >= 12 ? "PM" : "AM";
    const display = hours % 12 === 0 ? 12 : hours % 12;
    return `${display}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };
  const zone = quiet.timezone.split("/").pop()?.replace(/_/g, " ") ?? quiet.timezone;
  return `${to12(quiet.end)} – ${to12(quiet.start)} (${zone})`;
}

export function ReviewLaunchStep({
  state,
  preview,
  loading,
  businessName,
  quietHours,
  options,
  providerConnected,
  messageValid,
  timingValid,
  revalidationNotice,
}: {
  state: WizardState;
  preview: AudiencePreview | null;
  loading: boolean;
  businessName: string;
  quietHours: QuietHours;
  options: FilterOptions;
  providerConnected: boolean;
  messageValid: boolean;
  timingValid: boolean;
  /** Set when the recalculated audience differs from the Step 1 estimate. */
  revalidationNotice: string | null;
}) {
  const eligible = preview?.eligible ?? 0;
  const scheduled = scheduledInstant(state);

  // An email is one message however long it is; only a text is billed by
  // segment, so counting segments on an email would inflate the estimate.
  const segmentsFor = (body: string) =>
    state.channel === "email" ? 1 : segmentInfo(body).segments;

  const totals = estimateMessages({
    eligible,
    initialSegments: segmentsFor(state.initialMessage),
    followupEnabled: state.followUpEnabled,
    followupSegments: segmentsFor(state.followUpMessage),
  });

  const checklist = launchChecklist(state, {
    eligible,
    providerConnected,
    messageValid,
    timingValid,
  });

  const suppression = preview
    ? fullSuppressionBreakdown(preview.suppressed, preview.cooldownDays)
    : [];

  const serviceName =
    options.services.find(
      (service) => service.id === state.audienceFilters.serviceId,
    )?.name ?? "All services";

  const ready = eligible > 0 && messageValid && timingValid && providerConnected;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_392px]">
      {/* ------------------------------------------------------- main --- */}
      <div className="bg-surface border-line divide-line-subtle divide-y rounded-xl border shadow-xs">
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            <IconTile icon={Rocket} tone="success" />
            <div>
              <h2 className="text-content text-[17px] font-semibold">
                Step 3 — Review &amp; Launch
              </h2>
              <p className="text-content-muted mt-0.5 text-[13px]">
                Review your audience, message, and timing before you launch.
              </p>
            </div>
          </div>
        </div>

        {/* campaign summary */}
        <div className="px-5 py-4">
          <StepSection
            icon={FileText}
            title="Campaign summary"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <SummaryTable>
                <SummaryRow label="Campaign name" value={state.campaignName} />
                <SummaryRow
                  label="Audience name"
                  value={resolvedAudienceLabel(state)}
                />
                <SummaryRow
                  label="Audience source"
                  value={
                    state.audienceSource === "csv"
                      ? (state.csvUpload?.label ?? "Imported CSV")
                      : "Existing ClientTurn leads"
                  }
                />
                <SummaryRow label="Primary service" value={serviceName} />
                <SummaryRow label="Channel" value={CHANNEL_LABELS[state.channel]} />
                <SummaryRow
                  label="Tags"
                  value={splitTags(state.tags).join(", ") || "None"}
                />
              </SummaryTable>
              <SummaryTable>
                <SummaryRow
                  label="Send mode"
                  value={state.sendMode === "now" ? "Send now" : "Scheduled"}
                />
                <SummaryRow
                  label="Launch date"
                  value={
                    state.sendMode === "now"
                      ? "As soon as the send window opens"
                      : scheduled
                        ? scheduled.toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Not set"
                  }
                />
                <SummaryRow
                  label="Quiet hours"
                  value={formatQuietWindow(quietHours)}
                />
              </SummaryTable>
            </div>
          </StepSection>
        </div>

        {/* audience summary */}
        <div className="px-5 py-4">
          <StepSection icon={BarChart3} title="Audience summary">
            {loading || !preview ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  value={formatCount(eligible)}
                  label="Eligible contacts"
                  caption="Will receive your campaign"
                  tone="success"
                />
                <StatTile
                  value={formatCount(preview.suppressedTotal)}
                  label="Suppressed contacts"
                  caption="Won't receive messages"
                  tone="danger"
                />
                <StatTile
                  value={formatCount(totals.total)}
                  label="Estimated messages"
                  caption={
                    state.followUpEnabled
                      ? "Initial + follow-up sends"
                      : "Initial sends"
                  }
                  tone="info"
                />
              </div>
            )}
          </StepSection>
        </div>

        {/* suppression reasons */}
        <div className="px-5 py-4">
          <StepSection
            icon={Ban}
            tone="danger"
            title="Suppression reasons"
            description="Each contact is counted once, under the first rule it matched."
          >
            {loading || !preview ? (
              <Skeleton className="h-40 w-full rounded-lg" />
            ) : (
              <SummaryTable>
                {suppression.map((group) => (
                  <SummaryRow
                    key={group.reason}
                    label={group.label}
                    value={formatCount(group.count)}
                  />
                ))}
              </SummaryTable>
            )}
          </StepSection>
        </div>

        {/* final message preview */}
        <div className="px-5 py-4">
          <StepSection icon={Eye} title="Final message preview">
            <div className="border-line rounded-lg border">
              <div className="border-line-subtle bg-surface-sunken/50 border-b px-3.5 py-2">
                <p className="text-content-muted text-[12px]">
                  {CHANNEL_LABELS[state.channel]} to{" "}
                  <span className="text-content">
                    {state.channel === "email"
                      ? "jamie.bell@example.co.uk"
                      : "+44 7700 900000"}
                  </span>
                </p>
                {state.channel === "email" && (
                  <p className="text-content-muted mt-0.5 text-[12px]">
                    Subject:{" "}
                    <span className="text-content font-medium">
                      {previewTemplate(state.subject, businessName)}
                    </span>
                  </p>
                )}
              </div>
              {state.channel === "email" ? (
                // Sanitised by `sanitizeEmailHtml`, whose allowlist admits only
                // the formatting tags an email body may carry.
                <div
                  className="lr-rich-text text-content px-3.5 py-3 text-[13px] leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeEmailHtml(
                      previewTemplate(state.initialMessage, businessName),
                    ),
                  }}
                />
              ) : (
                <p className="text-content whitespace-pre-wrap px-3.5 py-3 text-[13px] leading-relaxed">
                  {previewTemplate(state.initialMessage, businessName)}
                </p>
              )}
            </div>

            {state.followUpEnabled && (
              <div className="border-line bg-surface-sunken/40 mt-2 rounded-lg border px-3.5 py-2.5">
                <p className="text-content-secondary flex items-center gap-2 text-[13px]">
                  <MessageSquare className="text-content-muted size-4" aria-hidden />
                  <span>
                    <strong className="font-medium">Follow-up:</strong>{" "}
                    {CHANNEL_LABELS[state.followUpChannel]},{" "}
                    {state.followUpDelayDays} day
                    {state.followUpDelayDays === 1 ? "" : "s"} after the initial
                    message.
                  </span>
                </p>
                <p className="text-content-muted mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed">
                  {previewTemplate(state.followUpMessage, businessName)}
                </p>
              </div>
            )}
          </StepSection>
        </div>

        {/* launch banner */}
        <div className="px-5 py-4">
          {revalidationNotice && (
            <div className="mb-3">
              <Banner tone="warning" icon={AlertTriangle}>
                {revalidationNotice}
              </Banner>
            </div>
          )}

          {loading ? (
            <Skeleton className="h-12 w-full rounded-lg" />
          ) : ready ? (
            <Banner tone="success" icon={Check}>
              <strong className="text-content font-medium">
                Ready to launch
              </strong>{" "}
              — {formatCount(eligible)} eligible contact
              {eligible === 1 ? "" : "s"} will receive this campaign.
            </Banner>
          ) : (
            <Banner tone="danger" icon={AlertTriangle}>
              <strong className="text-content font-medium">
                Not ready to launch
              </strong>{" "}
              —{" "}
              {eligible === 0
                ? "no eligible contacts match this audience."
                : !providerConnected
                  ? "no messaging provider is connected."
                  : !messageValid
                    ? "the message needs attention."
                    : "the schedule needs attention."}{" "}
              Go back and fix this before sending.
            </Banner>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- rail --- */}
      <div className="space-y-4">
        <RailCard
          icon={ClipboardList}
          title="Launch checklist"
          description="Make sure everything looks good before sending."
        >
          <ul className="space-y-2.5">
            {checklist.map((item) => (
              <CheckItem
                key={item.label}
                label={item.label}
                done={item.done}
                size="md"
              />
            ))}
          </ul>
        </RailCard>

        <RailCard
          icon={BarChart3}
          title="Launch estimate"
          description="Based on your settings and audience."
        >
          {loading || !preview ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (
            <>
              <BigFigure
                value={formatCount(totals.total)}
                caption="estimated total messages"
                tone={totals.total > 0 ? "success" : "danger"}
              />
              <div className="mt-3">
                <SummaryTable>
                  <SummaryRow
                    label="Initial sends"
                    value={formatCount(totals.initial)}
                  />
                  <SummaryRow
                    label="Follow-up sends"
                    value={
                      state.followUpEnabled
                        ? `up to ${formatCount(totals.followup)}`
                        : "None"
                    }
                  />
                  <SummaryRow
                    label="Audience eligible"
                    value={formatCount(eligible)}
                  />
                  <SummaryRow
                    label="Suppressed"
                    value={formatCount(preview.suppressedTotal)}
                  />
                </SummaryTable>
              </div>
            </>
          )}
        </RailCard>

        <RailCard
          icon={Info}
          title="Important notes"
          description="Keep these in mind before you launch."
        >
          <ul className="text-content-secondary list-disc space-y-1.5 pl-4 text-[12px]">
            <li>
              The campaign will not launch if there are no eligible contacts.
            </li>
            <li>Sends respect your quiet hours.</li>
            <li>
              The follow-up only sends to contacts who have not replied, booked
              or opted out.
            </li>
            <li>You can pause or cancel the campaign later.</li>
            <li>
              Message counts are estimates — the audience is recalculated on the
              server the moment you launch.
            </li>
          </ul>
        </RailCard>
      </div>
    </div>
  );
}
