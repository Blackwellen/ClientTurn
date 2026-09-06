"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Loader2, Radio, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { runAdminSearch } from "@/lib/admin/actions";
import type { AdminSearchResult } from "@/lib/admin/types";

const KIND_ICON = {
  customer: Building2,
  event: Radio,
  error: AlertTriangle,
} as const;

/**
 * Platform-wide search. Every query is executed by a server action behind
 * `requirePlatformAdmin()` — the browser never queries across tenants itself.
 */
export function AdminSearch() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<AdminSearchResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  React.useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Debounced so typing does not fire a server action per keystroke. Every
  // state update happens inside the timer callback rather than in the effect
  // body, so a keystroke never triggers a cascading render.
  React.useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (trimmed.length < 2) {
        setResults([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const response = await runAdminSearch(trimmed);
      if (cancelled) return;
      setLoading(false);
      if (response.ok) {
        setResults(response.results);
        setError(response.results.length === 0 ? "No matches found." : null);
      } else {
        setResults([]);
        setError(response.error);
      }
      setActive(0);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function go(result: AdminSearchResult) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  }

  const listId = React.useId();

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 lg:max-w-[690px]">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search customers, leads, jobs and settings
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-content-subtle"
        aria-hidden
      />
      <input
        id={`${listId}-input`}
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder="Search customers, leads, jobs, settings..."
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-11 w-full rounded-[11px] border border-line-strong bg-surface pr-16 pl-10",
          "text-[14px] text-content shadow-xs placeholder:text-content-subtle",
          "focus:border-accent-500 focus:ring-2 focus:ring-[var(--lr-ring)] focus:outline-none",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-line bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-content-subtle"
      >
        ⌘K
      </kbd>

      {open && query.trim().length >= 2 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          {loading ? (
            <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-content-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-content-muted">
              {error ?? "No matches found."}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((result, index) => {
                const Icon = KIND_ICON[result.kind];
                return (
                  <li key={`${result.kind}-${result.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(result)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-4 py-2 text-left",
                        index === active ? "bg-surface-hover" : "hover:bg-surface-hover",
                      )}
                    >
                      <Icon
                        className="mt-0.5 size-3.5 shrink-0 text-content-subtle"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-content">
                          {result.title}
                        </span>
                        <span className="block truncate text-[11.5px] text-content-subtle">
                          {result.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
