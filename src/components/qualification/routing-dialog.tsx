"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import { RESPONSE_TYPE_META } from "@/lib/qualification/types";
import {
  MAX_QUESTION_OPTIONS,
  newDraftKey,
  slugifyOptionValue,
  usesOptions,
  type DraftOption,
  type DraftQuestion,
} from "@/lib/qualification/draft";
import {
  ROUTE_DESTINATIONS,
  ROUTE_META,
  answerValues,
  readAllowedPrefixes,
  readNumberRange,
  readRouting,
  writeAllowedPrefixes,
  writeNumberRange,
  writeRouting,
  type RouteDestination,
} from "@/lib/qualification/routing";

/**
 * Editing what a question's answers mean.
 *
 * Everything is staged locally and applied on Save, so cancelling out of the
 * dialog leaves the draft exactly as it was — the same contract the page
 * itself has with the database.
 */
export function RoutingDialog({
  question,
  index,
  open,
  onClose,
  onSave,
}: {
  question: DraftQuestion | null;
  index: number;
  open: boolean;
  onClose: () => void;
  onSave: (next: Partial<DraftQuestion>) => void;
}) {
  if (!open || !question) return null;
  // Keyed on the question, so opening the dialog on a different row mounts a
  // fresh form seeded from that row rather than syncing state in an effect.
  return (
    <RoutingForm
      key={question.key}
      question={question}
      index={index}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function RoutingForm({
  question,
  index,
  onClose,
  onSave,
}: {
  question: DraftQuestion;
  index: number;
  onClose: () => void;
  onSave: (next: Partial<DraftQuestion>) => void;
}) {
  const target = question;
  const [options, setOptions] = React.useState<DraftOption[]>(() =>
    question.options.map((option) => ({ ...option })),
  );
  const [routing, setRouting] = React.useState<Record<string, RouteDestination>>(
    () => readRouting(question),
  );
  const [prefixes, setPrefixes] = React.useState(() =>
    readAllowedPrefixes(question).join(", "),
  );
  const [range, setRange] = React.useState(() => readNumberRange(question));

  const choice = usesOptions(question.responseType);
  const yesNo = question.responseType === "yes_no";
  const postcode = question.responseType === "postcode";
  const number = question.responseType === "number";

  // Options edited here drive the routing list, so the two stay in step
  // without needing a save round-trip in between.
  const values = answerValues({ ...target, options });

  function save() {
    let next: Partial<DraftQuestion> = {};

    if (postcode) {
      next = {
        rules: writeAllowedPrefixes(target, prefixes.split(/[,\s]+/)),
      };
    } else if (number) {
      next = { rules: writeNumberRange(target, range) };
    } else if (choice || yesNo) {
      const cleaned = options.map((option) => ({
        ...option,
        label: option.label.trim(),
        value: option.value.trim() || slugifyOptionValue(option.label),
      }));
      const withOptions: DraftQuestion = { ...target, options: cleaned };
      next = {
        options: choice ? cleaned : target.options,
        rules: writeRouting(withOptions, routing),
      };
    }

    onSave(next);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Question ${index + 1} rules`}
      description={
        question.questionText.trim() ||
        RESPONSE_TYPE_META[question.responseType].hint
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save rules
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {choice && (
          <section>
            <h3 className="text-content text-[13px] font-semibold">Options</h3>
            <p className="text-content-muted mt-0.5 text-[12px]">
              What a lead can choose from. A reply that matches no option is sent
              to review rather than guessed at.
            </p>
            <ul className="mt-2.5 space-y-2">
              {options.map((option, i) => (
                <li key={option.key} className="flex items-center gap-2">
                  <Input
                    aria-label={`Option ${i + 1} label`}
                    className="h-9 flex-1 text-[13px]"
                    value={option.label}
                    maxLength={80}
                    onChange={(event) =>
                      setOptions((rows) =>
                        rows.map((row) =>
                          row.key === option.key
                            ? {
                                ...row,
                                label: event.target.value,
                                // The stored value follows the label until it
                                // has been persisted; after that it is frozen
                                // so existing answers keep matching.
                                value: row.value.startsWith("opt_")
                                  ? row.value
                                  : slugifyOptionValue(event.target.value),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Remove option ${i + 1}`}
                    disabled={options.length <= 2}
                    onClick={() =>
                      setOptions((rows) =>
                        rows.filter((row) => row.key !== option.key),
                      )
                    }
                  >
                    <Trash2 className="text-danger-600 size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
            {options.length < MAX_QUESTION_OPTIONS && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2.5"
                onClick={() =>
                  setOptions((rows) => [
                    ...rows,
                    { key: newDraftKey("o"), label: "", value: "" },
                  ])
                }
              >
                <Plus className="size-3.5" />
                Add option
              </Button>
            )}
          </section>
        )}

        {(choice || yesNo) && (
          <section>
            <h3 className="text-content text-[13px] font-semibold">
              Where each answer goes
            </h3>
            <p className="text-content-muted mt-0.5 text-[12px]">
              &quot;Continue&quot; carries on to the next question. A rejection
              ends the evaluation immediately; a review hands the enquiry to a
              person instead.
            </p>
            <ul className="mt-2.5 space-y-2">
              {values.map((entry) => (
                <li key={entry.value} className="flex items-center gap-3">
                  <span className="text-content min-w-0 flex-1 truncate text-[13px]">
                    {entry.label || "Untitled option"}
                  </span>
                  <span aria-hidden className="text-content-subtle">
                    →
                  </span>
                  <Select
                    aria-label={`Where "${entry.label}" goes`}
                    className="h-9 w-44 text-[13px]"
                    value={routing[entry.value] ?? "continue"}
                    onChange={(event) =>
                      setRouting((current) => ({
                        ...current,
                        [entry.value]: event.target.value as RouteDestination,
                      }))
                    }
                  >
                    {ROUTE_DESTINATIONS.map((destination) => (
                      <option key={destination} value={destination}>
                        {ROUTE_META[destination].label}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        )}

        {postcode && (
          <section className="space-y-1.5">
            <Label htmlFor="routing-prefixes">Allowed postcode prefixes</Label>
            <Input
              id="routing-prefixes"
              className="text-[13px]"
              value={prefixes}
              placeholder="BH1, BH2, BH3, BH4"
              onChange={(event) => setPrefixes(event.target.value)}
            />
            <p className="text-content-muted text-[12px]">
              Separate with commas. Leave empty to accept any postcode. A
              postcode outside this list is not qualified.
            </p>
          </section>
        )}

        {number && (
          <section className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="routing-min">Minimum accepted</Label>
              <Input
                id="routing-min"
                type="number"
                className="text-[13px]"
                value={range.min}
                onChange={(event) =>
                  setRange((current) => ({ ...current, min: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="routing-max">Maximum accepted</Label>
              <Input
                id="routing-max"
                type="number"
                className="text-[13px]"
                value={range.max}
                onChange={(event) =>
                  setRange((current) => ({ ...current, max: event.target.value }))
                }
              />
            </div>
            <p className="text-content-muted col-span-2 text-[12px]">
              Leave either empty for no bound. An answer outside the range is not
              qualified.
            </p>
          </section>
        )}

        {!choice && !yesNo && !postcode && !number && (
          <p className="text-content-muted text-[13px]">
            {RESPONSE_TYPE_META[question.responseType].hint} There is nothing to
            route: the answer is recorded for a person to read.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** The "View question types" reference, so the type list explains itself. */
export function QuestionTypesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Question types"
      description="Every type is validated deterministically. An answer that cannot be matched goes to review — it is never guessed at."
    >
      <dl className="divide-line divide-y">
        {(
          Object.entries(RESPONSE_TYPE_META) as [
            keyof typeof RESPONSE_TYPE_META,
            (typeof RESPONSE_TYPE_META)[keyof typeof RESPONSE_TYPE_META],
          ][]
        ).map(([type, meta]) => (
          <div key={type} className="py-2.5 first:pt-0 last:pb-0">
            <dt className="text-content text-[13px] font-semibold">
              {meta.label}
            </dt>
            <dd className="text-content-muted mt-0.5 text-[13px]">{meta.hint}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
