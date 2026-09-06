"use client";

import * as React from "react";
import {
  Building2,
  CheckSquare,
  FileText,
  Handshake,
  Info,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Mail, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/form";
import {
  CHANNEL_LABELS,
  CHANNEL_PERMISSION_LABELS,
  MAX_EVIDENCE,
  RELATIONSHIP_CHOICES,
  WIZARD_CHANNELS,
  relationshipCardLabel,
  type ChannelPermission,
  type ContactabilityAssessment,
  type FieldErrors,
  type PermissionState,
  type RelationshipChoice,
  type WizardChannel,
} from "@/lib/leads/add-lead/types";
import { CharCount, DotList, RailCard, RailNote, StepHeading } from "./pieces";

const RELATIONSHIP_ICONS: Record<
  RelationshipChoice,
  React.ComponentType<{ className?: string }>
> = {
  THEY_CONTACTED_US: MessageCircle,
  EXISTING_CUSTOMER: Users,
  REFERRAL: Handshake,
  REQUESTED_INFORMATION: FileText,
  EXPLICIT_MARKETING_CONSENT: CheckSquare,
  EXISTING_BUSINESS_RELATIONSHIP: Building2,
  FOUND_BY_US: Search,
  OTHER: MoreHorizontal,
};

const CHANNEL_ICONS: Record<
  WizardChannel,
  React.ComponentType<{ className?: string }>
> = {
  EMAIL: Mail,
  SMS: MessageSquare,
  WHATSAPP: MessageCircle,
  PHONE: Phone,
};

const PERMISSION_STYLES: Record<ChannelPermission, string> = {
  PERMITTED: "bg-success-50 text-success-700 border-success-100",
  REVIEW: "bg-warning-50 text-warning-700 border-warning-100",
  BLOCKED: "bg-danger-50 text-danger-700 border-danger-100",
  UNAVAILABLE: "bg-surface-sunken text-content-muted border-line",
};

const GUIDANCE = [
  {
    label: "They contacted us",
    detail: "Generally a warm lead.",
    tone: "success" as const,
  },
  {
    label: "Existing customer",
    detail: "Usually a warm lead (policy still applies).",
    tone: "success" as const,
  },
  {
    label: "Referral / introduction",
    detail: "May be a warm lead — review the context and evidence.",
    tone: "warning" as const,
  },
  {
    label: "Explicit marketing consent",
    detail: "Can be a warm lead (evidence required).",
    tone: "success" as const,
  },
  {
    label: "I found this person/company",
    detail: "Treat as a Prospect, not a warm lead.",
    tone: "danger" as const,
  },
];

function RelationshipCard({
  choice,
  selected,
  onSelect,
}: {
  choice: RelationshipChoice;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = RELATIONSHIP_ICONS[choice];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "relative flex h-[62px] items-center gap-2.5 rounded-xl border px-3 text-left",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        selected
          ? "border-info-500 bg-info-50/60 ring-1 ring-info-500"
          : "border-line bg-surface hover:bg-surface-hover",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0",
          selected ? "text-info-700" : "text-content-muted",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "min-w-0 text-[12.5px] leading-[1.3]",
          selected ? "font-semibold text-content" : "text-content-secondary",
        )}
      >
        {relationshipCardLabel(choice)}
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute right-2 top-2 size-2.5 rounded-full bg-info-500"
        />
      )}
    </button>
  );
}

function ChannelTile({
  channel,
  permission,
  reason,
}: {
  channel: WizardChannel;
  permission: ChannelPermission;
  reason: string;
}) {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-content-muted" aria-hidden />
        <span className="text-[12.5px] font-medium text-content">
          {CHANNEL_LABELS[channel]}
        </span>
      </div>
      <span
        className={cn(
          "mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] font-semibold",
          PERMISSION_STYLES[permission],
        )}
      >
        {CHANNEL_PERMISSION_LABELS[permission]}
      </span>
      <p className="mt-1.5 text-[11px] leading-[1.4] text-content-muted">{reason}</p>
    </div>
  );
}

export function PermissionStep({
  value,
  errors,
  assessment,
  assessing,
  assessError,
  prospectBusy,
  onChange,
  onProspectHandoff,
}: {
  value: PermissionState;
  errors: FieldErrors;
  assessment: ContactabilityAssessment | null;
  assessing: boolean;
  assessError: string | null;
  prospectBusy: boolean;
  onChange: (patch: Partial<PermissionState>) => void;
  onProspectHandoff: () => void;
}) {
  const id = React.useId();
  const prospect = value.relationship === "FOUND_BY_US";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_268px]">
      <div className="min-w-0 space-y-4">
        <StepHeading
          step={3}
          title="Permission & contactability"
          description="This step protects the warm-lead boundary and evaluates which channels can be used to contact them."
        />

        <section>
          <h3 className="text-[13px] font-medium text-content">
            Relationship type
            <span className="ml-0.5 text-danger-600" aria-hidden>
              *
            </span>
          </h3>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Select how you know this person or company.
          </p>
          <div
            role="radiogroup"
            aria-label="Relationship type"
            aria-invalid={Boolean(errors.relationship)}
            className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            {RELATIONSHIP_CHOICES.map((choice) => (
              <RelationshipCard
                key={choice}
                choice={choice}
                selected={value.relationship === choice}
                onSelect={() => onChange({ relationship: choice })}
              />
            ))}
          </div>
          {errors.relationship && (
            <p className="mt-2 text-[12px] text-danger-600">{errors.relationship}</p>
          )}
        </section>

        <FormField
          label="Consent evidence"
          hint="Add evidence, timestamp, source and scope (e.g. who referred them, what was said, and what contact methods are allowed)."
          htmlFor={`${id}-evidence`}
          error={errors.evidence}
        >
          <Textarea
            id={`${id}-evidence`}
            rows={3}
            value={value.evidence}
            aria-invalid={Boolean(errors.evidence)}
            onChange={(event) => onChange({ evidence: event.target.value })}
          />
          <CharCount value={value.evidence} max={MAX_EVIDENCE} />
        </FormField>

        <section>
          <h3 className="text-[13px] font-medium text-content">Channel permission</h3>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Based on the relationship type and our policy, this is what may be
            used. These states are decided by ClientTurn and cannot be
            overridden here.
          </p>

          <div
            aria-live="polite"
            className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            {assessing || !assessment ? (
              WIZARD_CHANNELS.map((channel) => (
                <div
                  key={channel}
                  className="flex h-[92px] items-center justify-center rounded-xl border border-line bg-surface-sunken/40"
                >
                  {assessing ? (
                    <Loader2
                      className="size-4 animate-spin text-content-subtle"
                      aria-hidden
                    />
                  ) : (
                    <span className="px-2 text-center text-[11px] text-content-muted">
                      Choose a relationship type
                    </span>
                  )}
                </div>
              ))
            ) : (
              WIZARD_CHANNELS.map((channel) => (
                <ChannelTile
                  key={channel}
                  channel={channel}
                  permission={assessment.channels[channel].permission}
                  reason={assessment.channels[channel].reason}
                />
              ))
            )}
          </div>
        </section>

        {prospect && (
          <div className="flex flex-col gap-3 rounded-xl border border-info-100 bg-info-50/70 p-3.5 sm:flex-row sm:items-center">
            <span
              aria-hidden
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-info-500 text-white"
            >
              <Info className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-content">
                Prospect redirect
              </p>
              <p className="mt-0.5 text-[12px] leading-[1.45] text-content-secondary">
                People you find yourself online should be treated as a Prospect,
                not a warm lead.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={prospectBusy}
              onClick={onProspectHandoff}
              className="shrink-0"
            >
              Add to Find Leads instead
            </Button>
          </div>
        )}

        <section>
          <h3 className="text-[13px] font-medium text-content">Suppression summary</h3>
          <p className="mt-0.5 text-[12px] text-content-muted">
            We&apos;ll automatically check for any suppression rules before you can
            continue.
          </p>

          <div className="mt-2.5" aria-live="polite">
            {assessError ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-warning-100 bg-warning-50/60 p-3">
                <ShieldAlert
                  className="mt-0.5 size-4 shrink-0 text-warning-700"
                  aria-hidden
                />
                <div>
                  <p className="text-[12.5px] font-semibold text-content">
                    Suppression could not be checked
                  </p>
                  <p className="mt-0.5 text-[12px] text-content-muted">
                    {assessError}
                  </p>
                </div>
              </div>
            ) : assessment && assessment.suppression.length === 0 ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3">
                <ShieldCheck
                  className="mt-0.5 size-4 shrink-0 text-success-600"
                  aria-hidden
                />
                <div>
                  <p className="text-[12.5px] font-semibold text-content">
                    No suppression issues found
                  </p>
                  <p className="mt-0.5 text-[12px] text-content-muted">
                    Not opted out, no invalid numbers, no active conversation, no
                    recent cooldown, not booked, not won, not deleted.
                  </p>
                </div>
              </div>
            ) : assessment ? (
              <ul className="space-y-2">
                {assessment.suppression.map((issue) => (
                  <li
                    key={issue.code}
                    className={cn(
                      "flex items-start gap-2.5 rounded-xl border p-3",
                      issue.tone === "danger"
                        ? "border-danger-100 bg-danger-50/60"
                        : "border-warning-100 bg-warning-50/60",
                    )}
                  >
                    <ShieldAlert
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        issue.tone === "danger"
                          ? "text-danger-600"
                          : "text-warning-700",
                      )}
                      aria-hidden
                    />
                    <div>
                      <p className="text-[12.5px] font-semibold text-content">
                        {issue.label}
                      </p>
                      <p className="mt-0.5 text-[12px] text-content-muted">
                        {issue.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-line bg-surface-sunken/40 p-3 text-[12px] text-content-muted">
                Choose a relationship type to run the suppression check.
              </div>
            )}
            {errors.suppression && (
              <p className="mt-2 text-[12px] text-danger-600">{errors.suppression}</p>
            )}
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-3">
        <RailCard icon={FileText} title="Relationship guidance">
          <p className="mb-3 text-[12px] leading-[1.5] text-content-muted">
            The warm-lead boundary helps ensure we only contact people who have a
            legitimate reason to hear from you. Here&apos;s how each relationship
            type is typically treated:
          </p>
          <DotList items={GUIDANCE} />
        </RailCard>

        <RailNote icon={ShieldCheck} tone="success" title="Compliance first">
          Always follow data protection laws and our contact policy. When in
          doubt, choose the more cautious option.
        </RailNote>
      </aside>
    </div>
  );
}
