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

type Variant = "success" | "error" | "warning" | "info";

const MAX_VISIBLE = 3;

const STYLES: Record<Variant, { wrap: string; icon: string }> = {
  success: { wrap: "border-success-100", icon: "text-success-600" },
  error: { wrap: "border-danger-100", icon: "text-danger-600" },
  warning: { wrap: "border-warning-100", icon: "text-warning-600" },
  info: { wrap: "border-info-100", icon: "text-info-600" },
};

const ICONS: Record<Variant, React.ComponentType<{ className?: string }>> = {
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = React.useCallback((options: ToastOptions) => {
    const next: Toast = {
      id: crypto.randomUUID(),
      variant: options.variant ?? "info",
      title: options.title,
      description: options.description,
      duration: options.duration ?? 5000,
    };
    setToasts((t) => [...t, next].slice(-MAX_VISIBLE));
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
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
      role={toast.variant === "error" ? "alert" : "status"}
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
