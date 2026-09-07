"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { useFocusTrap, useEscape } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { COPILOT_TABS, type CopilotTab } from "@/lib/copilot/types";
import { CopilotChat } from "./copilot-chat";
import { CopilotActions } from "./copilot-actions";
import { CopilotInsights } from "./copilot-insights";
import { CopilotHistory } from "./copilot-history";

/**
 * The ClientTurn Copilot drawer (V4 §28).
 *
 * Shell-level and non-modal by design. It slides in over the app rather than
 * replacing it, the page stays visible and usable beneath, and the conversation
 * survives navigation — because the questions people ask Copilot are usually
 * *about* what is on screen, and losing the chat to answer them would defeat
 * the point.
 *
 * `aria-modal` is deliberately false and there is no overlay: this is a
 * side panel, not a dialog, and trapping the page behind it would be a lie
 * about what it is.
 */
export function CopilotDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [tab, setTab] = React.useState<CopilotTab>("chat");
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open);
  useEscape(open, onClose);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id="clientturn-copilot"
      role="dialog"
      aria-modal="false"
      aria-label="ClientTurn Copilot"
      className={cn(
        "fixed z-40 flex flex-col border-line bg-surface shadow-2xl",
        // Full-width sheet on mobile, right-hand drawer from `sm` up.
        "inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(460px,100vw)] sm:border-l",
        "animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)] motion-reduce:animate-none",
      )}
      style={{ top: "var(--lr-topbar-height)" }}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-purple-100 bg-purple-50 text-purple-600"
          >
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-content">
              ClientTurn Copilot
            </h2>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Your AI assistant for leads, campaigns and growth.
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Close Copilot"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-content-muted hover:bg-surface-sunken hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
        >
          <X className="size-4.5" aria-hidden />
        </button>
      </header>

      <nav
        aria-label="Copilot views"
        className="flex shrink-0 items-center gap-1 border-b border-line px-3"
      >
        {COPILOT_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium",
              "transition-colors duration-[var(--lr-duration-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
              tab === item.id
                ? "border-accent-600 text-content"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" && (
          <CopilotChat
            pathname={pathname}
            sessionId={sessionId}
            onSession={setSessionId}
          />
        )}
        {tab === "actions" && <CopilotActions sessionId={sessionId} />}
        {tab === "insights" && <CopilotInsights />}
        {tab === "history" && <CopilotHistory />}
      </div>

      <footer className="shrink-0 border-t border-line px-4 py-2.5">
        <p className="text-center text-[11px] text-content-muted">
          Copilot uses the same secure tools and data as ClientTurn, with your
          permissions.
        </p>
      </footer>
    </div>
  );
}
