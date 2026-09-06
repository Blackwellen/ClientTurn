"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Copy,
  GitBranch,
  GripVertical,
  List,
  MapPin,
  MoreVertical,
  Settings2,
  Trash2,
} from "lucide-react";
import { Input, Select, Switch } from "@/components/ui/form";
import { IconButton } from "@/components/ui/button";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";
import {
  RESPONSE_TYPES,
  RESPONSE_TYPE_META,
  type ResponseType,
  type ServiceRef,
} from "@/lib/qualification/types";
import { defaultOptionsFor, usesOptions, type DraftQuestion } from "@/lib/qualification/draft";
import { describeRouting } from "@/lib/qualification/routing";

const RULE_ICON: Record<
  ReturnType<typeof describeRouting>["kind"],
  React.ComponentType<{ className?: string }>
> = {
  routing: GitBranch,
  validation: MapPin,
  options: List,
  none: List,
};

const RULE_LABEL: Record<ReturnType<typeof describeRouting>["kind"], string> = {
  routing: "Routing rule",
  validation: "Validation rule",
  options: "Options",
  none: "",
};

/**
 * One question in the editor: the question itself on the top line, and the
 * rule it produces on the line beneath it.
 *
 * The rule strip is a summary, not a second form — routing is edited in a
 * dialog so the row stays readable at a glance no matter how many answers a
 * question has.
 */
export function QuestionRow({
  question,
  index,
  total,
  services,
  canEdit,
  invalid,
  onPatch,
  onMove,
  onDuplicate,
  onRemove,
  onConfigureRouting,
  registerInput,
}: {
  question: DraftQuestion;
  index: number;
  total: number;
  services: ServiceRef[];
  canEdit: boolean;
  invalid: boolean;
  onPatch: (next: Partial<DraftQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onConfigureRouting: () => void;
  registerInput: (element: HTMLInputElement | null) => void;
}) {
  const rowId = `question-${question.key}`;
  const summary = describeRouting(question);
  const Icon = RULE_ICON[summary.kind];

  function changeType(next: ResponseType) {
    // Switching to a choice type with no options would leave the question
    // unanswerable, so it arrives with a sensible starting set.
    const options =
      usesOptions(next) && question.options.length === 0
        ? defaultOptionsFor(next)
        : usesOptions(next)
          ? question.options
          : [];
    onPatch({
      responseType: next,
      options,
      // Rules are written against the old answer shape; keeping them would
      // silently mis-route. They are rebuilt from the new type instead.
      rules: [],
    });
  }

  return (
    <li
      className={cn(
        "border-line bg-surface rounded-lg border p-3",
        "transition-colors duration-[var(--lr-duration-fast)]",
        invalid && "border-danger-500/60",
        !question.active && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="text-content-subtle hidden shrink-0 pt-2 sm:block"
        >
          <GripVertical className="size-4" />
        </span>
        <span
          aria-hidden
          className="bg-surface-sunken border-line text-content lr-tabular mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold"
        >
          {index + 1}
        </span>

        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_4.5rem_8rem]">
          <div className="min-w-0">
            <label
              htmlFor={`${rowId}-text`}
              className="text-content-subtle block text-[11px] font-medium"
            >
              Question
            </label>
            <Input
              id={`${rowId}-text`}
              ref={registerInput}
              className="mt-1 h-9 text-[13px]"
              value={question.questionText}
              maxLength={300}
              disabled={!canEdit}
              aria-invalid={invalid || undefined}
              placeholder="What do you want to ask?"
              onChange={(event) => onPatch({ questionText: event.target.value })}
            />
          </div>

          <div className="min-w-0">
            <label
              htmlFor={`${rowId}-type`}
              className="text-content-subtle block text-[11px] font-medium"
            >
              Type
            </label>
            <Select
              id={`${rowId}-type`}
              className="mt-1 h-9 text-[13px]"
              value={question.responseType}
              disabled={!canEdit}
              onChange={(event) => changeType(event.target.value as ResponseType)}
            >
              {RESPONSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {RESPONSE_TYPE_META[type].label}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-0">
            <span className="text-content-subtle block text-[11px] font-medium">
              Required
            </span>
            <div className="mt-1 flex h-9 items-center">
              <Switch
                checked={question.required}
                disabled={!canEdit}
                tone="success"
                size="lg"
                onCheckedChange={(next) => onPatch({ required: next })}
                label={`Question ${index + 1} is required`}
              />
            </div>
          </div>

          <div className="min-w-0">
            <label
              htmlFor={`${rowId}-service`}
              className="text-content-subtle block text-[11px] font-medium"
            >
              Applies to
            </label>
            <Select
              id={`${rowId}-service`}
              className="mt-1 h-9 text-[13px]"
              value={question.serviceId ?? ""}
              disabled={!canEdit || services.length === 0}
              onChange={(event) =>
                onPatch({ serviceId: event.target.value || null })
              }
            >
              <option value="">All services</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.active ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {canEdit && (
          <div className="mt-1 shrink-0">
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  size="sm"
                  label={`Options for question ${index + 1}`}
                >
                  <MoreVertical className="size-4" />
                </IconButton>
              }
            >
              <DropdownItem icon={Settings2} onSelect={onConfigureRouting}>
                Configure routing
              </DropdownItem>
              <DropdownItem icon={Copy} onSelect={onDuplicate}>
                Duplicate
              </DropdownItem>
              <DropdownItem
                icon={ArrowUp}
                disabled={index === 0}
                onSelect={() => onMove(-1)}
              >
                Move up
              </DropdownItem>
              <DropdownItem
                icon={ArrowDown}
                disabled={index === total - 1}
                onSelect={() => onMove(1)}
              >
                Move down
              </DropdownItem>
              <DropdownItem
                icon={Clock}
                onSelect={() => onPatch({ active: !question.active })}
              >
                {question.active ? "Switch off" : "Switch on"}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={Trash2} destructive onSelect={onRemove}>
                Delete
              </DropdownItem>
            </DropdownMenu>
          </div>
        )}
      </div>

      {summary.kind !== "none" && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={onConfigureRouting}
          className={cn(
            "bg-surface-sunken/70 border-line-subtle mt-3 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left",
            "transition-colors duration-[var(--lr-duration-fast)]",
            canEdit && "hover:bg-surface-sunken cursor-pointer",
            "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
            "disabled:cursor-default",
          )}
        >
          <span
            aria-hidden
            className="bg-surface border-line text-content-muted flex size-7 shrink-0 items-center justify-center rounded-md border"
          >
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="text-content-subtle block text-[11px]">
              {RULE_LABEL[summary.kind]}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {summary.parts.map((part, i) => (
                <React.Fragment key={`${part}-${i}`}>
                  {i > 0 && summary.kind === "routing" && (
                    <span aria-hidden className="bg-line h-3.5 w-px shrink-0" />
                  )}
                  {summary.kind === "options" ? (
                    <span className="bg-surface border-line text-content rounded-md border px-2 py-0.5 text-[12px] whitespace-nowrap">
                      {part}
                    </span>
                  ) : (
                    <span className="text-content text-[12px] whitespace-nowrap">
                      {part}
                    </span>
                  )}
                </React.Fragment>
              ))}
            </span>
          </span>
        </button>
      )}
    </li>
  );
}
