"use client";

import * as React from "react";
import { FileText, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { addAllowedService } from "@/lib/leads/add-lead/actions";
import {
  CONVERSION_GOALS,
  LEAD_SOURCES,
  MAX_ENQUIRY,
  MAX_NOTES,
  conversionGoalLabel,
  sourceDetailRequired,
  sourceValueLabel,
  type ConversionGoalValue,
  type EnquiryState,
  type FieldErrors,
  type LeadSourceValue,
} from "@/lib/leads/add-lead/types";
import type { WizardService } from "@/lib/leads/add-lead/queries";
import { CharCount, GuidanceList, RailCard, RailNote, StepHeading } from "./pieces";

const GUIDANCE = [
  { title: "Service", detail: "Select the most relevant service for this enquiry." },
  {
    title: "Enquiry / interest",
    detail: "Describe what the person needs in their own words.",
  },
  {
    title: "Source",
    detail: "Record where this enquiry came from (e.g. phone call, referral, import).",
  },
  {
    title: "Source detail",
    detail: "Add extra context about the source (for example, which campaign or referrer).",
  },
  {
    title: "Estimated value",
    detail: "Add an optional estimate to help with forecasting. This is not revenue.",
  },
  {
    title: "Conversion goal",
    detail: "Set what you're aiming to achieve (e.g. site visit, quote, call).",
  },
];

/**
 * Adding a service from inside the wizard. Opens in place rather than
 * navigating away, so the half-filled wizard is never lost — and is only
 * rendered at all when the current role may manage services.
 */
function AddServiceInline({
  onCreated,
  onCancel,
}: {
  onCreated: (service: WizardService) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit() {
    if (!name.trim()) {
      setError("Enter a service name.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await addAllowedService({ name, averageValue: value });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({ variant: "success", title: `“${result.name}” added to your services` });
    onCreated({ id: result.id, name: result.name, averageValue: null });
  }

  return (
    <div className="rounded-xl border border-line bg-surface-sunken/50 p-3">
      <p className="text-[13px] font-semibold text-content">Add allowed service</p>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
        <Input
          ref={inputRef}
          value={name}
          placeholder="Service name"
          aria-label="Service name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          value={value}
          placeholder="Average value"
          aria-label="Average job value"
          inputMode="decimal"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" loading={busy} onClick={submit}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-danger-600">{error}</p>}
    </div>
  );
}

export function EnquiryStep({
  value,
  errors,
  services,
  canManageServices,
  currencySymbol,
  onChange,
  onServiceCreated,
}: {
  value: EnquiryState;
  errors: FieldErrors;
  services: WizardService[];
  canManageServices: boolean;
  currencySymbol: string;
  onChange: (patch: Partial<EnquiryState>) => void;
  onServiceCreated: (service: WizardService) => void;
}) {
  const id = React.useId();
  const field = (name: string) => `${id}-${name}`;
  const [adding, setAdding] = React.useState(false);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_268px]">
      <div className="min-w-0 space-y-4">
        <StepHeading
          step={2}
          title="Enquiry"
          description="Capture the nature of the enquiry and its commercial context."
        />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <FormField
            label="Service"
            required
            htmlFor={field("service")}
            error={errors.serviceId}
          >
            <Select
              id={field("service")}
              value={value.serviceId}
              aria-invalid={Boolean(errors.serviceId)}
              onChange={(event) => onChange({ serviceId: event.target.value })}
            >
              <option value="">
                {services.length === 0
                  ? "No active services — add one"
                  : "Choose a service"}
              </option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </FormField>

          {canManageServices && !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add allowed service
            </Button>
          )}
        </div>

        {adding && (
          <AddServiceInline
            onCancel={() => setAdding(false)}
            onCreated={(service) => {
              setAdding(false);
              onServiceCreated(service);
            }}
          />
        )}

        <FormField
          label="Enquiry / interest"
          required
          htmlFor={field("enquiry")}
          error={errors.enquiryText}
        >
          <Textarea
            id={field("enquiry")}
            rows={4}
            value={value.enquiryText}
            aria-invalid={Boolean(errors.enquiryText)}
            placeholder="What does this person need?"
            onChange={(event) => onChange({ enquiryText: event.target.value })}
          />
          <CharCount value={value.enquiryText} max={MAX_ENQUIRY} />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Source"
            required
            htmlFor={field("source")}
            error={errors.source}
          >
            <Select
              id={field("source")}
              value={value.source}
              onChange={(event) =>
                onChange({ source: event.target.value as LeadSourceValue })
              }
            >
              {LEAD_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sourceValueLabel(source)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Source detail"
            required={sourceDetailRequired(value.source)}
            htmlFor={field("detail")}
            error={errors.sourceDetail}
          >
            <Input
              id={field("detail")}
              value={value.sourceDetail}
              maxLength={300}
              aria-invalid={Boolean(errors.sourceDetail)}
              placeholder="e.g. Inbound call from existing yard sign"
              onChange={(event) => onChange({ sourceDetail: event.target.value })}
            />
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Estimated value (optional)"
            hint="This is an estimate only and not revenue."
            htmlFor={field("value")}
            error={errors.estimatedValue}
          >
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 flex h-9 w-8 items-center justify-center rounded-l-md border-r border-line text-[13px] text-content-muted"
              >
                {currencySymbol}
              </span>
              <Input
                id={field("value")}
                className="pl-10"
                inputMode="decimal"
                value={value.estimatedValue}
                aria-invalid={Boolean(errors.estimatedValue)}
                onChange={(event) =>
                  onChange({ estimatedValue: event.target.value })
                }
              />
            </div>
          </FormField>

          <FormField
            label="Conversion goal"
            required
            htmlFor={field("goal")}
            error={errors.conversionGoal}
          >
            <Select
              id={field("goal")}
              value={value.conversionGoal}
              aria-invalid={Boolean(errors.conversionGoal)}
              onChange={(event) =>
                onChange({
                  conversionGoal: event.target.value as ConversionGoalValue,
                })
              }
            >
              <option value="">Choose a goal</option>
              {CONVERSION_GOALS.map((goal) => (
                <option key={goal} value={goal}>
                  {conversionGoalLabel(goal)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          label="Notes"
          hint="Notes are internal only and won't be shared with the lead."
          htmlFor={field("notes")}
          error={errors.notes}
        >
          <Textarea
            id={field("notes")}
            rows={3}
            value={value.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
          <CharCount value={value.notes} max={MAX_NOTES} />
        </FormField>
      </div>

      <aside className="min-w-0 space-y-3">
        <RailCard icon={FileText} title="Enquiry guidance">
          <p className="mb-3 text-[12px] leading-[1.5] text-content-muted">
            Capture the key details about what the person needs and where the
            enquiry comes from.
          </p>
          <GuidanceList items={GUIDANCE} />
        </RailCard>

        <RailNote icon={Info} tone="info" title="Provenance matters">
          Manual source provenance is stored with the lead and does not bypass
          any compliance or quality checks.
        </RailNote>
      </aside>
    </div>
  );
}
