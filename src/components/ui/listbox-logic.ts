/**
 * Keyboard and filtering rules for the Select / Combobox primitives.
 *
 * Pure (no React, no DOM) so the interaction contract is unit tested in
 * tests/ui-primitives.test.ts rather than only click-tested. It follows the
 * WAI-ARIA APG "select-only combobox" pattern:
 *
 *   closed  ArrowDown / ArrowUp / Enter / Space / Alt+ArrowDown  open
 *           Home / End                                           open at first / last
 *           printable character                                  open at the typeahead match
 *   open    ArrowDown / ArrowUp          move (no wrap, disabled skipped)
 *           Home / End                   first / last enabled
 *           PageDown / PageUp            ±10
 *           Enter / Space (not typing)   choose the active option
 *           Escape                       close, keep value
 *           Tab                          choose the active option and move on
 *           Alt+ArrowUp                  choose and close
 *           printable character          typeahead
 */

export type ListOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optgroup label, when the option belongs to one. */
  group?: string;
  /** Secondary line under the label. */
  description?: string;
};

export type ListKeyAction =
  | { type: "open"; to: "selected" | "first" | "last" }
  | { type: "move"; to: "next" | "prev" | "first" | "last" | "pageDown" | "pageUp" }
  | { type: "choose" }
  | { type: "chooseAndClose" }
  | { type: "close" }
  | { type: "tab" }
  | { type: "typeahead"; char: string }
  | { type: "none" };

export const PAGE_STEP = 10;

export function isPrintableKey(key: string): boolean {
  return key.length === 1 && key !== " ";
}

export function resolveListKey({
  open,
  key,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  /** A typeahead buffer is active, so Space extends it instead of choosing. */
  typing = false,
  /** Focus is in a search box, so Home/End/Space/characters edit the text. */
  searching = false,
}: {
  open: boolean;
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  typing?: boolean;
  searching?: boolean;
}): ListKeyAction {
  if (ctrlKey || metaKey) return { type: "none" };

  if (!open) {
    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        return { type: "open", to: "selected" };
      case "Home":
        return { type: "open", to: "first" };
      case "End":
        return { type: "open", to: "last" };
      default:
        if (!searching && isPrintableKey(key)) return { type: "typeahead", char: key };
        return { type: "none" };
    }
  }

  switch (key) {
    case "ArrowDown":
      return { type: "move", to: "next" };
    case "ArrowUp":
      return altKey ? { type: "chooseAndClose" } : { type: "move", to: "prev" };
    case "Home":
      return searching ? { type: "none" } : { type: "move", to: "first" };
    case "End":
      return searching ? { type: "none" } : { type: "move", to: "last" };
    case "PageDown":
      return { type: "move", to: "pageDown" };
    case "PageUp":
      return { type: "move", to: "pageUp" };
    case "Enter":
      return { type: "choose" };
    case " ":
      if (searching) return { type: "none" };
      return typing ? { type: "typeahead", char: " " } : { type: "choose" };
    case "Escape":
      return { type: "close" };
    case "Tab":
      return { type: "tab" };
    default:
      if (!searching && isPrintableKey(key)) return { type: "typeahead", char: key };
      return { type: "none" };
  }
}

function firstEnabled(options: readonly ListOption[]): number {
  return options.findIndex((o) => !o.disabled);
}

function lastEnabled(options: readonly ListOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) if (!options[i].disabled) return i;
  return -1;
}

/**
 * The next active index for a move. Never wraps (the APG listbox pattern),
 * never lands on a disabled option, and returns -1 only when nothing is
 * enabled.
 */
export function moveActiveIndex(
  options: readonly ListOption[],
  current: number,
  to: "next" | "prev" | "first" | "last" | "pageDown" | "pageUp",
): number {
  if (options.length === 0) return -1;
  if (to === "first") return firstEnabled(options);
  if (to === "last") return lastEnabled(options);

  if (current < 0 || current >= options.length) {
    return to === "prev" || to === "pageUp" ? lastEnabled(options) : firstEnabled(options);
  }

  const forward = to === "next" || to === "pageDown";
  const step = to === "pageDown" || to === "pageUp" ? PAGE_STEP : 1;
  const target = forward
    ? Math.min(options.length - 1, current + step)
    : Math.max(0, current - step);

  // Walk from the target in the direction of travel to an enabled option,
  // then back towards the start if the far end is all disabled.
  const dir = forward ? 1 : -1;
  for (let i = target; i >= 0 && i < options.length; i += dir) {
    if (!options[i].disabled) return i;
  }
  for (let i = target - dir; i >= 0 && i < options.length; i -= dir) {
    if (!options[i].disabled) return i;
  }
  return current;
}

/**
 * Typeahead: the next enabled option whose label starts with `buffer`.
 *
 * A buffer of one repeated character ("bbb") cycles through the options
 * starting with that character, the way a native select behaves; any other
 * buffer searches from the current option inclusive so typing "bri" stays on
 * "Bristol" once it has reached it.
 */
export function typeaheadMatch(
  options: readonly ListOption[],
  buffer: string,
  current: number,
): number {
  if (!buffer || options.length === 0) return -1;
  const lower = normalise(buffer);
  const repeated = lower.length > 1 && lower.split("").every((c) => c === lower[0]);
  const needle = repeated ? lower[0] : lower;
  const cycle = repeated || lower.length === 1;
  const start = current < 0 ? 0 : cycle ? current + 1 : current;

  for (let n = 0; n < options.length; n += 1) {
    const i = (start + n) % options.length;
    const option = options[i];
    if (!option.disabled && normalise(option.label).startsWith(needle)) return i;
  }
  return -1;
}

/** Case- and accent-insensitive "contains" filter for searchable lists. */
export function filterOptions<T extends ListOption>(
  options: readonly T[],
  query: string,
): T[] {
  const q = normalise(query.trim());
  if (!q) return options.slice();
  return options.filter((o) => {
    const hay = normalise(`${o.label} ${o.description ?? ""} ${o.group ?? ""}`);
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}

export function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Index to activate when the list opens. */
export function initialActiveIndex(
  options: readonly ListOption[],
  selectedValue: string | undefined,
  to: "selected" | "first" | "last",
): number {
  if (to === "first") return firstEnabled(options);
  if (to === "last") return lastEnabled(options);
  const selected = options.findIndex((o) => o.value === selectedValue && !o.disabled);
  return selected >= 0 ? selected : firstEnabled(options);
}

/** Lists this long get a search box by default. */
export const SEARCH_THRESHOLD = 12;
