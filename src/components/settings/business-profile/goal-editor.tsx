"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  CONVERSION_GOAL_TYPES,
  goalLabel,
  type ConversionGoalRow,
  type ConversionGoalType,
} from "@/lib/business-profile/types";
import { saveConversionGoal } from "@/lib/business-profile/actions";

/**
 * Create or edit a conversion goal.
 *
 * The destination field changes with the goal type, because "book a demo" and
 * "hand over to a person" need genuinely different things — a calendar link
 * versus nothing at all. Showing one generic URL box for all of them is how
 * people end up pasting a phone number into a webhook field.
 */
const DESTINATIONS = [
  { value: "CALENDLY", label: "Calendly link", needsValue: true },
  { value: "GOOGLE_CALENDAR", label: "Google Calendar", needsValue: false },
  { value: "URL", label: "A web address", needsValue: true },
  { value: "WEBHOOK", label: "A webhook", needsValue: true },
  { value: "PHONE", label: "A phone call", needsValue: false },
  { value: "TEAM_HANDOVER", label: "Hand to the team", needsValue: false },
] as const;

export function GoalEditor({
  goal,
  onClose,
}: {
  goal: ConversionGoalRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [name, setName] = React.useState(goal?.name ?? "");
  const [type, setType] = React.useState<ConversionGoalType>(goal?.type ?? "BOOK_APPOINTMENT");
  const [destinationType, setDestinationType] = React.useState(
    goal?.destinationType ?? "CALENDLY",
  );
  const [destinationValue, setDestinationValue] = React.useState("");
  const [qualificationRequired, setQualificationRequired] = React.useState(
    goal?.qualificationRequired ?? true,
  );
  const [isDefault, setIsDefault] = React.useState(goal?.isDefault ?? false);

  const destination = DESTINATIONS.find((d) => d.value === destinationType);

  function submit() {
    startTransition(async () => {
      const result = await saveConversionGoal({
        id: goal?.id ?? "",
        name,
        type,
        destinationType,
        destinationValue,
        qualificationRequired,
        isDefault,
      });

      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-accent-200/60 bg-accent-50/30 p-4">
      <h3 className="text-[13px] font-semibold text-content">
        {goal ? "Edit goal" : "New conversion goal"}
      </h3>

      <div className="mt-3 space-y-3">
        <Field label="Name">
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Book a roof survey"
            className={INPUT}
          />
        </Field>

        <Field label="What should happen?">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as ConversionGoalType)}
            className={cn(INPUT, "h-9 py-0")}
          >
            {CONVERSION_GOAL_TYPES.map((value) => (
              <option key={value} value={value}>
                {goalLabel(value)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Where does it go?">
          <select
            value={destinationType}
            onChange={(event) => setDestinationType(event.target.value)}
            className={cn(INPUT, "h-9 py-0")}
          >
            {DESTINATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {destination?.needsValue && (
          <Field
            label="Address"
            hint="Must start with https://. This is what a lead is sent to."
          >
            <input
              value={destinationValue}
              onChange={(event) => setDestinationValue(event.target.value)}
              placeholder="https://calendly.com/your-team/survey"
              className={INPUT}
            />
          </Field>
        )}

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={qualificationRequired}
            onChange={(event) => setQualificationRequired(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
          />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium text-content">
              Qualify first
            </span>
            <span className="block text-[11px] text-content-muted">
              Ask your qualification questions before offering this. Turn off for goals you
              want everyone to reach.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
          />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium text-content">
              Make this the default
            </span>
            <span className="block text-[11px] text-content-muted">
              Used whenever a campaign or agent does not name a goal of its own.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" loading={pending} onClick={submit} disabled={!name.trim()}>
          {goal ? "Save changes" : "Create goal"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const INPUT = cn(
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-content",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
);

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}
