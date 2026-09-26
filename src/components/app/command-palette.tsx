"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarCheck,
  CircleHelp,
  Clock,
  Inbox,
  LayoutGrid,
  Loader2,
  Radar,
  Repeat,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Overlay,
  useBodyScrollLock,
  useEscape,
  useFocusTrap,
} from "@/components/ui/drawer";
import {
  addRecentSearch,
  buildSearchGroups,
  flattenSearchOptions,
  parseRecentSearches,
  RECENT_SEARCHES_KEY,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchCategoryKey,
  type SearchGroup,
  type SearchOption,
  type SearchResponse,
} from "@/lib/search/types";

const DEBOUNCE_MS = 250;
const LISTBOX_ID = "command-palette-results";
const optionId = (index: number) => `command-palette-option-${index}`;

const GROUP_ICON: Record<SearchCategoryKey, React.ComponentType<{ className?: string }>> = {
  pages: LayoutGrid,
  leads: Users,
  bookings: CalendarCheck,
  prospects: Radar,
  conversations: Inbox,
  agents: Bot,
  campaigns: Repeat,
  help: CircleHelp,
};

type Status = "idle" | "loading" | "ok" | "error";

/** A row the arrow keys move through: a result, a "See all", or a recent search. */
type PaletteOption = SearchOption | { kind: "recent"; term: string };

/* Every localStorage access is wrapped: private windows, blocked site data and
 * quota errors all throw, and none of them should break search. */
function readRecent(): string[] {
  try {
    return parseRecentSearches(window.localStorage.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    else window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Not persisted; the in-memory list still works for this session.
  }
}

/**
 * Enterprise command palette (Cmd/Ctrl+K). Open state is owned by the caller
 * (top bar) — the same pattern already used for `NotificationTray` — so there
 * is exactly one instance and one keyboard listener regardless of how many
 * trigger buttons render it.
 *
 * Accessibility: the input is a combobox that owns a listbox; focus never
 * leaves the input, and the highlighted row is announced through
 * `aria-activedescendant`.
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
  const [status, setStatus] = React.useState<Status>("idle");
  const [response, setResponse] = React.useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [attempt, setAttempt] = React.useState(0);

  // `aria-modal` is only honest if Tab cannot leave the panel.
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  useBodyScrollLock(open);
  useEscape(open, onClose);
  useFocusTrap(panelRef, open);

  // Reset to a clean slate every time the palette opens, and focus the input.
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the previous search is a deliberate response to the palette opening.
    setQuery("");
    setResponse(null);
    setStatus("idle");
    setActiveIndex(0);
    setRecent(readRecent());
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const term = query.trim();
  const belowMinLength = term.length < SEARCH_MIN_QUERY_LENGTH;

  // Debounced, cancellable fetch — nothing fires below the minimum length.
  // `attempt` re-runs it for the Retry button.
  React.useEffect(() => {
    if (!open || belowMinLength) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the query dropping below the minimum length is a deliberate reason to stop searching.
      setStatus("idle");
      setResponse(null);
      return;
    }

    setStatus("loading");
    const controller = new AbortController();

    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((res) => {
          if (!res.ok) throw new Error(`search_failed_${res.status}`);
          return res.json() as Promise<SearchResponse>;
        })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setResponse({ ...payload, failed: payload.failed ?? [] });
          setStatus("ok");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResponse(null);
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` gates the effect; re-running on it is not desired.
  }, [term, belowMinLength, attempt]);

  const groups = React.useMemo<SearchGroup[]>(
    () => (response && !belowMinLength ? buildSearchGroups(response.results, term) : []),
    [response, belowMinLength, term],
  );

  const options = React.useMemo<PaletteOption[]>(() => {
    if (belowMinLength) return recent.map((value) => ({ kind: "recent", term: value }));
    return flattenSearchOptions(groups);
  }, [belowMinLength, recent, groups]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the highlighted row is a deliberate response to the option set changing.
    setActiveIndex(0);
  }, [options.length, term]);

  // Keep the highlighted row visible while arrowing through a long list.
  React.useEffect(() => {
    if (!open || options.length === 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, options.length]);

  const remember = React.useCallback(
    (value: string) => {
      const next = addRecentSearch(recent, value);
      setRecent(next);
      writeRecent(next);
    },
    [recent],
  );

  const choose = React.useCallback(
    (option: PaletteOption) => {
      if (option.kind === "recent") {
        setQuery(option.term);
        inputRef.current?.focus();
        return;
      }
      remember(term);
      onClose();
      router.push(option.href);
    },
    [onClose, remember, router, term],
  );

  const clearRecent = React.useCallback(() => {
    setRecent([]);
    writeRecent([]);
    inputRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
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

  const hasOptions = options.length > 0;
  const loading = status === "loading";
  const resultCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const noResults = status === "ok" && !belowMinLength && groups.length === 0;

  let announcement = "";
  if (status === "error") announcement = "Search failed.";
  else if (noResults) announcement = `No results for ${term}.`;
  else if (status === "ok" && !belowMinLength) {
    announcement = `${resultCount} result${resultCount === 1 ? "" : "s"}.`;
  }

  // `index` is the option's position in `options`, which is exactly the order
  // the rows render in, so the highlighted row and aria-activedescendant agree.
  const renderOption = (
    option: PaletteOption,
    index: number,
    content: React.ReactNode,
    key: string,
  ) => {
    const active = index === activeIndex;
    return (
      <li
        key={key}
        id={optionId(index)}
        role="option"
        aria-selected={active}
        // Focus stays in the input (aria-activedescendant); a mouse press must
        // not steal it.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (!active) setActiveIndex(index);
        }}
        onClick={() => choose(option)}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-[var(--lr-duration-fast)]",
          active ? "bg-accent-50 text-content" : "text-content",
        )}
      >
        {content}
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]">
      <Overlay onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className={cn(
          "relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface-raised shadow-xl",
          "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-line-subtle px-4 py-3">
          <Search className="size-4 shrink-0 text-content-subtle" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search pages, leads, prospects, inbox, agents, campaigns and help"
            aria-expanded={hasOptions}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={hasOptions ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            maxLength={SEARCH_MAX_QUERY_LENGTH}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search leads, prospects, inbox, settings…"
            className="h-6 w-full min-w-0 bg-transparent text-[14px] text-content placeholder:text-content-subtle focus:outline-none"
          />
          {loading && (
            <Loader2 className="size-4 shrink-0 animate-spin text-content-subtle" aria-hidden />
          )}
        </div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {/* The listbox is always present so aria-controls never points at nothing. */}
          <ul id={LISTBOX_ID} role="listbox" aria-label="Search results" className="space-y-1">
            {belowMinLength && recent.length > 0 && (
              <li role="presentation">
                <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                  <span
                    id="command-palette-recent-label"
                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-subtle"
                  >
                    <Clock className="size-3.5" aria-hidden />
                    Recent searches
                  </span>
                  <Button
                    variant="link"
                    size="xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearRecent}
                    className="text-[12px]"
                  >
                    Clear
                  </Button>
                </div>
                <ul role="group" aria-labelledby="command-palette-recent-label">
                  {options.map((option, index) =>
                    option.kind === "recent"
                      ? renderOption(
                          option,
                          index,
                          <span className="flex min-w-0 items-center gap-2">
                            <Clock className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
                            <span className="truncate">{option.term}</span>
                          </span>,
                          `recent-${option.term}`,
                        )
                      : null,
                  )}
                </ul>
              </li>
            )}

            {!belowMinLength &&
              (status === "ok" || status === "loading") &&
              groups.map((group) => {
                const Icon = GROUP_ICON[group.key];
                const labelId = `command-palette-group-${group.key}`;
                return (
                  <li key={group.key} role="presentation">
                    <div
                      id={labelId}
                      className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-content-subtle"
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {group.label}
                      {group.total > group.items.length && (
                        <span className="lr-tabular font-normal normal-case text-content-muted">
                          · showing {group.items.length} of {group.total}
                        </span>
                      )}
                    </div>
                    {group.error ? (
                      <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-warning-700">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        Couldn&rsquo;t search {group.label.toLowerCase()} just now.
                      </p>
                    ) : (
                      <ul role="group" aria-labelledby={labelId}>
                        {options.map((option, index) => {
                          if (option.kind === "recent" || option.group !== group.key) return null;
                          if (option.kind === "item") {
                            return renderOption(
                              option,
                              index,
                              <>
                                <span className="min-w-0 truncate font-medium">
                                  {option.item.title}
                                </span>
                                {option.item.subtitle && (
                                  <span className="max-w-[45%] shrink-0 truncate text-[12px] text-content-muted">
                                    {option.item.subtitle}
                                  </span>
                                )}
                              </>,
                              `${group.key}-${option.item.id}`,
                            );
                          }
                          return renderOption(
                            option,
                            index,
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-content-accent">
                              {option.label}
                              <ArrowRight className="size-3.5" aria-hidden />
                            </span>,
                            `${group.key}-see-all`,
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>

          {belowMinLength && recent.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-content-muted">
              Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search pages, leads,
              prospects, your inbox, agents, campaigns and help.
            </p>
          )}

          {!belowMinLength && loading && !response && (
            <div className="space-y-1.5 p-1" aria-hidden>
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-10 animate-pulse rounded-md bg-surface-sunken" />
              ))}
            </div>
          )}

          {!belowMinLength && status === "error" && (
            <div className="flex flex-col items-center gap-3 px-3 py-8 text-center" role="alert">
              <AlertTriangle className="size-5 text-danger-600" aria-hidden />
              <div>
                <p className="text-[13px] font-medium text-content">Search failed</p>
                <p className="mt-0.5 text-[12px] text-content-muted">
                  Something went wrong on our side. Your query is kept — try again.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAttempt((value) => value + 1);
                  inputRef.current?.focus();
                }}
              >
                Retry
              </Button>
            </div>
          )}

          {noResults && (
            <p className="px-3 py-8 text-center text-[13px] text-content-muted">
              No results for &ldquo;{term}&rdquo;.
            </p>
          )}
        </div>

        <div
          className="hidden items-center gap-4 border-t border-line-subtle bg-surface px-4 py-2 text-[11px] text-content-muted sm:flex"
          aria-hidden
        >
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-xs border border-line bg-surface-raised px-1 py-0.5 font-sans text-[10px] font-medium text-content-subtle">
      {children}
    </kbd>
  );
}
