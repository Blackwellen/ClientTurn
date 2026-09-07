"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useBodyScrollLock,
  useEscape,
  useFocusTrap,
} from "@/components/ui/drawer";

export type SearchEntry = {
  label: string;
  caption: string;
  href: string;
  group: string;
};

/**
 * Portal-wide search (V4 §33).
 *
 * Searches an index the server built from **this partner's own** links,
 * referrals and the published resource library — nothing else is in it, so
 * there is no query that could reach another affiliate's data or a customer
 * record. The index is small (a partner has tens of links, not millions), so
 * filtering happens in the browser and there is no search endpoint to secure.
 */
export function AffiliateSearch({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: SearchEntry[];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // `aria-modal` is only honest if Tab cannot leave the panel.
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  useBodyScrollLock(open);
  useEscape(open, onClose);
  useFocusTrap(panelRef, open);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the query when the dialog opens is a deliberate response to it opening.
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  const results = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? entries.filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) ||
            entry.caption.toLowerCase().includes(needle) ||
            entry.group.toLowerCase().includes(needle),
        )
      : entries;
    return pool.slice(0, 12);
  }, [entries, query]);

  if (!open) return null;

  function go(entry: SearchEntry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-[var(--lr-overlay)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search the affiliate portal"
        className="absolute left-1/2 top-[12vh] w-[min(92vw,620px)] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
          <Search className="size-4 shrink-0 text-content-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                go(results[active]);
              }
            }}
            placeholder="Search links, referrals, resources…"
            aria-label="Search links, referrals and resources"
            aria-controls="affiliate-search-results"
            aria-activedescendant={
              active >= 0 ? `affiliate-search-option-${active}` : undefined
            }
            className="h-12 w-full bg-transparent text-[14px] text-content outline-none placeholder:text-content-subtle"
          />
        </div>

        <ul
          id="affiliate-search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[52vh] overflow-y-auto py-1.5"
        >
          {results.length === 0 && (
            <li className="px-4 py-8 text-center text-[13px] text-content-muted">
              Nothing matches “{query}”.
            </li>
          )}
          {results.map((entry, index) => (
            <li key={`${entry.href}:${entry.label}`} role="none">
              <button
                type="button"
                id={`affiliate-search-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(entry)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                  index === active ? "bg-surface-sunken" : "hover:bg-surface-hover",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-content">
                    {entry.label}
                  </p>
                  <p className="truncate text-[12px] text-content-muted">
                    {entry.caption}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-content-muted">
                  {entry.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
