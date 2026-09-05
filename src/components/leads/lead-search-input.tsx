"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Search box for the leads toolbar.
 *
 * The applied term lives in the URL, but the box cannot simply be controlled
 * by it: the round trip is debounced, so a controlled input would lag the
 * caret. Nor can it be fully uncontrolled — "Clear all" has to empty it.
 *
 * So it owns its text while focused, and re-syncs from the URL only when it
 * is not: typing is never interrupted, and an external clear still lands.
 */
export function LeadSearchInput({
  value,
  onChange,
  debounceMs = 300,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  className?: string;
}) {
  const [text, setText] = React.useState(value);
  // Focus is state, not a ref: the re-sync decision below happens during
  // render, and refs must not be read there.
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Adjusting state during render (rather than in an effect) is React's
  // recommended way to react to a changed prop without an extra pass.
  const [trackedValue, setTrackedValue] = React.useState(value);
  if (value !== trackedValue) {
    setTrackedValue(value);
    if (!focused) setText(value);
  }

  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Only the user's own edits are debounced back out; a re-sync from the URL
  // must not echo the same term straight back into the router.
  const emitted = React.useRef(value);
  React.useEffect(() => {
    if (text === emitted.current) return;
    const id = setTimeout(() => {
      emitted.current = text;
      onChangeRef.current(text);
    }, debounceMs);
    return () => clearTimeout(id);
  }, [text, debounceMs]);

  const clear = () => {
    setText("");
    emitted.current = "";
    onChangeRef.current("");
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
      />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label="Search leads"
        placeholder="Search leads by name, phone, email or service..."
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => setText(event.target.value)}
        className={cn(
          "h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-8 text-[13px]",
          "text-content shadow-xs placeholder:text-content-subtle",
          "transition-colors duration-[var(--lr-duration-fast)]",
          "focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-[var(--lr-ring)]",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-content-subtle transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
