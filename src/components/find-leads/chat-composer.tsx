"use client";

import * as React from "react";
import { Paperclip, Plus, Send, Sparkles } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The chat composer, shared by Discover and a search session.
 *
 * One component so the two surfaces cannot drift: the same character limit,
 * the same Enter-to-send behaviour, the same disabled reasoning. The run page
 * reuses it in a read-only state, which is why `disabled` carries a sentence
 * rather than just switching the control off — a dead input with no
 * explanation reads as a bug.
 */

export const COMPOSER_MAX = 500;

export function ChatComposer({
  onSend,
  placeholder,
  disabled = false,
  disabledReason,
  pending = false,
  autoFocus = false,
  className,
}: {
  onSend: (message: string) => void;
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !disabled && !pending;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line — the convention every chat
    // interface the customer already uses follows.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "relative rounded-xl border bg-surface transition-colors",
          disabled ? "border-line bg-surface-sunken/50" : "border-line focus-within:border-accent-300",
        )}
      >
        <label htmlFor="chat-composer" className="sr-only">
          {placeholder}
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          rows={3}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={COMPOSER_MAX}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? (disabledReason ?? placeholder) : placeholder}
          aria-describedby="chat-composer-count"
          className={cn(
            "w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-16",
            "text-[13.5px] leading-relaxed text-content placeholder:text-content-subtle",
            "focus:outline-none disabled:cursor-not-allowed",
          )}
        />
        <span
          id="chat-composer-count"
          className="pointer-events-none absolute right-3 top-3 text-[11.5px] tabular-nums text-content-subtle"
        >
          {value.length}/{COMPOSER_MAX}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            variant="secondary"
            size="sm"
            label="Add an attachment"
            disabled={disabled}
            type="button"
          >
            <Plus className="size-4" aria-hidden />
          </IconButton>
          <Button variant="secondary" size="sm" disabled={disabled} type="button">
            <Paperclip className="size-3.5" aria-hidden />
            Add context
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {/* The model is a product decision, not a customer setting. The chip
              names the assistant rather than a vendor deployment — §90 keeps
              the model layer invisible to customers. */}
          <span className="hidden items-center gap-1.5 rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-[12px] font-medium text-content-secondary sm:inline-flex">
            <Sparkles className="size-3.5 text-content-accent" aria-hidden />
            ClientTurn AI
          </span>
          <Button size="sm" onClick={submit} disabled={!canSend} loading={pending} type="button">
            <Send className="size-3.5" aria-hidden />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
