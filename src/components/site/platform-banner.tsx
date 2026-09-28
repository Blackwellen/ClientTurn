"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { BANNER_TONE, type BadgeTone } from "@/components/ui/badge";
import { bannerDismissStorageKey } from "@/lib/banners/select";
import type { BannerTone } from "@/lib/banners/types";

/**
 * One platform banner: an admin announcement or the automatic maintenance
 * notice (docs/MAINTENANCE.md).
 *
 * Accessibility: `role="status"` with polite live-region semantics, so a
 * screen reader announces it without interrupting; the dismiss control is a
 * real button with a name, reachable by Tab, and Escape inside the banner
 * dismisses it too. Contrast is the tokens' AA pairs (the 700 shade on the 50
 * surface). No layout shift on load: banners are server-rendered, and a
 * website visitor's earlier dismissal is applied by an inline script before
 * first paint. Leaving animates opacity and transform only, and not at all
 * under prefers-reduced-motion.
 *
 * Colour comes from the one badge mapping (`BANNER_TONE` in ui/badge.tsx).
 */

const SURFACE: Record<Exclude<BadgeTone, "neutral" | "accent" | "purple">, {
  box: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
}> = {
  info: { box: "border-info-100 bg-info-50", title: "text-info-700", icon: Info, iconClass: "text-info-600" },
  success: {
    box: "border-success-100 bg-success-50",
    title: "text-success-700",
    icon: CheckCircle2,
    iconClass: "text-success-600",
  },
  warning: {
    box: "border-warning-100 bg-warning-50",
    title: "text-warning-700",
    icon: AlertTriangle,
    iconClass: "text-warning-600",
  },
  danger: { box: "border-danger-100 bg-danger-50", title: "text-danger-700", icon: AlertCircle, iconClass: "text-danger-600" },
};

function noopSubscribe(): () => void {
  return () => {};
}

function readLocalDismissal(key: string): boolean {
  try {
    return Boolean(window.localStorage.getItem(bannerDismissStorageKey(key)));
  } catch {
    // Storage blocked: the banner simply stays.
    return false;
  }
}

export type PlatformBannerProps = {
  /** The dismissal key: a banner id, or `maintenance:<id>:upcoming`. */
  dismissKey: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  tone: BannerTone;
  dismissible: boolean;
  /** server: signed-in users; local: website visitors; none: the admin preview. */
  dismissMode: "server" | "local" | "none";
  variant?: "bar" | "card" | "marketing";
  className?: string;
};

export function PlatformBanner({
  dismissKey,
  title,
  body,
  linkUrl,
  linkLabel,
  tone,
  dismissible,
  dismissMode,
  variant = "bar",
  className,
}: PlatformBannerProps) {
  const [state, setState] = React.useState<"shown" | "leaving" | "gone">("shown");
  const surface = SURFACE[BANNER_TONE[tone].tone as keyof typeof SURFACE] ?? SURFACE.info;
  const Icon = surface.icon;

  // A website visitor's earlier dismissal (also applied pre-paint by the
  // inline script the slot renders, so this only confirms it for React).
  const storedDismissal = React.useSyncExternalStore(
    noopSubscribe,
    () => dismissMode === "local" && dismissible && readLocalDismissal(dismissKey),
    () => false,
  );

  const dismiss = React.useCallback(() => {
    if (!dismissible || dismissMode === "none") return;
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setState(reduce ? "gone" : "leaving");
    if (!reduce) window.setTimeout(() => setState("gone"), 180);

    if (dismissMode === "local") {
      try {
        window.localStorage.setItem(bannerDismissStorageKey(dismissKey), new Date().toISOString());
      } catch {
        // Private mode or blocked storage: dismissed for this page view only.
      }
      return;
    }
    void fetch("/api/platform/banners/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: dismissKey }),
      keepalive: true,
    }).catch(() => {
      // Hidden now either way; it may return on the next page if the write failed.
    });
  }, [dismissKey, dismissMode, dismissible]);

  if (state === "gone" || storedDismissal) return null;

  const canDismiss = dismissible && dismissMode !== "none";

  return (
    <div
      role="status"
      aria-live="polite"
      data-banner-key={dismissKey}
      onKeyDown={(event) => {
        if (event.key === "Escape" && canDismiss) {
          event.stopPropagation();
          dismiss();
        }
      }}
      className={cn(
        "rounded-lg border px-4 py-3",
        "transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
        state === "leaving" && "-translate-y-1 opacity-0",
        variant === "marketing" && "rounded-none border-x-0 border-t-0 px-4 py-2.5 sm:px-6",
        surface.box,
        className,
      )}
    >
      <div className={cn("flex items-start gap-3", variant === "marketing" && "mx-auto max-w-[1180px]")}>
        <Icon className={cn("mt-0.5 size-4 shrink-0", surface.iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-semibold", surface.title)}>{title}</p>
          {body || linkUrl ? (
            <p className="mt-0.5 text-[13px] text-content-secondary">
              {body}
              {linkUrl && linkLabel ? (
                <>
                  {body ? " " : null}
                  <a
                    href={linkUrl}
                    className={cn(
                      "font-medium underline underline-offset-2 hover:no-underline",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                      surface.title,
                    )}
                    {...(linkUrl.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {})}
                  >
                    {linkLabel}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            // In the admin preview the control is drawn but inert.
            aria-disabled={!canDismiss || undefined}
            tabIndex={canDismiss ? undefined : -1}
            aria-label={`Dismiss: ${title}`}
            className={cn(
              "-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md",
              "text-content-muted hover:bg-black/5 hover:text-content",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
