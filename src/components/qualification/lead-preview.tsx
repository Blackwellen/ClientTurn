"use client";

import * as React from "react";
import { Check, CircleAlert, CircleCheck, CircleSlash, Eye } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import type { QualificationResult } from "@/lib/qualification/engine";
import type { ServiceAreaSettings, ServiceRef } from "@/lib/qualification/types";
import type { DraftQuestion } from "@/lib/qualification/draft";
import {
  PREVIEW_RESULT_COPY,
  applicableQuestions,
  evaluateDraft,
  matchConfiguredValue,
} from "@/lib/qualification/preview";
import { answerValues } from "@/lib/qualification/routing";

const RESULT_STYLE: Record<
  QualificationResult,
  { wrap: string; icon: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  QUALIFIED: {
    wrap: "border-success-100 bg-success-50",
    icon: "bg-success-500 text-white",
    Icon: CircleCheck,
  },
  REVIEW: {
    wrap: "border-warning-100 bg-warning-50",
    icon: "bg-warning-500 text-white",
    Icon: CircleAlert,
  },
  NOT_QUALIFIED: {
    wrap: "border-danger-100 bg-danger-50",
    icon: "bg-danger-500 text-white",
    Icon: CircleSlash,
  },
  PENDING: {
    wrap: "border-line bg-surface-sunken",
    icon: "bg-content-subtle text-white",
    Icon: CircleAlert,
  },
};

/**
 * "Preview for leads" — the draft rendered as the enquiry form a lead sees,
 * with the real outcome underneath it.
 *
 * The result comes from `evaluateQualification`, the same deterministic engine
 * the intake pipeline runs. It is never hard-coded to QUALIFIED: change an
 * answer and the verdict changes with it, exactly as it would in production.
 * Because the engine is pure, this works on questions that have never been
 * saved.
 */
export function LeadPreview({
  questions,
  services,
  serviceArea,
  serviceId,
  onServiceChange,
}: {
  questions: DraftQuestion[];
  services: ServiceRef[];
  serviceArea: ServiceAreaSettings;
  serviceId: string | null;
  onServiceChange: (next: string | null) => void;
}) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});

  const applicable = applicableQuestions(questions, serviceId);
  const outcome = evaluateDraft({
    questions,
    answers,
    serviceId,
    services,
    serviceArea,
  });

  const style = RESULT_STYLE[outcome.result];
  const copy = PREVIEW_RESULT_COPY[outcome.result];

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-0">
        <SectionHeader
          icon={Eye}
          tone="info"
          title="Preview for leads"
          description="This is how your questions will appear to a new enquiry."
        />
      </CardHeader>

      <CardContent className="pt-4">
        <div className="border-line bg-surface-sunken/50 rounded-xl border p-4">
          <h3 className="text-content text-[15px] font-semibold">
            Tell us a bit about your enquiry
          </h3>
          <p className="text-content-muted mt-0.5 text-[13px]">
            This helps us get you to the right information.
          </p>

          {services.length > 0 && (
            <div className="mt-3">
              <label
                htmlFor="preview-service"
                className="text-content text-[13px] font-medium"
              >
                Answering as
              </label>
              <Select
                id="preview-service"
                className="mt-1 h-9 bg-[var(--lr-surface)] text-[13px]"
                value={serviceId ?? ""}
                onChange={(event) => onServiceChange(event.target.value || null)}
              >
                <option value="">No service identified</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {service.active ? "" : " (inactive)"}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {applicable.length === 0 ? (
            <p className="text-content-muted mt-4 text-[13px]">
              No question applies to this service yet, so an enquiry would go
              straight to a person.
            </p>
          ) : (
            <ol className="mt-4 space-y-3.5">
              {applicable.map((question, index) => (
                <PreviewField
                  key={question.key}
                  question={question}
                  index={index}
                  value={answers[question.key] ?? ""}
                  onChange={(next) =>
                    setAnswers((current) => ({ ...current, [question.key]: next }))
                  }
                />
              ))}
            </ol>
          )}

          <div
            role="status"
            aria-live="polite"
            className={cn("mt-4 flex items-start gap-2.5 rounded-lg border p-3", style.wrap)}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full",
                style.icon,
              )}
            >
              <style.Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-content text-[13px] font-semibold">
                {copy.label}
              </p>
              <p className="text-content-secondary mt-0.5 text-[12px] leading-[1.5]">
                {copy.detail}
              </p>
              {outcome.reasons.length > 0 && (
                <details className="mt-1.5">
                  <summary className="text-content-muted cursor-pointer text-[12px]">
                    Why
                  </summary>
                  <ul className="text-content-muted mt-1 space-y-0.5 text-[12px]">
                    {outcome.reasons.map((reason, i) => (
                      <li key={`${reason.code}-${i}`}>{reason.detail}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewField({
  question,
  index,
  value,
  onChange,
}: {
  question: DraftQuestion;
  index: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `preview-${question.key}`;
  const values = answerValues(question);
  const matched =
    value.trim() === ""
      ? null
      : matchConfiguredValue(
          question.responseType,
          question.options.map((option) => option.value),
          value,
        );

  return (
    <li>
      <p className="text-content text-[13px] font-medium">
        <span className="lr-tabular text-content-muted">{index + 1}.</span>{" "}
        {question.questionText.trim() || "Untitled question"}
        {question.required && (
          <span className="text-danger-600 ml-0.5" aria-hidden>
            *
          </span>
        )}
        {question.required && <span className="sr-only"> (required)</span>}
      </p>

      {question.responseType === "yes_no" ? (
        <fieldset className="mt-1.5">
          <legend className="sr-only">{question.questionText}</legend>
          <div className="flex items-center gap-4">
            {values.map((entry) => (
              <label
                key={entry.value}
                className="text-content flex cursor-pointer items-center gap-1.5 text-[13px]"
              >
                <input
                  type="radio"
                  name={id}
                  value={entry.value}
                  checked={value === entry.value}
                  onChange={() => onChange(entry.value)}
                  className="accent-[var(--lr-accent-600)] size-4 cursor-pointer"
                />
                {entry.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : values.length > 0 ? (
        <Select
          id={id}
          className="mt-1.5 h-9 bg-[var(--lr-surface)] text-[13px]"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose an answer</option>
          {values.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
          <option value="something else entirely">
            Something that matches no option
          </option>
        </Select>
      ) : (
        <div className="relative mt-1.5">
          <Input
            id={id}
            className="h-9 bg-[var(--lr-surface)] pr-8 text-[13px]"
            inputMode={question.responseType === "number" ? "numeric" : "text"}
            value={value}
            maxLength={200}
            placeholder={
              question.responseType === "postcode" ? "BH2 6AA" : "Type an answer"
            }
            onChange={(event) => onChange(event.target.value)}
          />
          {matched !== null && (
            <Check
              aria-hidden
              className="text-success-600 pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
            />
          )}
        </div>
      )}
    </li>
  );
}
