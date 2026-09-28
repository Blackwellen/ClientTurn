"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";
import { friendlyErrorMessage } from "@/lib/errors/friendly";

type Variant = "success" | "error" | "warning" | "info";

const MAX_VISIBLE = 3;

const STYLES: Record<Variant, { wrap: string; icon: string }> = {
  success: { wrap: "border-success-100", icon: "text-success-600" },
  error: { wrap: "border-danger-100", icon: "text-danger-600" },
  warning: { wrap: "border-warning-100", icon: "text-warning-600" },
  info: { wrap: "border-info-100", icon: "text-info-600" },
};

const ICONS: Record<Variant, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export type Toast = {
  id: string;
  variant: Variant;
  title: string;
  description?: string;
  duration: number;
};

export type ToastOptions = {
  variant?: Variant;
  title: string;
  description?: string;
  duration?: number;
};

const ToastCtx = React.createContext<{
  toast: (options: ToastOptions) => void;
  dismiss: (id: string) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/**
 * Screen-reader announcements for toasts.
 *
 * Each card used to carry `role="status"` / `role="alert"` itself, but a live
 * region that is inserted into the DOM together with its text is announced
 * inconsistently (NVDA and VoiceOver routinely drop it) -- live regions must
 * exist before their content changes (SC 4.1.3, a11y audit 2026-09-28). So
 * two regions are mounted once, empty, and the newest toast's text is written
 * into the right one. `n` alternates a trailing no-break space so the same
 * message twice in a row is still a change, and so still announced.
 */
type Announcement = { text: string; n: number };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [polite, setPolite] = React.useState<Announcement>({ text: "", n: 0 });
  const [assertive, setAssertive] = React.useState<Announcement>({ text: "", n: 0 });

  const dismiss = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback((options: ToastOptions) => {
    const variant = options.variant ?? "info";
    // The net under every action error: a toast fed `result.error` from a
    // server action shows a sentence, never a database or network string
    // (src/lib/errors/friendly.ts). Hand-written messages pass unchanged.
    const isProblem = variant === "error" || variant === "warning";
    const next: Toast = {
      id: crypto.randomUUID(),
      variant,
      title: isProblem ? friendlyErrorMessage(options.title, "That did not work") : options.title,
      description:
        isProblem && options.description
          ? friendlyErrorMessage(options.description, "Please try again in a moment.")
          : options.description,
      duration: options.duration ?? 5000,
    };
    setToasts((t) => [...t, next].slice(-MAX_VISIBLE));
    const text = next.description ? `${next.title}. ${next.description}` : next.title;
    const setRegion = variant === "error" ? setAssertive : setPolite;
    setRegion((current) => ({ text, n: current.n + 1 }));
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite.text}
        {polite.n % 2 ? "\u00a0" : ""}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive.text}
        {assertive.n % 2 ? "\u00a0" : ""}
      </div>
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[90] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = React.useState(false);
  const remaining = React.useRef(toast.duration);
  const startedAt = React.useRef(0);
  const Icon = ICONS[toast.variant];

  React.useEffect(() => {
    if (paused || toast.duration <= 0) return;
    startedAt.current = Date.now();
    const id = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.duration, toast.id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface-raised p-3 shadow-lg",
        "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)]",
        STYLES[toast.variant].wrap,
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0 mt-0.5", STYLES[toast.variant].icon)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-content">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[13px] text-content-muted">
            {toast.description}
          </p>
        )}
      </div>
      <IconButton
        size="xs"
        label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}
