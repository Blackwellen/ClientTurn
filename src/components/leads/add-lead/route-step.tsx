"use client";

import * as React from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  FileText,
  Phone,
  Settings2,
  ShieldCheck,
  Tag,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Input, Select, Switch } from "@/components/ui/form";
import {
  CHANNEL_LABELS,
  INITIAL_STATUSES,
  INITIAL_STATUS_LABELS,
  conversionDestination,
  conversionGoalLabel,
  permittedChannels,
  relationshipCardLabel,
  routingReadiness,
  sourceValueLabel,
  type AddLeadState,
  type ContactabilityAssessment,
  type DuplicateMatch,
  type FieldErrors,
  type InitialStatus,
  type RoutingState,
} from "@/lib/leads/add-lead/types";
import type { WizardService } from "@/lib/leads/add-lead/queries";
import type { WorkspaceMember } from "@/lib/leads/types";
import { RailCard, RailNote, SummaryRow, StepHeading } from "./pieces";

const CREATE_STEPS = [
  "Rerun duplicate checks to make sure this isn't already in your workspace.",
  "Evaluate suppression rules and contactability.",
  "Create the lead with manual-source provenance.",
  "Create initial activity and assignment event.",
  "Invoke the same lead.created orchestration inbound leads use.",
  "Open the Lead Drawer on success.",
];

export function RouteStartStep({
  state,
  errors,
  assessment,
  duplicates,
  duplicateChecked,
  members,
  services,
  serviceFlows,
  followUp,
  canAssignOthers,
  onChange,
  onEditStep,
}: {
  state: AddLeadState;
  errors: FieldErrors;
  assessment: ContactabilityAssessment | null;
  duplicates: DuplicateMatch[];
  duplicateChecked: boolean;
  members: WorkspaceMember[];
  services: WizardService[];
  serviceFlows: string[];
  followUp: { eligible: boolean; reason: string | null };
  canAssignOthers: boolean;
  onChange: (patch: Partial<RoutingState>) => void;
  onEditStep: (index: number) => void;
}) {
  const id = React.useId();
  const routing = state.routing;
  const service = services.find((item) => item.id === state.enquiry.serviceId);
  const goal = state.enquiry.conversionGoal;
  const destination = goal ? conversionDestination(goal) : null;
  const hasServiceFlow = service ? serviceFlows.includes(service.id) : false;
  const permitted = permittedChannels(assessment);

  // A toggle that cannot be honoured reads as off and is disabled with the
  // reason, rather than being left on to promise what the submit will refuse.
  const followUpOn = routing.startFollowUp && followUp.eligible;

  const readiness = routingReadiness({
    duplicates,
    duplicateChecked,
    assessment,
    followUp: {
      requested: followUpOn,
      eligible: followUp.eligible,
      reason: followUp.reason,
    },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_268px]">
      <div className="min-w-0 space-y-4">
        <StepHeading
          step={4}
          title="Route & Start"
          description="Tell us how to route this lead and ClientTurn will put them into your conversion engine."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-content">Assignee</p>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Assign someone to own this lead (optional).
            </p>
            <div className="mt-3">
              <Select
                aria-label="Assignee"
                value={routing.assigneeId}
                disabled={!canAssignOthers}
                onChange={(event) => onChange({ assigneeId: event.target.value })}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-content">Initial status</p>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Set the lead&apos;s initial status.
            </p>
            <div className="relative mt-3">
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute left-3 top-1/2 size-2.5 -translate-y-1/2 rounded-full",
                  routing.initialStatus === "NEW" ? "bg-info-500" : "bg-success-500",
                )}
              />
              <Select
                className="pl-7"
                aria-label="Initial status"
                value={routing.initialStatus}
                aria-invalid={Boolean(errors.initialStatus)}
                onChange={(event) =>
                  onChange({ initialStatus: event.target.value as InitialStatus })
                }
              >
                {INITIAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {INITIAL_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </div>
            <p className="mt-2 text-[11.5px] text-content-muted">
              Status can be updated later based on activity and progress.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-content">
                Needs attention{" "}
                <span className="font-normal text-content-muted">(optional)</span>
              </p>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Flag this lead for immediate attention with a manual reason.
              </p>
            </div>
            <Switch
              checked={routing.needsAttention}
              label="Flag this lead as needing attention"
              onCheckedChange={(checked) =>
                onChange({
                  needsAttention: checked,
                  attentionReason: checked ? routing.attentionReason : "",
                })
              }
            />
          </div>
          <div className="mt-3">
            <Input
              id={`${id}-attention`}
              value={routing.attentionReason}
              disabled={!routing.needsAttention}
              maxLength={200}
              aria-label="Reason for attention"
              aria-invalid={Boolean(errors.attentionReason)}
              placeholder="Enter reason for attention..."
              onChange={(event) => onChange({ attentionReason: event.target.value })}
            />
            {errors.attentionReason ? (
              <p className="mt-1.5 text-[12px] text-danger-600">
                {errors.attentionReason}
              </p>
            ) : (
              <p className="mt-1.5 text-[11.5px] text-content-muted">
                Automatic reasons (e.g. high value, urgent) cannot be suppressed
                here.
              </p>
            )}
          </div>
        </div>

        <div
          className={cn(
            "rounded-xl border bg-surface p-4 shadow-xs",
            followUp.eligible ? "border-line" : "border-warning-100 bg-warning-50/40",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-content">
                Start follow-up
              </p>
              <p className="mt-0.5 text-[12px] leading-[1.45] text-content-muted">
                Create initial follow-up tasks and add to your follow-up
                sequences. This will only be enabled if at least one permitted
                channel and an automation are available in your workspace
                settings.
              </p>
              {!followUp.eligible && followUp.reason && (
                <p className="mt-1.5 text-[12px] font-medium text-warning-700">
                  {followUp.reason}
                </p>
              )}
            </div>
            <Switch
              checked={followUpOn}
              tone="success"
              disabled={!followUp.eligible}
              label="Start follow-up for this lead"
              onCheckedChange={(checked) => onChange({ startFollowUp: checked })}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <legend className="sr-only">Qualification flow</legend>
            <p className="text-[13px] font-semibold text-content">
              Qualification flow
            </p>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Choose how this lead should be qualified.
            </p>
            <div className="mt-3 space-y-2.5">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name={`${id}-flow`}
                  className="mt-0.5 size-4 accent-[var(--lr-accent-600)]"
                  checked={routing.qualificationFlow === "default"}
                  onChange={() => onChange({ qualificationFlow: "default" })}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-content">
                    Default qualification flow
                  </span>
                  <span className="block text-[11.5px] text-content-muted">
                    Use your standard lead qualification flow.
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex items-start gap-2.5",
                  hasServiceFlow ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-flow`}
                  className="mt-0.5 size-4 accent-[var(--lr-accent-600)]"
                  disabled={!hasServiceFlow}
                  checked={routing.qualificationFlow === "service"}
                  onChange={() => onChange({ qualificationFlow: "service" })}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-content">
                    Service-specific flow
                  </span>
                  <span className="block text-[11.5px] text-content-muted">
                    {hasServiceFlow
                      ? `Use the flow for the selected service (${service?.name}).`
                      : "No service-specific questions are configured for this service."}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-content">
              Conversion destination
            </p>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Based on your conversion goal, this lead will flow to:
            </p>
            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50/60 p-3">
              <CalendarDays
                className="mt-0.5 size-4 shrink-0 text-info-700"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-content">
                  {destination?.title ?? "Choose a conversion goal in Step 2"}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-[1.45] text-content-muted">
                  {destination?.detail ??
                    "The destination is derived from the goal you set."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <section className="rounded-xl border border-line bg-surface-sunken/40 p-4">
          <div className="flex items-center gap-2.5">
            <Settings2 className="size-4 text-content-muted" aria-hidden />
            <h3 className="text-[13px] font-semibold text-content">
              What happens when you create this lead?
            </h3>
          </div>
          <ol className="mt-2.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {CREATE_STEPS.map((step, index) => (
              <li key={step} className="flex gap-2 text-[11.5px] text-content-muted">
                <span className="lr-tabular shrink-0 font-semibold text-content-secondary">
                  {index + 1}.
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="min-w-0 space-y-3">
        <RailCard icon={FileText} title="Ready to create">
          <p className="text-[12px] leading-[1.5] text-content-muted">
            Here&apos;s a summary of how this lead will be created and routed in
            ClientTurn.
          </p>

          <div className="mt-3 border-t border-line-subtle pt-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[12.5px] font-semibold text-content">
                Lead summary
              </h4>
              <button
                type="button"
                onClick={() => onEditStep(0)}
                className="rounded-xs text-[12px] font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
              >
                Edit
              </button>
            </div>
            <div className="mt-1.5">
              <SummaryRow
                icon={User}
                label="Name"
                value={
                  [state.contact.firstName, state.contact.lastName]
                    .filter(Boolean)
                    .join(" ") || "—"
                }
              />
              <SummaryRow
                icon={Building2}
                label="Company"
                value={state.contact.company || "—"}
              />
              <SummaryRow
                icon={Tag}
                label="Service"
                value={service?.name ?? "—"}
              />
              <SummaryRow
                icon={Phone}
                label="Source"
                value={sourceValueLabel(state.enquiry.source)}
              />
              <SummaryRow
                icon={Users}
                label="Relationship"
                value={
                  state.permission.relationship
                    ? relationshipCardLabel(state.permission.relationship)
                    : "—"
                }
              />
              <SummaryRow
                icon={CircleDot}
                label="Channels allowed"
                value={
                  permitted.length > 0
                    ? permitted.map((channel) => CHANNEL_LABELS[channel]).join(", ")
                    : "None"
                }
              />
              <SummaryRow
                icon={CalendarDays}
                label="Conversion goal"
                value={goal ? conversionGoalLabel(goal) : "—"}
              />
            </div>
          </div>

          <div className="mt-3 border-t border-line-subtle pt-3">
            <h4 className="text-[12.5px] font-semibold text-content">
              Routing readiness
            </h4>
            <ul className="mt-2 space-y-2.5">
              {readiness.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5">
                  {item.tone === "success" ? (
                    <CheckCircle2
                      className="mt-px size-4 shrink-0 text-success-600"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className={cn(
                        "mt-px size-4 shrink-0",
                        item.tone === "danger"
                          ? "text-danger-600"
                          : "text-warning-600",
                      )}
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-content">
                      {item.label}
                    </p>
                    <p className="text-[11.5px] leading-[1.4] text-content-muted">
                      {item.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </RailCard>

        <RailNote icon={ShieldCheck} tone="success" title="Provenance is preserved">
          This lead is stored as manually created, with the source, relationship
          and contactability decision recorded against it.
        </RailNote>
      </aside>
    </div>
  );
}
