"use client";

import * as React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BarChart3, CircleHelp, Ticket, X } from "lucide-react";
import { useFocusTrap, useEscape } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { HelpView } from "./help-view";
import { NewTicketForm } from "./new-ticket-form";
import { TicketList } from "./ticket-list";
import { TicketConversation } from "./ticket-conversation";
import { SystemStatusView } from "./system-status-view";

/**
 * The support popout (V4 §23).
 *
 * Support lives in the shell, not on a page: someone asking for help is
 * usually stuck in the middle of something, and navigating away to ask about
 * it loses the very context they need to describe. The panel floats over the
 * app, and the route they were on is what the ticket records.
 *
 * Exactly three tabs — Help, My Tickets, System Status. The bottom bar is the
 * navigation; anything deeper (an article, a ticket, the new-ticket form)
 * pushes into the panel with a Back control rather than adding a tab.
 */

type Tab = "help" | "tickets" | "status";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { id: "help", label: "Help", icon: CircleHelp },
    { id: "tickets", label: "My Tickets", icon: Ticket },
    { id: "status", label: "System Status", icon: BarChart3 },
  ];

/** What is showing inside the current tab. */
type Screen =
  | { kind: "root" }
  | { kind: "article"; slug: string }
  | { kind: "new-ticket" }
  | { kind: "ticket"; id: string };

export function SupportPopout() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("help");
  const [screen, setScreen] = React.useState<Screen>({ kind: "root" });
  const panelRef = React.useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open);
  useEscape(open, () => setOpen(false));

  // Other surfaces open support directly — "contact support" on the status
  // page, a failed action's toast — by dispatching this event.
  React.useEffect(() => {
    function show(event: Event) {
      const detail = (event as CustomEvent<{ tab?: Tab; compose?: boolean }>).detail;
      setOpen(true);
      setTab(detail?.tab ?? "tickets");
      setScreen(detail?.compose ? { kind: "new-ticket" } : { kind: "root" });
    }
    window.addEventListener("clientturn:support", show);
    return () => window.removeEventListener("clientturn:support", show);
  }, []);

  const goto = React.useCallback((next: Tab) => {
    setTab(next);
    setScreen({ kind: "root" });
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Open ClientTurn support"
        aria-expanded={open}
        aria-controls="clientturn-support"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group fixed bottom-5 right-5 z-40 flex size-15 items-center justify-center rounded-full",
          "border-2 border-[var(--ct-lime)] bg-white",
          "shadow-[0_6px_18px_-4px_rgba(11,16,32,0.30),0_0_0_7px_rgba(183,243,74,0.13)]",
          "transition-[transform,box-shadow] duration-200 ease-out",
          "hover:-translate-y-0.5 hover:scale-[1.05]",
          "hover:shadow-[0_12px_30px_-6px_rgba(11,16,32,0.36),0_0_0_11px_rgba(183,243,74,0.20)]",
          "active:translate-y-0 active:scale-[0.98]",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ct-lime)]",
        )}
      >
        <Image
          src="/icon.png"
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 transition-transform duration-200 ease-out group-hover:scale-105"
        />
      </button>

      {open && (
        <div
          id="clientturn-support"
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="ClientTurn support"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-white text-content shadow-2xl",
            // Full-screen sheet on mobile; a floating panel from `sm` up.
            "inset-0 rounded-none",
            "sm:inset-auto sm:bottom-22 sm:right-3 sm:h-[min(680px,calc(100dvh-110px))]",
            "sm:w-[min(440px,calc(100vw-24px))] sm:rounded-2xl sm:border sm:border-line",
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
            <Image
              src="/white_background_logo.png"
              alt="ClientTurn support"
              width={138}
              height={46}
              className="h-8 w-auto"
            />
            <button
              type="button"
              aria-label="Close support"
              onClick={() => setOpen(false)}
              className="flex size-9 items-center justify-center rounded-full text-content-muted hover:bg-surface-sunken hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "help" && (
              <HelpView
                screen={screen}
                onOpenArticle={(slug) => setScreen({ kind: "article", slug })}
                onNewTicket={() => setScreen({ kind: "new-ticket" })}
                onBack={() => setScreen({ kind: "root" })}
                onCreated={() => {
                  setTab("tickets");
                  setScreen({ kind: "root" });
                }}
                pathname={pathname}
              />
            )}

            {tab === "tickets" && screen.kind === "ticket" && (
              <TicketConversation
                ticketId={screen.id}
                onBack={() => setScreen({ kind: "root" })}
              />
            )}

            {tab === "tickets" && screen.kind === "new-ticket" && (
              <NewTicketForm
                pathname={pathname}
                onBack={() => setScreen({ kind: "root" })}
                onCreated={() => setScreen({ kind: "root" })}
              />
            )}

            {tab === "tickets" &&
              screen.kind !== "ticket" &&
              screen.kind !== "new-ticket" && (
                <TicketList
                  onOpen={(id) => setScreen({ kind: "ticket", id })}
                  onNewTicket={() => setScreen({ kind: "new-ticket" })}
                />
              )}

            {tab === "status" && <SystemStatusView />}
          </div>

          <nav
            aria-label="Support sections"
            className="grid shrink-0 grid-cols-3 border-t border-line bg-white"
          >
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => goto(id)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11.5px] font-medium",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
                  tab === id
                    ? "text-content-accent"
                    : "text-content-muted hover:text-content",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

export type { Screen };
