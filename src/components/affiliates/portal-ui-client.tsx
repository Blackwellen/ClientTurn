"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";

/**
 * The interactive half of the partner portal kit (portal-ui.tsx): the range
 * picker and the copy button, the only pieces that need state, the router or
 * a toast. Split out so portal-ui.tsx can stay a server module — as one
 * "use client" file, every server page that passed an icon component to
 * KpiCard / Panel failed with "Functions cannot be passed directly to Client
 * Components" (wave 5 QA, 2026-09-30).
 */

const RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
] as const;

/**
 * The date range control.
 *
 * A link group rather than client state: the range belongs in the URL so a
 * partner can bookmark or share "my last 90 days", and so the server renders
 * the right numbers on first paint instead of flashing the default.
 *
 * "Custom" opens a real two-date picker. It submits by navigation for the same
 * reason — the chosen window has to reach the server to be queried, and the
 * server re-parses and clamps it rather than trusting the query string.
 */
export function RangeTabs({
  basePath,
  current,
  extraParams,
  customFrom,
  customTo,
}: {
  basePath: string;
  current: string;
  extraParams?: Record<string, string | undefined>;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(customFrom ?? "");
  const [to, setTo] = React.useState(customTo ?? "");
  const panelRef = React.useRef<HTMLDivElement>(null);

  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function paramsWith(entries: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(entries)) {
      if (value) params.set(key, value);
    }
    return params;
  }

  function href(range: string) {
    return `${basePath}?${paramsWith({ range }).toString()}`;
  }

  function applyCustom() {
    if (!from || !to) return;
    setOpen(false);
    router.push(
      `${basePath}?${paramsWith({ range: "custom", from, to }).toString()}`,
    );
  }

  const customActive = current === "custom";

  return (
    <div
      role="group"
      aria-label="Date range"
      className="relative inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[10px] border border-line bg-surface p-1 shadow-xs"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = current === option.key;
        return (
          <Link
            key={option.key}
            href={href(option.key)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-surface text-content shadow-xs ring-1 ring-line"
                : "text-content-muted hover:bg-surface-hover hover:text-content",
            )}
          >
            {option.label}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors",
          customActive
            ? "bg-surface text-content shadow-xs ring-1 ring-line"
            : "text-content-muted hover:bg-surface-hover hover:text-content",
        )}
      >
        <CalendarDays className="size-3.5" aria-hidden />
        Custom
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Choose a custom date range"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[268px] rounded-[12px] border border-line bg-surface-raised p-3.5 shadow-lg"
        >
          <div className="space-y-2.5">
            <div>
              <label
                htmlFor="range-from"
                className="text-[12px] font-medium text-content-secondary"
              >
                From
              </label>
              <input
                id="range-from"
                type="date"
                value={from}
                max={to || today}
                onChange={(event) => setFrom(event.target.value)}
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-content"
              />
            </div>
            <div>
              <label
                htmlFor="range-to"
                className="text-[12px] font-medium text-content-secondary"
              >
                To
              </label>
              <input
                id="range-to"
                type="date"
                value={to}
                min={from || undefined}
                max={today}
                onChange={(event) => setTo(event.target.value)}
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-content"
              />
            </div>
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-content-muted">
            Both dates are included. Ranges longer than a year are shortened.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={applyCustom}
              disabled={!from || !to}
              className="h-9 flex-1 rounded-[8px] bg-accent-500 text-[13px] font-semibold text-brand-midnight disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-[8px] border border-line px-3 text-[13px] font-medium text-content"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ copy button -- */

/**
 * Copies a value and confirms it.
 *
 * The confirmation is both a toast and an inline tick, and the button's
 * accessible name changes to "Copied" — a colour-only or icon-only
 * confirmation is invisible to a screen reader, and copying is exactly the
 * action where you need to know it worked.
 */
export function CopyButton({
  value,
  label = "Copy",
  variant = "ghost",
  className,
}: {
  value: string;
  label?: string;
  variant?: "ghost" | "solid";
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ variant: "success", title: "Link copied" });
    } catch {
      toast({
        variant: "error",
        title: "Could not copy",
        description: "Select the text and copy it manually.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? `Copied ${label}` : `${label}: ${value}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
        variant === "solid"
          ? "border border-line bg-surface text-content hover:bg-surface-hover"
          : "border border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-success-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
