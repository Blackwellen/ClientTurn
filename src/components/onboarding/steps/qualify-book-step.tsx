"use client";

import * as React from "react";
import Link from "next/link";
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  EllipsisVertical,
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
import { OBadge, OButton, OField, OInput, OPanel, ORadioCard, OSectionTitle } from "../ui";
import type { StepActions } from "../step-types";
import { RESPONSE_TYPE_META } from "@/lib/qualification/types";
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

type RulePreset = {
  key: string;
  label: string;
  operator: Operator;
  result: "pass" | "hard_fail" | "review";
  fixedValue?: string[];
  needsValue?: boolean;
};

/**
 * One plain-English rule per question, matching the density of the reference
 * design rather than exposing the full operator/value/result matrix inline.
 * Each preset still writes real `qualification_rules` fields — "no rule" is
 * simply `pass`, which the engine never treats as blocking.
 */
const RULE_PRESETS: Record<ResponseType, RulePreset[]> = {
  single_choice: [
    { key: "required", label: "Must be a relevant service", operator: "is_present", result: "hard_fail" },
    { key: "none", label: "Optional (no rule)", operator: "is_present", result: "pass" },
  ],
  postcode: [
    { key: "area", label: "Must be in our service area", operator: "is_present", result: "pass" },
  ],
  number: [
    { key: "minimum", label: "Minimum", operator: "gte", result: "hard_fail", needsValue: true },
    { key: "none", label: "Optional (no rule)", operator: "gte", result: "pass" },
  ],
  timing: [
    {
      key: "soon",
      label: "Must want the work soon",
      operator: "in",
      result: "review",
      fixedValue: ["asap", "30_days"],
    },
    { key: "none", label: "Optional (no rule)", operator: "in", result: "pass" },
  ],
  yes_no: [
    {
      key: "must_yes",
      label: "Must own or have permission",
      operator: "equals",
      result: "hard_fail",
      fixedValue: ["yes"],
    },
    { key: "none", label: "Optional (no rule)", operator: "equals", result: "pass" },
  ],
  text: [{ key: "none", label: "Optional (for context)", operator: "is_present", result: "pass" }],
};

function presetKeyFor(row: QuestionRow): string {
  const presets = RULE_PRESETS[row.responseType];
  if (!row.rule) return presets[presets.length - 1].key;
  const match = presets.find(
    (preset) =>
      preset.operator === row.rule!.operator &&
      preset.result === row.rule!.result &&
      (!preset.needsValue ? true : true),
  );
  return match?.key ?? presets[0].key;
}

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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [showOptions, setShowOptions] = React.useState(false);
  const Icon = TYPE_ICON[row.responseType];
  const usesOptions = row.responseType === "single_choice" || row.responseType === "timing";
  const presets = RULE_PRESETS[row.responseType];
  const activePresetKey = presetKeyFor(row);
  const activePreset = presets.find((p) => p.key === activePresetKey) ?? presets[0];
  const minimumValue = row.rule?.comparisonValue[0] ?? "";

  function applyPreset(key: string) {
    const preset = presets.find((p) => p.key === key);
    if (!preset) return;
    onChange({
      ...row,
      rule: {
        id: row.rule?.id,
        operator: preset.operator,
        result: preset.result,
        comparisonValue: preset.fixedValue ?? (preset.needsValue ? [minimumValue || "0"] : []),
      },
    });
  }

  return (
    <OPanel className="bg-[#0c151d] p-2.5">
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <GripVertical className="size-3.5 shrink-0 text-[#4a5568]" aria-hidden />
        <OInput
          value={row.questionText}
          placeholder="Question"
          onChange={(e) => onChange({ ...row, questionText: e.target.value })}
          className="h-8 min-w-[180px] flex-1 border-none bg-transparent px-0 font-medium focus:ring-0"
        />

        <div className="relative flex shrink-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-[#9ad84a]" aria-hidden />
          <select
            aria-label="Answer type"
            value={row.responseType}
            onChange={(e) => {
              const responseType = e.target.value as ResponseType;
              onChange({ ...row, responseType, rule: null });
            }}
            className="h-7 w-[118px] shrink-0 appearance-none rounded-[6px] border-none bg-transparent text-[12.5px] text-[#c1cad6] outline-none"
          >
            {Object.entries(RESPONSE_TYPE_META).map(([value, meta]) => (
              <option key={value} value={value} className="bg-[#0c151d] text-[#dbe1ea]">
                {meta.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {row.responseType === "postcode" ? (
            <span className="text-[12.5px] text-[#8c98ab]">
              Automatically checked against your service area
            </span>
          ) : (
            <>
              <select
                aria-label="Qualifying rule"
                value={activePresetKey}
                onChange={(e) => applyPreset(e.target.value)}
                className="h-7 w-[212px] rounded-[6px] border border-[rgba(150,170,190,0.28)] bg-[#0b141d] px-2 text-[12.5px] text-[#dbe1ea] outline-none"
              >
                {presets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {activePreset.needsValue && (
                <div className="relative w-16 shrink-0">
                  <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[11.5px] text-[#8c98ab]">
                    £
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={minimumValue}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        rule: {
                          id: row.rule?.id,
                          operator: "gte",
                          result: "hard_fail",
                          comparisonValue: [e.target.value || "0"],
                        },
                      })
                    }
                    aria-label="Minimum value"
                    className="h-7 w-full rounded-[6px] border border-[rgba(150,170,190,0.28)] bg-[#0b141d] py-1 pr-1.5 pl-4 text-[12.5px] text-[#dbe1ea] outline-none"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="relative ml-auto shrink-0">
          <button
            type="button"
            aria-label="Question options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="text-[#7a8698] hover:text-[#eef2f7]"
          >
            <EllipsisVertical className="size-3.5" aria-hidden />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-6 right-0 z-20 min-w-[160px] overflow-hidden rounded-[8px] border border-[rgba(150,170,190,0.3)] bg-[#0d1720] shadow-lg">
                {usesOptions && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowOptions((v) => !v);
                    }}
                    className="flex w-full items-center px-3 py-2 text-left text-[12.5px] text-[#dbe1ea] hover:bg-[rgba(255,255,255,0.04)]"
                  >
                    Edit answer options
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-[#ff6b70] hover:bg-[rgba(255,107,112,0.08)]"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Remove question
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {showOptions && usesOptions && (
        <OField
          className="mt-2 pl-6"
          hint="Comma separated options a lead can choose from."
        >
          <OInput
            value={row.optionsText}
            placeholder="Option one, option two, option three"
            onChange={(e) => onChange({ ...row, optionsText: e.target.value })}
          />
        </OField>
      )}
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
                <span className="flex items-center gap-2 text-[14px] font-medium text-[#f0f3f8]">
                  <CalendarClock className="size-4 text-[#9ad84a]" aria-hidden />
                  Calendly
                </span>
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
                <span className="flex items-center gap-2 text-[14px] font-medium text-[#f0f3f8]">
                  <Calendar className="size-4 text-[#9ad84a]" aria-hidden />
                  Google Calendar
                </span>
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
              <Link href="/app/settings?section=connections" className="underline underline-offset-2">
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
