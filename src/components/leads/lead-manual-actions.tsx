"use client";

import * as React from "react";
import {
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hand,
  MessageSquare,
  Phone,
  Play,
  Send,
  Trophy,
  UserPlus,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownGroup, DropdownItem, DropdownMenu } from "@/components/ui/dropdown";
import { ConfirmDialog } from "@/components/ui/modal";
import type { LeadCapabilities, LeadDetail } from "@/lib/leads/types";
import { HANDOVER_COPY, handBackUnavailableReason } from "@/lib/leads/resume-rule";
import type { LeadDrawerActions, RunAction } from "./lead-drawer-actions";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm0 1.9a8.1 8.1 0 1 1-4.2 15l-.3-.2-2.8.8.8-2.8-.2-.3A8.1 8.1 0 0 1 12 3.9Zm-3.3 4c-.2 0-.5 0-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.6-.3-1.6-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-1.9-1.2 7.3 7.3 0 0 1-1.3-1.7c-.2-.2 0-.4.1-.5l.4-.5.3-.5v-.5l-.8-1.9c-.2-.4-.4-.4-.6-.4h-.4Z" />
    </svg>
  );
}

type ActionGroup = "Contact" | "Qualification" | "Ownership" | "Outcome";

const GROUPS: ActionGroup[] = ["Contact", "Qualification", "Ownership", "Outcome"];

type ActionSpec = {
  key: string;
  group: ActionGroup;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Non-null means the action is unavailable, and why. */
  blocked?: string | null;
  /** What the action does, shown under the label while it is available. */
  help?: string;
  tone?: "default" | "success" | "danger";
  onSelect: () => void;
};

/**
 * Every manual action for a lead: one primary action (Message) and an
 * "Actions" menu grouped Contact / Qualification / Ownership / Outcome.
 *
 * This replaced a twelve-button grid in which the most common act, replying,
 * weighed the same as "Mark needs review". Actions that cannot legally run stay in
 * the menu, disabled, with the reason printed under the label rather than in
 * a hover-only tooltip, so the operator learns what to configure instead of
 * wondering where a button went — on touch too.
 */
export function LeadManualActions({
  detail,
  actions,
  capabilities,
  canWrite,
  pending,
  run,
  onOpenComposer,
  onRequestClose,
}: {
  detail: LeadDetail;
  actions: LeadDrawerActions;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  pending: string | null;
  run: RunAction;
  onOpenComposer: (channel: "sms" | "whatsapp") => void;
  /** Opens the won/lost dialog, which asks for the reason. */
  onRequestClose: (outcome: "WON" | "LOST") => void;
}) {
  const { lead } = detail;
  const [confirm, setConfirm] = React.useState<null | "not_qualified">(null);

  const closed = lead.status === "WON" || lead.status === "LOST";
  const noPermission = canWrite ? null : "You do not have permission to act on leads.";
  const optedOut = lead.opted_out
    ? "This lead opted out and cannot be messaged."
    : null;
  const noPhone = lead.phone ? null : "This lead has no phone number.";

  const specs: ActionSpec[] = [
    {
      key: "sms",
      group: "Contact",
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
      group: "Contact",
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
      group: "Contact",
      label: "Call",
      icon: Phone,
      blocked: noPhone,
      onSelect: () => {
        if (lead.phone) window.location.assign(`tel:${lead.phone}`);
      },
    },
    {
      key: "booking",
      group: "Contact",
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
      group: "Qualification",
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
      group: "Qualification",
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
      group: "Qualification",
      label: "Mark needs review",
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
      group: "Ownership",
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
      group: "Ownership",
      label: HANDOVER_COPY.takeOver,
      help: HANDOVER_COPY.takeOverHelp,
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
      group: "Ownership",
      label: HANDOVER_COPY.handBack,
      help: HANDOVER_COPY.handBackHelp,
      icon: Play,
      // The rule lead.resume_follow_up enforces. The drawer only opens
      // unarchived leads; the server refuses an archived one regardless.
      blocked:
        noPermission ??
        handBackUnavailableReason({
          status: lead.status,
          optedOut: lead.opted_out,
          archived: false,
          humanTakeover: lead.human_takeover,
        }),
      onSelect: () =>
        run(
          "resume",
          () => actions.resumeAutomation(lead.id),
          "Automated follow-up resumed.",
        ),
    },
    {
      key: "won",
      group: "Outcome",
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
      onSelect: () => onRequestClose("WON"),
    },
    {
      key: "lost",
      group: "Outcome",
      label: "Mark lost",
      icon: XCircle,
      tone: "danger",
      blocked:
        noPermission ?? (lead.status === "LOST" ? "This lead is already lost." : null),
      onSelect: () => onRequestClose("LOST"),
    },
  ];

  // Message goes out on the first channel that can legally be used; the
  // other channel stays one click away in the menu.
  const messageSpec =
    specs.find((spec) => spec.key === "sms" && !spec.blocked) ??
    specs.find((spec) => spec.key === "whatsapp" && !spec.blocked) ??
    null;
  const messageBlocked = messageSpec
    ? null
    : (specs.find((spec) => spec.key === "sms")?.blocked ?? "Messaging is unavailable.");

  return (
    <>
      <section
        id="lead-manual-actions"
        aria-labelledby="lead-manual-actions-title"
        className="rounded-xl border border-line bg-surface p-4 shadow-xs"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
          >
            <Zap className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id="lead-manual-actions-title"
              className="text-[14px] font-semibold text-content"
            >
              Actions
            </h3>
            <p className="truncate text-[12px] text-content-muted">
              {messageBlocked ?? "Reply, qualify, hand over or close this lead."}
            </p>
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button
              size="sm"
              variant="primary"
              className="flex-1 sm:flex-none"
              disabled={!messageSpec || pending === messageSpec.key}
              loading={messageSpec ? pending === messageSpec.key : false}
              title={messageBlocked ?? undefined}
              onClick={() => messageSpec?.onSelect()}
            >
              <Send className="size-3.5" aria-hidden />
              Message
            </Button>

            <DropdownMenu
              align="end"
              label="Lead actions"
              className="w-72"
              trigger={
                <Button size="sm" variant="secondary" className="flex-1 sm:flex-none">
                  Actions
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              }
            >
              {GROUPS.map((group) => (
                <DropdownGroup key={group} label={group}>
                  {specs
                    .filter((spec) => spec.group === group)
                    .map((spec) => (
                      <DropdownItem
                        key={spec.key}
                        icon={spec.icon}
                        destructive={spec.tone === "danger" && !spec.blocked}
                        disabled={Boolean(spec.blocked) || pending === spec.key}
                        description={spec.blocked ?? spec.help}
                        onSelect={spec.onSelect}
                      >
                        {spec.label}
                      </DropdownItem>
                    ))}
                </DropdownGroup>
              ))}
            </DropdownMenu>
          </div>
        </div>
      </section>

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
