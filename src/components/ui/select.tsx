"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { FIELD_BASE, useFieldProps } from "./field";
import { FLOATING_ATTR } from "./floating";
import {
  SEARCH_THRESHOLD,
  filterOptions,
  initialActiveIndex,
  moveActiveIndex,
  resolveListKey,
  typeaheadMatch,
  type ListOption,
} from "./listbox-logic";
import { useFloatingPosition } from "./use-floating";

/**
 * Select and Combobox.
 *
 * `Select` is a drop-in replacement for the native `<select>` it used to be:
 * callers keep writing `<option>` / `<optgroup>` children, `value` +
 * `onChange={(e) => e.target.value}`, `name`, `required`, `disabled`, `ref`.
 * What renders is a styled trigger and a portalled listbox, while a visually
 * hidden native `<select>` carries the value. That mirror is what keeps:
 *
 *   - server actions and FormData working (it has the `name`);
 *   - `required` constraint validation and form reset working;
 *   - `onChange` a genuine React change event — choosing an option sets the
 *     mirror's value and dispatches a bubbling `change`, so `event.target`
 *     is a real HTMLSelectElement and form-level `onChange` still fires;
 *   - `ref.current.focus()` working — the mirror forwards focus to the
 *     trigger.
 *
 * Keyboard and typeahead rules live in ./listbox-logic.ts; placement (flip
 * at viewport edges, clamp to the viewport) in ./floating.ts.
 *
 * `native` keeps the platform control. Nothing in the product uses it today
 * (the custom list works with touch and scales to the phone viewport), but
 * it is the escape hatch for a `multiple` select or children this component
 * cannot read, and is chosen automatically in those cases.
 */

export type SelectOption = ListOption;

type OptionProps = {
  value?: string | number | readonly string[];
  disabled?: boolean;
  label?: string;
  hidden?: boolean;
  children?: React.ReactNode;
};

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

type Parsed = {
  options: ListOption[];
  /** `hidden` options: never listed, but shown when selected (placeholders). */
  hidden: ListOption[];
  parsable: boolean;
};

export function parseSelectChildren(children: React.ReactNode): Parsed {
  const out: Parsed = { options: [], hidden: [], parsable: true };

  function walk(nodes: React.ReactNode, group?: string, groupDisabled?: boolean) {
    React.Children.forEach(nodes, (child) => {
      if (child == null || typeof child === "boolean") return;
      if (!React.isValidElement(child)) {
        // Stray text between options is ignored, as the browser does.
        if (typeof child === "string" && child.trim() === "") return;
        out.parsable = false;
        return;
      }
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children, group, groupDisabled);
        return;
      }
      if (child.type === "optgroup") {
        const props = child.props as { label?: string; disabled?: boolean; children?: React.ReactNode };
        walk(props.children, props.label, props.disabled);
        return;
      }
      if (child.type === "option") {
        const props = child.props as OptionProps;
        const label = props.label ?? textOf(props.children);
        const value = props.value != null ? String(props.value) : label;
        const option: ListOption = {
          value,
          label,
          disabled: Boolean(props.disabled || groupDisabled),
          group,
        };
        (props.hidden ? out.hidden : out.options).push(option);
        return;
      }
      out.parsable = false;
    });
  }

  walk(children);
  return out;
}

const HIDDEN_NATIVE: React.CSSProperties = {
  // Pinned to its containing block's corner. Left at its static position (just
  // after the trigger), a Select inside a horizontally scrolling table placed
  // this 1px box outside the scroller, and it widened the whole page on phones
  // (8.7). Focus is redirected to the visible trigger, so where it sits is
  // otherwise irrelevant.
  position: "absolute",
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
  opacity: 0,
  pointerEvents: "none",
};

function subscribeNothing() {
  return () => {};
}

function useCoarsePointer() {
  return React.useSyncExternalStore(
    subscribeNothing,
    () => {
      try {
        return window.matchMedia("(pointer: coarse)").matches;
      } catch {
        return false;
      }
    },
    () => false,
  );
}

function useTypeahead() {
  const buffer = React.useRef("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    get typing() {
      return buffer.current.length > 0;
    },
    push(char: string) {
      buffer.current += char;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        buffer.current = "";
      }, 600);
      return buffer.current;
    },
  };
}

/**
 * The accessible name for a floating listbox. A `listbox` must be named
 * (axe: aria-input-field-name), and the list is portalled away from the
 * control's <label>, so the name is read off the control when it opens:
 * its aria-label, its aria-labelledby targets, or its associated <label>.
 */
function nameOfControl(
  control: HTMLButtonElement | HTMLInputElement | null,
  ariaLabel?: string,
  ariaLabelledby?: string,
): string | undefined {
  if (ariaLabel) return ariaLabel;
  if (!control) return undefined;
  const text = (el: Element | null | undefined) =>
    el?.textContent?.replace(/\s*\*\s*$/, "").trim() ?? "";
  if (ariaLabelledby) {
    const joined = ariaLabelledby
      .split(/\s+/)
      .map((ref) => text(document.getElementById(ref)))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  return text(control.labels?.[0]) || undefined;
}

/* ------------------------------------------------------------------ list */

function OptionList({
  id,
  options,
  activeIndex,
  selectedValue,
  optionId,
  onChoose,
  onActivate,
  emptyText,
  labelledBy,
  label,
}: {
  id: string;
  options: ListOption[];
  activeIndex: number;
  selectedValue: string | undefined;
  optionId: (index: number) => string;
  onChoose: (index: number) => void;
  onActivate: (index: number) => void;
  emptyText: string;
  labelledBy?: string;
  label?: string;
}) {
  if (options.length === 0) {
    return (
      <p className="px-3 py-5 text-center text-[13px] text-content-muted" role="status">
        {emptyText}
      </p>
    );
  }

  // Consecutive options sharing a group render under one heading.
  const blocks: { group?: string; items: { option: ListOption; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = blocks[blocks.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else blocks.push({ group: option.group, items: [{ option, index }] });
  });

  const renderOption = ({ option, index }: { option: ListOption; index: number }) => {
    const selected = option.value === selectedValue;
    const active = index === activeIndex;
    return (
      <div
        key={`${option.group ?? ""}:${option.value}:${index}`}
        id={optionId(index)}
        role="option"
        aria-selected={selected}
        aria-disabled={option.disabled || undefined}
        onPointerMove={() => {
          if (!option.disabled && !active) onActivate(index);
        }}
        onClick={() => {
          if (!option.disabled) onChoose(index);
        }}
        className={cn(
          "relative flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-[13px] sm:min-h-8",
          "text-content-secondary",
          active && !option.disabled && "bg-surface-hover text-content",
          selected && "font-medium text-content",
          option.disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{option.label || " "}</span>
          {option.description && (
            <span className="block truncate text-[12px] font-normal text-content-muted">
              {option.description}
            </span>
          )}
        </span>
        {selected && (
          <Check
            className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-content-accent"
            aria-hidden
          />
        )}
      </div>
    );
  };

  return (
    <div
      id={id}
      role="listbox"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      // Keep focus on the trigger / search box when an option is pressed.
      onMouseDown={(event) => event.preventDefault()}
    >
      {blocks.map((block, b) =>
        block.group ? (
          <div
            key={`g${b}`}
            role="group"
            aria-labelledby={`${id}-g${b}`}
            className={cn(b > 0 && "mt-1 border-t border-line-subtle pt-1")}
          >
            <div
              id={`${id}-g${b}`}
              role="presentation"
              className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-content-subtle"
            >
              {block.group}
            </div>
            {block.items.map(renderOption)}
          </div>
        ) : (
          <React.Fragment key={`g${b}`}>{block.items.map(renderOption)}</React.Fragment>
        ),
      )}
    </div>
  );
}

const LAYER_CLASS = cn(
  "fixed z-[80] overflow-y-auto overscroll-contain p-1",
  "rounded-lg border border-line bg-surface-raised shadow-lg",
  "animate-[lr-fade-in_var(--lr-duration-fast)_var(--lr-ease)]",
);

/* ---------------------------------------------------------------- Select */

export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /** Show a search box. Defaults to on for lists longer than 12. */
  searchable?: boolean;
  /** Trigger text when no option is selected. */
  placeholder?: string;
  /** Render the platform `<select>` instead (see the note above). */
  native?: boolean;
  /** Data-driven alternative to `<option>` children. */
  options?: SelectOption[];
  /** Called with the chosen value, alongside `onChange`. */
  onValueChange?: (value: string) => void;
  /** Extra classes for the floating list. */
  contentClassName?: string;
  searchPlaceholder?: string;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  props,
  forwardedRef,
) {
  const {
    className,
    style,
    id,
    children,
    options: optionsProp,
    searchable,
    placeholder,
    native,
    onValueChange,
    contentClassName,
    searchPlaceholder = "Search…",
    value,
    defaultValue,
    onChange,
    name,
    required,
    disabled,
    form,
    autoComplete,
    multiple,
    title,
    onBlur,
    onFocus,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
    ...rest
  } = props;
  const a11y = useFieldProps({
    "aria-describedby": props["aria-describedby"],
    "aria-invalid": props["aria-invalid"],
  });
  delete (rest as Record<string, unknown>)["aria-describedby"];
  delete (rest as Record<string, unknown>)["aria-invalid"];

  const parsed = React.useMemo(
    () =>
      optionsProp
        ? { options: optionsProp, hidden: [], parsable: true }
        : parseSelectChildren(children),
    [optionsProp, children],
  );

  const reactId = React.useId();
  const listId = `${reactId}-listbox`;
  const optionId = React.useCallback((i: number) => `${reactId}-opt-${i}`, [reactId]);

  const nativeRef = React.useRef<HTMLSelectElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const floatingRef = React.useRef<HTMLDivElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const setNativeRef = React.useCallback(
    (node: HTMLSelectElement | null) => {
      nativeRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const controlled = value !== undefined;
  const firstEnabled = parsed.options.find((o) => !o.disabled)?.value;
  const [inner, setInner] = React.useState<string | undefined>(() =>
    defaultValue !== undefined ? String(defaultValue) : undefined,
  );
  const current = controlled ? String(value) : (inner ?? firstEnabled);

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [query, setQuery] = React.useState("");
  const [listLabel, setListLabel] = React.useState<string | undefined>(undefined);
  const typeahead = useTypeahead();
  const coarse = useCoarsePointer();

  const isSearchable = searchable ?? parsed.options.length > SEARCH_THRESHOLD;
  const visible = React.useMemo(
    () => (isSearchable ? filterOptions(parsed.options, query) : parsed.options),
    [isSearchable, parsed.options, query],
  );
  const selected =
    parsed.options.find((o) => o.value === current) ??
    parsed.hidden.find((o) => o.value === current);

  const position = useFloatingPosition(open, triggerRef, floatingRef, {
    matchAnchorWidth: true,
    maxHeight: 320,
  });

  // Uncontrolled selects follow a native form reset.
  React.useEffect(() => {
    const formEl = nativeRef.current?.form;
    if (!formEl || controlled) return;
    function onReset() {
      setTimeout(() => setInner(nativeRef.current?.value), 0);
    }
    formEl.addEventListener("reset", onReset);
    return () => formEl.removeEventListener("reset", onReset);
  }, [controlled]);

  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Outside press or focus leaving both the trigger and the layer closes.
  React.useEffect(() => {
    if (!open) return;
    function inside(target: EventTarget | null) {
      const node = target as Node | null;
      return (
        !!node &&
        (triggerRef.current?.contains(node) || floatingRef.current?.contains(node))
      );
    }
    function onPointerDown(event: PointerEvent) {
      if (!inside(event.target)) close(false);
    }
    function onFocusIn(event: FocusEvent) {
      if (!inside(event.target)) close(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, close]);

  // Focus the search box on open (not on touch: it would summon the keyboard
  // over the list the person is trying to read).
  React.useEffect(() => {
    if (open && isSearchable && !coarse) searchRef.current?.focus();
  }, [open, isSearchable, coarse]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active, optionId]);

  function openAt(to: "selected" | "first" | "last") {
    if (disabled) return;
    setQuery("");
    setActive(initialActiveIndex(parsed.options, current, to));
    setListLabel(nameOfControl(triggerRef.current, ariaLabel, ariaLabelledby));
    setOpen(true);
  }

  function commit(next: string) {
    onValueChange?.(next);
    const el = nativeRef.current;
    if (!controlled) setInner(next);
    if (el && el.value !== next) {
      el.value = next;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function choose(index: number, refocus = true) {
    const option = visible[index];
    if (!option || option.disabled) return;
    commit(option.value);
    close(refocus);
  }

  function onKeyDown(event: React.KeyboardEvent, searching: boolean) {
    const action = resolveListKey({
      open,
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      typing: typeahead.typing,
      searching,
    });
    switch (action.type) {
      case "none":
        return;
      case "open":
        event.preventDefault();
        openAt(action.to);
        return;
      case "move":
        event.preventDefault();
        setActive((index) => moveActiveIndex(visible, index, action.to));
        return;
      case "choose":
      case "chooseAndClose":
        event.preventDefault();
        choose(active);
        return;
      case "close":
        event.preventDefault();
        // Stop an enclosing modal/drawer from closing on the same Escape.
        event.nativeEvent.stopImmediatePropagation();
        close();
        return;
      case "tab":
        if (active >= 0) commit(visible[active]?.value ?? current ?? "");
        close(false);
        return;
      case "typeahead": {
        event.preventDefault();
        const buffer = typeahead.push(action.char);
        const base = open ? active : initialActiveIndex(parsed.options, current, "selected");
        const match = typeaheadMatch(parsed.options, buffer, base);
        if (!open) {
          setQuery("");
          setListLabel(nameOfControl(triggerRef.current, ariaLabel, ariaLabelledby));
          setOpen(true);
          setActive(match >= 0 ? match : base);
        } else if (match >= 0) {
          setActive(match);
        }
        return;
      }
    }
  }

  if (native || multiple || !parsed.parsable) {
    return (
      <select
        ref={setNativeRef}
        id={id}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        required={required}
        disabled={disabled}
        form={form}
        autoComplete={autoComplete}
        multiple={multiple}
        title={title}
        onBlur={onBlur}
        onFocus={onFocus}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        className={cn(
          FIELD_BASE,
          !multiple && "h-9 appearance-none bg-no-repeat pl-3 pr-8",
          "text-sm",
          className,
        )}
        style={
          multiple
            ? style
            : {
                backgroundImage: "var(--lr-select-chevron)",
                backgroundPosition: "right 10px center",
                ...style,
              }
        }
        {...a11y}
        {...rest}
      >
        {optionsProp
          ? optionsProp.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    );
  }

  const activeId =
    open && active >= 0 && active < visible.length ? optionId(active) : undefined;
  const theme = position?.theme;

  return (
    <>
      <button
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={isSearchable ? undefined : activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-required={required || undefined}
        {...a11y}
        disabled={disabled}
        title={title ?? selected?.label}
        onBlur={onBlur as React.FocusEventHandler<HTMLButtonElement> | undefined}
        onFocus={onFocus as React.FocusEventHandler<HTMLButtonElement> | undefined}
        onClick={() => (open ? close() : openAt("selected"))}
        onKeyDown={(event) => onKeyDown(event, false)}
        className={cn(
          FIELD_BASE,
          // Not `relative`: callers overlay an icon on the control (the
          // sequence editor's channel glyph) and a positioned trigger would
          // paint over it.
          "inline-flex h-9 items-center gap-1.5 pl-3 pr-2.5 text-left text-sm",
          "cursor-pointer hover:border-[color-mix(in_oklab,var(--lr-border-strong)_60%,var(--lr-text-subtle))]",
          open && "border-[var(--lr-focus-border)] ring-2 ring-[var(--lr-ring)]",
          className,
        )}
        style={style}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            (!selected || parsed.hidden.includes(selected)) && "text-content-subtle",
          )}
        >
          {selected?.label || placeholder || (selected ? " " : "Select…")}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none size-4 shrink-0 text-content-subtle",
            "transition-transform duration-[var(--lr-duration-fast)]",
            open && "rotate-180",
          )}
        />
      </button>

      <select
        ref={setNativeRef}
        aria-hidden
        tabIndex={-1}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        {...(controlled ? { value: current ?? "" } : { defaultValue: current })}
        onChange={onChange ?? (controlled ? () => {} : undefined)}
        // Programmatic focus (a caller's ref, or the browser reporting a
        // `required` failure) lands on the visible control.
        onFocus={() => triggerRef.current?.focus()}
        style={HIDDEN_NATIVE}
      >
        {parsed.hidden.concat(parsed.options).map((o, i) => (
          <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {current !== undefined &&
          !parsed.options.some((o) => o.value === current) &&
          !parsed.hidden.some((o) => o.value === current) && (
            <option value={current} hidden>
              {current}
            </option>
          )}
      </select>

      {open &&
        createPortal(
          <div
            ref={floatingRef}
            {...{ [FLOATING_ATTR]: "" }}
            className={cn(LAYER_CLASS, theme, contentClassName)}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight ?? 320,
              minWidth: position?.anchorWidth,
              maxWidth: "calc(100vw - 16px)",
              visibility: position ? "visible" : "hidden",
            }}
          >
            {isSearchable && (
              <div className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 border-b border-line-subtle bg-surface-raised p-1.5">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-content-subtle"
                  />
                  <input
                    ref={searchRef}
                    type="text"
                    role="combobox"
                    aria-label={searchPlaceholder.replace(/…$/, "")}
                    aria-controls={listId}
                    aria-expanded
                    aria-autocomplete="list"
                    aria-activedescendant={activeId}
                    autoComplete="off"
                    spellCheck={false}
                    value={query}
                    placeholder={searchPlaceholder}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(0);
                    }}
                    onKeyDown={(event) => onKeyDown(event, true)}
                    className={cn(
                      "h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[13px] text-content",
                      "placeholder:text-content-subtle focus:border-[var(--lr-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--lr-ring)]",
                    )}
                  />
                </div>
              </div>
            )}
            <OptionList
              id={listId}
              options={visible}
              activeIndex={active}
              selectedValue={current}
              optionId={optionId}
              onChoose={(index) => choose(index)}
              onActivate={setActive}
              emptyText={query ? `No matches for “${query}”` : "No options"}
              label={listLabel}
            />
          </div>,
          document.body,
        )}
    </>
  );
});

/* -------------------------------------------------------------- Combobox */

export type ComboboxProps = {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Accept text that is not one of the options. */
  allowCustomValue?: boolean;
  emptyText?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * A text input that filters a list as you type — for long, searchable
 * choices (countries, time zones, people) where scanning is slower than
 * typing. The value submitted with a form is the chosen option's value (a
 * hidden input), not the visible label.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  id,
  name,
  placeholder,
  disabled,
  required,
  allowCustomValue = false,
  emptyText = "No matches",
  className,
  ...aria
}: ComboboxProps) {
  const a11y = useFieldProps({
    "aria-describedby": aria["aria-describedby"],
    "aria-invalid": aria["aria-invalid"],
  });
  const reactId = React.useId();
  const listId = `${reactId}-listbox`;
  const optionId = React.useCallback((i: number) => `${reactId}-opt-${i}`, [reactId]);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const floatingRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value);
  const labelFor = React.useCallback(
    (v: string) => options.find((o) => o.value === v)?.label ?? (allowCustomValue ? v : ""),
    [options, allowCustomValue],
  );
  const [text, setText] = React.useState(() => labelFor(value));
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [dirty, setDirty] = React.useState(false);
  const [listLabel, setListLabel] = React.useState<string | undefined>(undefined);
  // The list only exists while open, so its name is read as it opens.
  function openList() {
    setListLabel(nameOfControl(inputRef.current, aria["aria-label"]));
    setOpen(true);
  }

  // An external value change resets the visible text (adjusting state during
  // render, React's pattern for deriving from a changed prop).
  const [seenValue, setSeenValue] = React.useState(value);
  if (seenValue !== value && !open) {
    setSeenValue(value);
    setText(labelFor(value));
  }

  const visible = React.useMemo(
    () => (dirty ? filterOptions(options, text) : options),
    [dirty, options, text],
  );
  const position = useFloatingPosition(open, inputRef, floatingRef, {
    matchAnchorWidth: true,
    maxHeight: 300,
  });

  const settle = React.useCallback(() => {
    setOpen(false);
    setDirty(false);
    if (allowCustomValue && text !== labelFor(value)) {
      const match = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
      onValueChange(match ? match.value : text.trim());
    } else {
      setText(labelFor(value));
    }
  }, [allowCustomValue, text, labelFor, value, options, onValueChange]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node;
      if (!inputRef.current?.contains(node) && !floatingRef.current?.contains(node)) settle();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, settle]);

  React.useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active, optionId]);

  function choose(index: number) {
    const option = visible[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setText(option.label);
    setOpen(false);
    setDirty(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const action = resolveListKey({
      open,
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      searching: true,
    });
    switch (action.type) {
      case "open":
        if (event.key === " ") return; // typing a space
        event.preventDefault();
        openList();
        setActive(initialActiveIndex(visible, value, action.to));
        return;
      case "move":
        event.preventDefault();
        setActive((i) => moveActiveIndex(visible, i, action.to));
        return;
      case "choose":
      case "chooseAndClose":
        if (active >= 0) {
          event.preventDefault();
          choose(active);
        } else if (allowCustomValue) {
          event.preventDefault();
          settle();
        }
        return;
      case "close":
        event.preventDefault();
        event.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        setDirty(false);
        setText(labelFor(value));
        return;
      case "tab":
        settle();
        return;
      default:
        return;
    }
  }

  const theme = position?.theme;
  const activeId =
    open && active >= 0 && active < visible.length ? optionId(active) : undefined;

  return (
    <div className={cn("relative w-full", className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={aria["aria-label"]}
        aria-required={required || undefined}
        {...a11y}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
          openList();
          setActive(0);
        }}
        onClick={() => {
          if (!open) {
            openList();
            setActive(initialActiveIndex(options, value, "selected"));
          }
        }}
        onBlur={(event) => {
          if (!floatingRef.current?.contains(event.relatedTarget as Node)) {
            if (open) settle();
          }
        }}
        onKeyDown={onKeyDown}
        className={cn(FIELD_BASE, "h-9 pl-3 pr-14 text-sm")}
      />
      {text && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          onClick={() => {
            setText("");
            setDirty(true);
            if (allowCustomValue) onValueChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-7 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-content-subtle hover:text-content"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-content-subtle transition-transform",
          open && "rotate-180",
        )}
      />
      {name && <input type="hidden" name={name} value={selected || allowCustomValue ? value : ""} />}
      {open &&
        createPortal(
          <div
            ref={floatingRef}
            {...{ [FLOATING_ATTR]: "" }}
            className={cn(LAYER_CLASS, theme)}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight ?? 300,
              minWidth: position?.anchorWidth,
              maxWidth: "calc(100vw - 16px)",
              visibility: position ? "visible" : "hidden",
            }}
          >
            <OptionList
              id={listId}
              options={visible}
              activeIndex={active}
              selectedValue={value}
              optionId={optionId}
              onChoose={choose}
              onActivate={setActive}
              emptyText={allowCustomValue && text ? `Press Enter to use “${text}”` : emptyText}
              label={listLabel}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
