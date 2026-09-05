"use client";

import * as React from "react";
import {
  CalendarPlus,
  CheckCircle2,
  Clock,
  Hand,
  MessageSquare,
  Phone,
  Play,
  Trophy,
  UserPlus,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/ui/modal";
import type { LeadCapabilities, LeadDetail } from "@/lib/leads/types";
import type { LeadDrawerActions, RunAction } from "./lead-drawer-actions";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm0 1.9a8.1 8.1 0 1 1-4.2 15l-.3-.2-2.8.8.8-2.8-.2-.3A8.1 8.1 0 0 1 12 3.9Zm-3.3 4c-.2 0-.5 0-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.6-.3-1.6-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-1.9-1.2 7.3 7.3 0 0 1-1.3-1.7c-.2-.2 0-.4.1-.5l.4-.5.3-.5v-.5l-.8-1.9c-.2-.4-.4-.4-.6-.4h-.4Z" />
    </svg>
  );
}

type ActionSpec = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Non-null means the action is unavailable, and why. */
  blocked?: string | null;
  tone?: "default" | "success" | "danger";
  onSelect: () => void;
};

/**
 * Every manual action for a lead in one grid. Actions that cannot legally run
 * are disabled with the reason in a tooltip rather than hidden, so the
 * operator learns what to configure instead of wondering where a button went.
 */
export function LeadManualActions({
  detail,
  actions,
  capabilities,
  canWrite,
  pending,
  run,
  onOpenComposer,
}: {
  detail: LeadDetail;
  actions: LeadDrawerActions;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  pending: string | null;
  run: RunAction;
  onOpenComposer: (channel: "sms" | "whatsapp") => void;
}) {
  const { lead } = detail;
  const [confirm, setConfirm] = React.useState<null | "lost" | "not_qualified">(null);

  const closed = lead.status === "WON" || lead.status === "LOST";
  const noPermission = canWrite ? null : "You do not have permission to act on leads.";
  const optedOut = lead.opted_out
    ? "This lead opted out and cannot be messaged."
    : null;
  const noPhone = lead.phone ? null : "This lead has no phone number.";

  const specs: ActionSpec[] = [
    {
      key: "sms",
      label: "Send SMS",
      icon: MessageSquare,
      blocked:
        noPermission ??
        optedOut ??
        noPhone ??
        (capabilities.sms ? null : "SMS is not connected for this workspace."),
      onSelect: () => onOpenComposer("sms"),
    },
    {
      key: "whatsapp",
      label: "Send WhatsApp",
      icon: WhatsAppIcon,
      blocked:
        noPermission ??
        optedOut ??
        noPhone ??
        (capabilities.whatsapp
          ? null
          : "WhatsApp is not connected for this workspace."),
      onSelect: () => onOpenComposer("whatsapp"),
    },
    {
      key: "call",
      label: "Call",
      icon: Phone,
      blocked: noPhone,
      onSelect: () => {
        if (lead.phone) window.location.href = `tel:${lead.phone}`;
      },
    },
    {
      key: "booking",
      label: "Send booking link",
      icon: CalendarPlus,
      blocked:
        noPermission ??
        optedOut ??
        noPhone ??
        (capabilities.booking
          ? null
          : "No booking destination is configured. Connect a calendar first."),
      onSelect: () =>
        run(
          "booking",
          () => actions.sendBookingLink({ leadId: lead.id }),
          "Booking link sent.",
        ),
    },
    {
      key: "qualified",
      label: "Mark qualified",
      icon: CheckCircle2,
      tone: "success",
      blocked:
        noPermission ??
        (lead.qualification_state === "QUALIFIED"
          ? "This lead is already qualified."
          : null),
      onSelect: () =>
        run(
          "qualified",
          () =>
            actions.setQualificationResult({ leadId: lead.id, result: "QUALIFIED" }),
          "Marked as qualified.",
        ),
    },
    {
      key: "not_qualified",
      label: "Mark not qualified",
      icon: XCircle,
      tone: "danger",
      blocked:
        noPermission ??
        (lead.qualification_state === "NOT_QUALIFIED"
          ? "This lead is already marked not qualified."
          : null),
      onSelect: () => setConfirm("not_qualified"),
    },
    {
      key: "review",
      label: "Mark review",
      icon: Clock,
      blocked:
        noPermission ??
        (lead.qualification_state === "REVIEW"
          ? "This lead is already flagged for review."
          : null),
      onSelect: () =>
        run(
          "review",
          () => actions.setQualificationResult({ leadId: lead.id, result: "REVIEW" }),
          "Flagged for review.",
        ),
    },
    {
      key: "assign",
      label: "Assign",
      icon: UserPlus,
      blocked: noPermission,
      onSelect: () => {
        const control = document.getElementById("lead-assign-control");
        control?.scrollIntoView({ block: "center", behavior: "smooth" });
        (control as HTMLSelectElement | null)?.focus();
      },
    },
    {
      key: "takeover",
      label: "Human takeover",
      icon: Hand,
      blocked:
        noPermission ??
        (lead.human_takeover
          ? "You have already taken this conversation over."
          : closed
            ? "This lead is closed — reopen it to take the conversation over."
            : null),
      onSelect: () =>
        run(
          "takeover",
          () => actions.humanTakeover(lead.id),
          "You have taken over this conversation.",
        ),
    },
    {
      key: "resume",
      label: "Resume follow-up",
      icon: Play,
      blocked:
        noPermission ??
        optedOut ??
        (!lead.human_takeover
          ? "Automated follow-up is already running for this lead."
          : closed
            ? "Follow-up does not resume on a won or lost lead."
            : lead.status === "BOOKED"
              ? "This lead is booked — follow-up has already done its job."
              : null),
      onSelect: () =>
        run(
          "resume",
          () => actions.resumeAutomation(lead.id),
          "Automated follow-up resumed.",
        ),
    },
    {
      key: "won",
      label: "Mark won",
      icon: Trophy,
      tone: "success",
      blocked:
        noPermission ??
        (lead.status === "WON"
          ? "This lead is already won."
          : lead.status === "LOST"
            ? "This lead is marked lost. Change its status first."
            : null),
      onSelect: () => run("won", () => actions.markWon(lead.id), "Marked as won."),
    },
    {
      key: "lost",
      label: "Mark lost",
      icon: XCircle,
      tone: "danger",
      blocked:
        noPermission ?? (lead.status === "LOST" ? "This lead is already lost." : null),
      onSelect: () => setConfirm("lost"),
    },
  ];

  return (
    <>
      <section
        id="lead-manual-actions"
        className="rounded-xl border border-line bg-surface p-4 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
          >
            <Zap className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-content">Manual actions</h3>
            <p className="text-[12px] text-content-muted">Take action on this lead.</p>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {specs.map((spec) => {
            const Icon = spec.icon;
            const disabled = Boolean(spec.blocked) || pending === spec.key;
            return (
              <button
                key={spec.key}
                type="button"
                disabled={disabled}
                title={spec.blocked ?? undefined}
                aria-describedby={spec.blocked ? `${spec.key}-blocked` : undefined}
                onClick={spec.onSelect}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5",
                  "text-[12px] font-medium text-content-secondary shadow-xs",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "hover:bg-surface-hover hover:text-content",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
                  "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    spec.tone === "success" && "text-success-600",
                    spec.tone === "danger" && "text-danger-500",
                    !spec.tone && "text-content-subtle",
                  )}
                />
                <span className="truncate">{spec.label}</span>
                {spec.blocked && (
                  <span id={`${spec.key}-blocked`} className="sr-only">
                    {spec.blocked}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <ConfirmDialog
        open={confirm === "lost"}
        variant="warning"
        title="Mark this lead as lost?"
        scope="This lead moves to Lost."
        consequence="Automated follow-up stops immediately and the lead leaves your active figures. You can reopen it later by changing the status."
        confirmLabel="Mark as lost"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await run("lost", () => actions.markLost(lead.id), "Marked as lost.");
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={confirm === "not_qualified"}
        variant="warning"
        title="Mark this lead as not qualified?"
        scope="The qualification result is overridden to Not qualified."
        consequence="Automated follow-up stops for this lead. The deterministic engine will not re-qualify it on its own."
        confirmLabel="Mark not qualified"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await run(
            "not_qualified",
            () =>
              actions.setQualificationResult({
                leadId: lead.id,
                result: "NOT_QUALIFIED",
              }),
            "Marked as not qualified.",
          );
          setConfirm(null);
        }}
      />
    </>
  );
}
