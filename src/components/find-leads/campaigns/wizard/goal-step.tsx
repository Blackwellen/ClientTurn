"use client";

import * as React from "react";
import { BarChart3, Flag, Lightbulb, Target } from "lucide-react";
import Link from "next/link";
import { Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  CONVERSION_GOALS,
  SUCCESS_EVENTS,
  conversionGoalMeta,
  defaultSuccessEvent,
  successEventsFor,
  type CampaignDraft,
  type ConversionGoal,
  type FieldErrors,
  type SuccessEvent,
} from "@/lib/outreach/campaign-draft";
import type { CampaignWizardOptions } from "@/lib/outreach/campaigns/audience";
import { Field, RailCard, SectionCard, TickList } from "./pieces";

const TIPS = [
  "Choose a clear, specific goal",
  "Align your goal with a measurable outcome",
  "Use your key service or product",
  "You can refine your audience and messaging in the next steps",
] as const;

/**
 * Step 1 — Goal.
 *
 * The success event is derived from the conversion goal but stays editable,
 * because a workspace may legitimately measure a compatible outcome instead.
 * Changing the goal resets it to that goal's default rather than leaving an
 * incompatible pair behind for the launch gate to reject at step 6.
 */
export function GoalStep({
  draft,
  errors,
  options,
  onChange,
}: {
  draft: CampaignDraft;
  errors: FieldErrors;
  options: CampaignWizardOptions;
  onChange: (update: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const { goal } = draft;
  const selected = goal.conversionGoal ? conversionGoalMeta(goal.conversionGoal) : null;
  const compatible = goal.conversionGoal ? successEventsFor(goal.conversionGoal) : [];

  const activeServices = options.services.filter((service) => service.active);
  const selectedService = options.services.find(
    (service) => service.id === goal.primaryServiceId,
  );
  const serviceDeactivated = Boolean(selectedService && !selectedService.active);

  const setGoal = (next: ConversionGoal) =>
    onChange((current) => ({
      ...current,
      goal: {
        ...current.goal,
        conversionGoal: next,
        // A goal change carries its default measurement with it, so the pair is
        // always valid unless the customer deliberately changes one of them.
        successEvent: defaultSuccessEvent(next),
      },
    }));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
      <SectionCard
        icon={Flag}
        title="Campaign goal"
        description="Tell us what you want to achieve with this campaign."
        bodyClassName="space-y-5"
      >
        <Field
          label="Campaign name"
          htmlFor="campaign-name"
          required
          hint="Give your campaign a clear name to identify it later."
          error={errors.campaignName}
        >
          <Input
            id="campaign-name"
            value={goal.campaignName}
            maxLength={120}
            aria-invalid={Boolean(errors.campaignName)}
            placeholder="Property managers – Bournemouth outreach"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                goal: { ...current.goal, campaignName: event.target.value },
              }))
            }
          />
        </Field>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <Field
            label="Conversion goal"
            htmlFor="conversion-goal"
            required
            hint="What outcome do you want from this campaign?"
            error={errors.conversionGoal}
          >
            <Select
              id="conversion-goal"
              value={goal.conversionGoal ?? ""}
              aria-invalid={Boolean(errors.conversionGoal)}
              onChange={(event) => setGoal(event.target.value as ConversionGoal)}
            >
              <option value="" disabled>
                Choose a goal
              </option>
              {CONVERSION_GOALS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {/* The explanation sits beside the control rather than under it, so
              the meaning of the choice is visible while it is being made. */}
          {selected ? (
            <div className="rounded-lg border border-success-100 bg-success-50/60 px-4 py-3.5 lg:mt-[26px]">
              <div className="flex items-start gap-2.5">
                <Target className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-content">{selected.label}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-content-secondary">
                    {selected.description}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-surface-sunken/50 px-4 py-3.5 text-[12.5px] text-content-muted lg:mt-[26px]">
              Pick a goal and we will explain what it does here.
            </div>
          )}
        </div>

        <Field
          label="Primary service / product"
          htmlFor="primary-service"
          required
          hint="Select the main service or product this campaign will promote."
          error={
            errors.primaryServiceId ??
            (serviceDeactivated
              ? "This service is no longer active. Choose another one before launching."
              : undefined)
          }
        >
          {activeServices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-sunken/50 px-3.5 py-3 text-[12.5px] text-content-muted">
              No active services yet.{" "}
              <Link
                href="/app/settings?view=services"
                className="font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Add one in Settings
              </Link>
            </div>
          ) : (
            <Select
              id="primary-service"
              value={goal.primaryServiceId ?? ""}
              aria-invalid={Boolean(errors.primaryServiceId) || serviceDeactivated}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  goal: { ...current.goal, primaryServiceId: event.target.value || null },
                }))
              }
            >
              <option value="" disabled>
                Choose a service
              </option>
              {activeServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
              {serviceDeactivated && selectedService && (
                <option value={selectedService.id}>{selectedService.name} (inactive)</option>
              )}
            </Select>
          )}
        </Field>

        <Field
          label="Success event"
          htmlFor="success-event"
          required
          hint="This event will be used to track and optimise campaign performance."
          error={errors.successEvent}
        >
          <Select
            id="success-event"
            value={goal.successEvent ?? ""}
            disabled={!goal.conversionGoal}
            aria-invalid={Boolean(errors.successEvent)}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                goal: { ...current.goal, successEvent: event.target.value as SuccessEvent },
              }))
            }
          >
            <option value="" disabled>
              {goal.conversionGoal ? "Choose an event" : "Choose a conversion goal first"}
            </option>
            {/* Only events the chosen goal can actually produce. An optimiser
                reading an event the goal never emits optimises for noise. */}
            {SUCCESS_EVENTS.filter((event) => compatible.includes(event.value)).map((event) => (
              <option key={event.value} value={event.value}>
                {event.label}
              </option>
            ))}
          </Select>
        </Field>
      </SectionCard>

      <aside className="space-y-4">
        <RailCard icon={Lightbulb} title="Tips for success" tone="warning">
          <TickList items={TIPS} />
        </RailCard>

        <RailCard icon={Target} title="Conversion goal options">
          <ul className="-mx-1.5 space-y-0.5" role="radiogroup" aria-label="Conversion goal">
            {CONVERSION_GOALS.map((option) => {
              const isSelected = option.value === goal.conversionGoal;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setGoal(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors",
                      isSelected ? "bg-success-50" : "hover:bg-surface-hover",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        isSelected ? "border-success-600" : "border-line-strong",
                      )}
                    >
                      {isSelected && <span className="size-2 rounded-full bg-success-600" />}
                    </span>
                    <span
                      className={cn(
                        "truncate text-[12.5px]",
                        isSelected ? "font-medium text-content" : "text-content-secondary",
                      )}
                    >
                      {option.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </RailCard>

        <RailCard icon={BarChart3} title="How this helps" tone="info">
          <p className="text-[12.5px] leading-relaxed text-content-secondary">
            A clear goal allows ClientTurn to optimise your audience, messaging and send
            strategy for the best chance of generating qualified opportunities.
          </p>
        </RailCard>
      </aside>
    </div>
  );
}
