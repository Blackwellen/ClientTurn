"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, Repeat, Search, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Overlay, useBodyScrollLock, useEscape } from "@/components/ui/drawer";
import {
  SEARCH_CATEGORY_KEYS,
  SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchResult,
  type SearchCategoryKey,
  type SearchResultItem,
} from "@/lib/search/types";

type SearchResponse = { query: string; results: GlobalSearchResult };

const DEBOUNCE_MS = 250;

const CATEGORY_META: Record<
  SearchCategoryKey,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  leads: { label: "Leads", icon: Users },
  bookings: { label: "Bookings", icon: CalendarCheck },
  campaigns: { label: "Reactivation campaigns", icon: Repeat },
};

/**
 * Enterprise command palette (Cmd/Ctrl+K). Open state is owned by the caller
 * (top bar) — the same pattern already used for `NotificationTray` — so there
 * is exactly one instance and one keyboard listener regardless of how many
 * trigger buttons render it.
 */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [errored, setErrored] = React.useState(false);
  const [data, setData] = React.useState<GlobalSearchResult | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  useBodyScrollLock(open);
  useEscape(open, onClose);

  // Reset to a clean slate every time the palette opens, and focus the input.
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the previous search is a deliberate response to the palette opening.
    setQuery("");
    setData(null);
    setErrored(false);
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const term = query.trim();
  const belowMinLength = term.length < SEARCH_MIN_QUERY_LENGTH;

  // Debounced, cancellable fetch — nothing fires below the minimum length.
  React.useEffect(() => {
    if (!open || belowMinLength) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the query dropping below the minimum length is a deliberate reason to stop showing a spinner.
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrored(false);
    const controller = new AbortController();

    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("search_failed");
          return response.json() as Promise<SearchResponse>;
        })
        .then((payload) => {
          setData(payload.results);
          setErrored(false);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setErrored(true);
          setData(null);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` gates the effect; re-running on it is not desired.
  }, [term, belowMinLength]);

  const flat = React.useMemo<SearchResultItem[]>(() => {
    if (!data) return [];
    return SEARCH_CATEGORY_KEYS.flatMap((key) => data[key].items);
  }, [data]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the highlighted row is a deliberate response to the result set changing.
    setActiveIndex(0);
  }, [flat.length, term]);

  const select = React.useCallback(
    (item: SearchResultItem) => {
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[activeIndex];
      if (item) select(item);
    }
  }

  // Portalled for the same reason the Drawer is: the palette is mounted inside
  // the top bar, which is `sticky z-30 backdrop-blur-md` and therefore both a
  // stacking context and the containing block for fixed descendants. Rendered
  // in place, `fixed inset-0 z-50` means neither of those things.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!open || !mounted) return null;

  const hasResults = flat.length > 0;
  const categories = data
    ? SEARCH_CATEGORY_KEYS.filter((key) => data[key].items.length > 0)
    : [];

  let runningIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]">
      <Overlay onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className={cn(
          "relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl",
          "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-line-subtle px-4 py-3">
          <Search className="size-4 shrink-0 text-content-subtle" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={hasResults}
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search leads, bookings, campaigns…"
            className="h-6 w-full min-w-0 bg-transparent text-[14px] text-content placeholder:text-content-subtle focus:outline-none"
          />
          {loading && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-content-subtle"
              aria-hidden
            />
          )}
          <kbd className="hidden shrink-0 items-center rounded-xs border border-line px-1.5 py-0.5 text-[11px] font-medium text-content-subtle sm:inline-flex">
            Esc
          </kbd>
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[60vh] overflow-y-auto p-2"
        >
          {belowMinLength && (
            <p className="px-3 py-8 text-center text-[13px] text-content-subtle">
              Keep typing to search leads, bookings and campaigns.
            </p>
          )}

          {!belowMinLength && loading && !data && (
            <div className="space-y-1.5 p-1" aria-hidden>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="h-10 animate-pulse rounded-md bg-surface-sunken"
                />
              ))}
            </div>
          )}

          {!belowMinLength && !loading && errored && (
            <p className="px-3 py-8 text-center text-[13px] text-content-subtle">
              Search is unavailable right now. Try again in a moment.
            </p>
          )}

          {!belowMinLength && !loading && !errored && data && !hasResults && (
            <p className="px-3 py-8 text-center text-[13px] text-content-subtle">
              No matches for &ldquo;{term}&rdquo;.
            </p>
          )}

          {!belowMinLength &&
            !errored &&
            categories.map((key) => {
              const meta = CATEGORY_META[key];
              const category = data![key];
              return (
                <div key={key} className="mb-1 last:mb-0">
                  <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                    <meta.icon className="size-3.5" aria-hidden />
                    {meta.label}
                    {category.total > category.items.length && (
                      <span className="lr-tabular font-normal normal-case text-content-subtle/80">
                        · showing {category.items.length} of {category.total}
                      </span>
                    )}
                  </div>
                  {category.items.map((item) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    const active = index === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => select(item)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-[var(--lr-duration-fast)]",
                          active
                            ? "bg-accent-50 text-content"
                            : "text-content hover:bg-surface-hover",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="shrink-0 truncate text-[12px] text-content-subtle">
                            {item.subtitle}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
