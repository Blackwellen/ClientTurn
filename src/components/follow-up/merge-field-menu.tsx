"use client";

import * as React from "react";
import { DropdownItem, DropdownLabel, DropdownMenu } from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";
import { MERGE_FIELD_OPTIONS } from "@/lib/follow-up/types";

/**
 * The `{ }` button beside every message field.
 *
 * Inserting at the caret rather than appending is the whole point: a merge
 * field is nearly always wanted mid-sentence. The caller passes the textarea
 * so the caret position is real, and the caret is restored just after the
 * inserted token so typing continues where the user was.
 */
export function MergeFieldMenu({
  targetRef,
  value,
  onInsert,
  disabled,
  label = "Insert a merge field",
  className,
}: {
  targetRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onInsert: (next: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  function insert(token: string) {
    const element = targetRef.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onInsert(value.slice(0, start) + token + value.slice(end));

    // The value lands on the next render, so move the caret after it.
    requestAnimationFrame(() => {
      const node = targetRef.current;
      if (!node) return;
      node.focus();
      const caret = start + token.length;
      node.setSelectionRange(caret, caret);
    });
  }

  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          className={cn(
            "border-line-strong bg-surface text-content-secondary shadow-xs",
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
            "font-mono text-[13px] leading-none",
            "transition-colors duration-[var(--lr-duration-fast)]",
            "hover:bg-surface-hover hover:text-content",
            "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
        >
          {"{}"}
        </button>
      }
    >
      <DropdownLabel>Insert a merge field</DropdownLabel>
      {MERGE_FIELD_OPTIONS.map((field) => (
        <DropdownItem key={field.token} onSelect={() => insert(field.token)}>
          <span className="flex min-w-0 flex-col">
            <span className="text-content font-mono text-[12px]">{field.token}</span>
            <span className="text-content-subtle text-[11px]">{field.hint}</span>
          </span>
        </DropdownItem>
      ))}
    </DropdownMenu>
  );
}
