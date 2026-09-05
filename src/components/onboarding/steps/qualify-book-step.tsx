"use client";

import * as React from "react";
import Link from "next/link";
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Filter,
  GripVertical,
  Hash,
  ListChecks,
  MapPin,
  Plus,
  ThumbsUp,
  Trash2,
  Type,
  Users,
  XCircle,
} from "lucide-react";
import { OBadge, OButton, OField, OInput, OPanel, ORadioCard, OSectionTitle, OSelect } from "../ui";
import type { StepActions } from "../step-types";
import { OPERATOR_META, RESPONSE_TYPE_META, operatorsFor } from "@/lib/qualification/types";
import type { Operator, ResponseType } from "@/lib/qualification/types";
import type { QualifyBookStepInput } from "@/lib/onboarding/actions";

const TYPE_ICON: Record<ResponseType, React.ComponentType<{ className?: string }>> = {
  single_choice: ListChecks,
  postcode: MapPin,
  number: Hash,
  timing: Calendar,
  yes_no: CheckCircle2,
  text: Type,
};

const RESULT_OPTIONS: { value: "pass" | "hard_fail" | "review"; label: string }[] = [
  { value: "hard_fail", label: "Must match, or not qualified" },
  { value: "review", label: "Flag for review if it doesn't match" },
  { value: "pass", label: "Informational only" },
];

export type QuestionRow = {
  id?: string;
  questionText: string;
  responseType: ResponseType;
  required: boolean;
  optionsText: string;
  rule: {
    id?: string;
    operator: Operator;
    comparisonValue: string[];
    result: "pass" | "hard_fail" | "review";
  } | null;
};

export type QualifyBookInitial = {
  questions: QuestionRow[];
  bookingMode: "calendly" | "google_calendar" | "handover";
  bookingUrl: string;
  calendlyConnected: boolean;
  googleCalendarConnected: boolean;
};

function QuestionRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: QuestionRow;
  onChange: (next: QuestionRow) => void;
  onRemove: () => void;
}) {
  const Icon = TYPE_ICON[row.responseType];
  const usesOptions = row.responseType === "single_choice" || row.responseType === "timing";
  const operators = operatorsFor(row.responseType);

  return (
    <OPanel className="bg-[#0c151d] p-3">
      <div className="flex items-start gap-2.5">
        <GripVertical className="mt-2.5 size-3.5 shrink-0 text-[#4a5568]" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-[#9ad84a]" aria-hidden />
            <OInput
              value={row.questionText}
              placeholder="Question"
              onChange={(e) => onChange({ ...row, questionText: e.target.value })}
              className="h-8 border-none bg-transparent px-0 font-medium focus:ring-0"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <OSelect
              aria-label="Answer type"
              value={row.responseType}
              onChange={(e) => {
                const responseType = e.target.value as ResponseType;
                const nextOperators = operatorsFor(responseType);
                onChange({
                  ...row,
                  responseType,
                  rule: row.rule
                    ? { ...row.rule, operator: nextOperators[0] ?? row.rule.operator }
                    : null,
                });
              }}
            >
              {Object.entries(RESPONSE_TYPE_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </OSelect>
            {row.rule ? (
              <>
                <OSelect
                  aria-label="Rule condition"
                  value={row.rule.operator}
                  onChange={(e) =>
                    onChange({ ...row, rule: { ...row.rule!, operator: e.target.value as Operator } })
                  }
                >
                  {operators.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_META[op].label}
                    </option>
                  ))}
                </OSelect>
                <OSelect
                  aria-label="Rule outcome"
                  value={row.rule.result}
                  onChange={(e) =>
                    onChange({
                      ...row,
                      rule: { ...row.rule!, result: e.target.value as "pass" | "hard_fail" | "review" },
                    })
                  }
                >
                  {RESULT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </OSelect>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...row,
                    rule: { operator: operators[0] ?? "is_present", comparisonValue: [], result: "review" },
                  })
                }
                className="col-span-2 rounded-[7px] border border-dashed border-[rgba(150,170,190,0.35)] px-3 text-left text-[12.5px] text-[#697488] hover:border-[rgba(168,255,31,0.4)] hover:text-[var(--auth-lime)]"
              >
                + Add a qualifying rule
              </button>
            )}
          </div>
          {row.rule && OPERATOR_META[row.rule.operator].values !== "none" && (
            <OInput
              value={row.rule.comparisonValue.join(", ")}
              placeholder="Accepted values, comma separated"
              onChange={(e) =>
                onChange({
                  ...row,
                  rule: {
                    ...row.rule!,
                    comparisonValue: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          )}
          {usesOptions && (
            <OField hint="Comma separated options a lead can choose from.">
              <OInput
                value={row.optionsText}
                placeholder="Option one, option two, option three"
                onChange={(e) => onChange({ ...row, optionsText: e.target.value })}
              />
            </OField>
          )}
        </div>
        <button
          type="button"
          aria-label="Remove question"
          onClick={onRemove}
          className="mt-2.5 shrink-0 text-[#7a8698] hover:text-[#ff6b70]"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </OPanel>
  );
}

export function QualifyBookStep({
  initial,
  onContinue,
  onSaveExit,
  onRegisterActions,
}: {
  initial: QualifyBookInitial;
  onContinue: (payload: QualifyBookStepInput) => void;
  onSaveExit: (payload: QualifyBookStepInput) => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [questions, setQuestions] = React.useState<QuestionRow[]>(
    initial.questions.length > 0
      ? initial.questions
      : [
          {
            questionText: "What service do you need?",
            responseType: "single_choice",
            required: true,
            optionsText: "",
            rule: { operator: "is_present", comparisonValue: [], result: "review" },
          },
        ],
  );
  const [deletedIds, setDeletedIds] = React.useState<string[]>([]);
  const [bookingMode, setBookingMode] = React.useState(initial.bookingMode);
  const [bookingUrl, setBookingUrl] = React.useState(initial.bookingUrl);

  function buildPayload(): QualifyBookStepInput {
    return {
      questions: questions
        .filter((q) => q.questionText.trim().length > 2)
        .map((q) => ({
          id: q.id,
          questionText: q.questionText,
          responseType: q.responseType,
          required: q.required,
          options: q.optionsText
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => ({ label: v, value: v })),
          rule: q.rule,
        })),
      deletedQuestionIds: deletedIds,
      bookingMode,
      bookingUrl,
    };
  }

  const disabledReason =
    questions.filter((q) => q.questionText.trim().length > 2).length === 0
      ? "Add at least one qualifying question before continuing."
      : bookingMode !== "handover" && !bookingUrl
        ? "Add your booking link, or choose human handover."
        : undefined;

  React.useEffect(() => {
    onRegisterActions({
      continue: () => onContinue(buildPayload()),
      saveExit: () => onSaveExit(buildPayload()),
      disabledReason,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, deletedIds, bookingMode, bookingUrl, disabledReason]);

  function removeQuestion(index: number) {
    setQuestions((prev) => {
      const target = prev[index];
      if (target.id) setDeletedIds((ids) => [...ids, target.id!]);
      return prev.filter((_, i) => i !== index);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.9fr_1fr]">
      <div className="space-y-5">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <OSectionTitle hint="Create the questions you want to ask your leads. Use rules to set how each answer affects qualification.">
              Qualification questions
            </OSectionTitle>
            <OButton
              variant="secondary"
              size="sm"
              disabled={questions.length >= 10}
              onClick={() =>
                setQuestions((prev) => [
                  ...prev,
                  {
                    questionText: "",
                    responseType: "text",
                    required: false,
                    optionsText: "",
                    rule: null,
                  },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add question
            </OButton>
          </div>
          <div className="space-y-2">
            {questions.map((row, i) => (
              <QuestionRowEditor
                key={i}
                row={row}
                onChange={(next) => setQuestions((prev) => prev.map((q, j) => (j === i ? next : q)))}
                onRemove={() => removeQuestion(i)}
              />
            ))}
          </div>
        </div>

        <div>
          <OSectionTitle hint="Choose where to send qualified leads.">Booking destination</OSectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ORadioCard
              selected={bookingMode === "calendly"}
              onSelect={() => initial.calendlyConnected && setBookingMode("calendly")}
              disabled={!initial.calendlyConnected}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-[#f0f3f8]">Calendly</span>
                <OBadge tone={initial.calendlyConnected ? "success" : "neutral"}>
                  {initial.calendlyConnected ? "Connected" : "Not connected"}
                </OBadge>
              </div>
              <p className="mt-1 text-[12.5px] text-[#8c98ab]">
                Automatically book qualified leads into your Calendly calendar.
              </p>
            </ORadioCard>
            <ORadioCard
              selected={bookingMode === "google_calendar"}
              onSelect={() => initial.googleCalendarConnected && setBookingMode("google_calendar")}
              disabled={!initial.googleCalendarConnected}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-[#f0f3f8]">Google Calendar</span>
                <OBadge tone={initial.googleCalendarConnected ? "success" : "neutral"}>
                  {initial.googleCalendarConnected ? "Connected" : "Not connected"}
                </OBadge>
              </div>
              <p className="mt-1 text-[12.5px] text-[#8c98ab]">
                Create bookings directly in your Google Calendar.
              </p>
            </ORadioCard>
            <ORadioCard selected={bookingMode === "handover"} onSelect={() => setBookingMode("handover")}>
              <span className="flex items-center gap-2 text-[14px] font-medium text-[#f0f3f8]">
                <Users className="size-4" aria-hidden />
                Human handover
              </span>
              <p className="mt-1 text-[12.5px] text-[#8c98ab]">
                Send qualified leads to your team for manual follow-up.
              </p>
            </ORadioCard>
          </div>
          {bookingMode !== "handover" && (
            <OField label="Booking link" className="mt-3" required>
              <OInput
                type="url"
                placeholder="https://calendly.com/your-business/survey"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
              />
            </OField>
          )}
          {(bookingMode === "calendly" && !initial.calendlyConnected) ||
          (bookingMode === "google_calendar" && !initial.googleCalendarConnected) ? (
            <p className="mt-2 text-[12.5px] text-[#ffb020]">
              Connect this in{" "}
              <Link href="/app/settings/connections" className="underline underline-offset-2">
                Settings → Connections
              </Link>{" "}
              before choosing it as your booking destination.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <OSectionTitle hint="ClientTurn asks your leads a few key questions, uses your rules to qualify them, and then takes the next step.">
            How it works
          </OSectionTitle>
          <ul className="space-y-3">
            {[
              { icon: ListChecks, title: "Ask questions", body: "We'll ask your leads the questions you set up and capture their answers." },
              { icon: Filter, title: "Apply your rules", body: "Each answer is checked against your rules to determine the lead's status." },
              { icon: CalendarClock, title: "Take the right action", body: "Qualified leads are booked or sent to your team based on your settings." },
            ].map((item) => (
              <li key={item.title} className="flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[rgba(168,255,31,0.1)] text-[var(--auth-lime)]">
                  <item.icon className="size-3.5" aria-hidden />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-[#f0f3f8]">{item.title}</p>
                  <p className="text-[12.5px] text-[#8c98ab]">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <OSectionTitle hint="Leads are automatically routed based on their answers and your rules.">
            Qualification outcomes
          </OSectionTitle>
          <div className="space-y-2">
            <OPanel className="flex items-start gap-2.5 bg-[#0c151d]">
              <ThumbsUp className="mt-0.5 size-4 shrink-0 text-[var(--auth-lime)]" aria-hidden />
              <div>
                <p className="text-[12.5px] font-semibold text-[var(--auth-lime)]">QUALIFIED</p>
                <p className="text-[12.5px] text-[#8c98ab]">
                  Meets your criteria. Sent to your chosen booking destination.
                </p>
              </div>
            </OPanel>
            <OPanel className="flex items-start gap-2.5 bg-[#0c151d]">
              <Clock className="mt-0.5 size-4 shrink-0 text-[#ffb020]" aria-hidden />
              <div>
                <p className="text-[12.5px] font-semibold text-[#ffb020]">REVIEW</p>
                <p className="text-[12.5px] text-[#8c98ab]">
                  Needs attention. We&rsquo;ll flag this lead for your team to review.
                </p>
              </div>
            </OPanel>
            <OPanel className="flex items-start gap-2.5 bg-[#0c151d]">
              <XCircle className="mt-0.5 size-4 shrink-0 text-[#ff6b70]" aria-hidden />
              <div>
                <p className="text-[12.5px] font-semibold text-[#ff6b70]">NOT QUALIFIED</p>
                <p className="text-[12.5px] text-[#8c98ab]">
                  Doesn&rsquo;t meet your criteria. The conversation ends politely.
                </p>
              </div>
            </OPanel>
          </div>
        </div>
      </div>
    </div>
  );
}
