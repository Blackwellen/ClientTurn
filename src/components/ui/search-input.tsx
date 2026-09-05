"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function SearchInput({
  defaultValue = "",
  onChange,
  placeholder = "Search",
  label = "Search",
  debounceMs = 300,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "defaultValue"> & {
  defaultValue?: string;
  onChange: (value: string) => void;
  label?: string;
  debounceMs?: number;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Kept in a ref so an inline `onChange` lambda does not restart the timer.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  const emit = React.useRef(defaultValue);
  React.useEffect(() => {
    if (value === emit.current) return;
    const id = setTimeout(() => {
      emit.current = value;
      onChangeRef.current(value);
    }, debounceMs);
    return () => clearTimeout(id);
  }, [value, debounceMs]);

  function clear() {
    setValue("");
    emit.current = "";
    onChangeRef.current("");
    inputRef.current?.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn(
          "h-9 w-full bg-surface text-content placeholder:text-content-subtle",
          "border border-line-strong rounded-md shadow-xs",
          "pl-9 pr-8 text-sm",
          "transition-colors duration-[var(--lr-duration-fast)]",
          "focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-[var(--lr-ring)]",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5",
            "text-content-subtle hover:text-content",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
