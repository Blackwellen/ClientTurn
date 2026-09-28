"use client";

import { allowedNextStatuses } from "@/lib/leads/status-transitions";
import * as React from "react";
import Link from "next/link";
import { Bot, ChevronDown, Maximize2, MessageSquare, MoreHorizontal, Phone, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/form";
import { LEAD_STATUS } from "@/components/ui/badge";
import { useEscape } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import {
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import type { DataRightsMode } from "@/lib/data-rights/wording";
import { formatRelative } from "@/lib/dates";
import {
  leadDisplayName,
  type LeadCapabilities,
  type LeadDetail,
} from "@/lib/leads/types";
import type { LeadDrawerActions } from "./lead-drawer-actions";
import { LeadSummarySection } from "./lead-summary-section";
import { LeadConversationSection } from "./lead-conversation-section";
import { LeadActivitySection } from "./lead-activity-section";
import { LeadDataRightsDialogs } from "./lead-data-rights";
import { CloseOutcomeDialog } from "./close-outcome-dialog";
import { leadPageHref, statusNeedsReason } from "@/lib/leads/detail-page";
import { CallWithAiDialog } from "@/components/voice/call-with-ai-button";
import { DRAWER_CALL_UNAVAILABLE, type DrawerCallState } from "@/lib/voice/call-button-state";

const TABS = [
  { value: "summary", label: "Summary" },
  { value: "conversation", label: "Conversation" },
  { value: "activity", label: "Activity" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

/** `lead.status` is a plain string off the row, so it is narrowed here once. */
function statusLabel(status: string) {
  return (LEAD_STATUS as Record<string, { label: string }>)[status]?.label ?? status;
}

/** Dot beside the header status select, coloured from the canonical map. */
const STATUS_DOT: Record<string, string> = {
  info: "bg-info-500",
  accent: "bg-accent-500",
  warning: "bg-warning-500",
  purple: "bg-purple-500",
  success: "bg-success-500",
  danger: "bg-danger-500",
  neutral: "bg-content-subtle",
};

function statusDot(status: string) {
  const tone = (LEAD_STATUS as Record<string, { tone: string }>)[status]?.tone;
  return STATUS_DOT[tone ?? "neutral"] ?? STATUS_DOT.neutral;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm0 1.9a8.1 8.1 0 1 1-4.2 15l-.3-.2-2.8.8.8-2.8-.2-.3A8.1 8.1 0 0 1 12 3.9Zm-3.3 4c-.2 0-.5 0-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.6-.3-1.6-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-1.9-1.2 7.3 7.3 0 0 1-1.3-1.7c-.2-.2 0-.4.1-.5l.4-.5.3-.5v-.5l-.8-1.9c-.2-.4-.4-.4-.6-.4h-.4Z" />
    </svg>
  );
}

function PrimaryAction({
  icon: Icon,
  label,
  disabled,
  title,
  onClick,
  className,
  describedBy,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  className?: string;
  /** The id of visible text explaining a disabled state (a title alone is not announced reliably). */
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-describedby={describedBy}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3",
        "text-[13px] font-medium text-content-secondary shadow-xs",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "hover:bg-surface-hover hover:text-content",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface",
        // Last, so a caller's layout classes (hidden, rounded-l-none) win.
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-content-subtle" />
      {label}
    </button>
  );
}

/**
 * A right-side overlay rather than a page: the operator keeps the list they
 * were working through visible behind it, and closing returns them to exactly
 * the same filters, page and scroll position. Three tabs, no more — this is an
 * inbox, not a contact record.
 */
export function LeadDrawer({
  detail,
  actions,
  capabilities,
  canWrite,
  role,
  onClose,
  initialTab = "summary",
  focus,
  call,
}: {
  detail: LeadDetail;
  actions: LeadDrawerActions;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  /** Decides which data-rights items show; the server enforces regardless. */
  role?: "owner" | "admin" | "member" | "viewer";
  onClose: () => void;
  initialTab?: string;
  focus?: string;
  /**
   * "Call with AI" (computed server-side from the voice settings, the lead and
   * the viewer's role; lib/voice/call-button-state). Absent = could not be
   * checked, so the button is disabled.
   */
  call?: DrawerCallState | null;
}) {
  const { lead } = detail;
  const { toast } = useToast();
  const name = leadDisplayName(lead);

  const [tab, setTab] = React.useState<TabValue>(
    TABS.some((item) => item.value === initialTab)
      ? (initialTab as TabValue)
      : "summary",
  );
  const [pending, setPending] = React.useState<string | null>(null);
  const [channel, setChannel] = React.useState<"sms" | "whatsapp">("sms");
  const [rightsMode, setRightsMode] = React.useState<DataRightsMode | null>(null);
  const [closeOutcome, setCloseOutcome] = React.useState<"WON" | "LOST" | null>(null);
  const isAdmin = role === "owner" || role === "admin";

  const panelRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLTextAreaElement>(null);

  useEscape(true, onClose);

  // Focus moves into the drawer on open and returns to the opener on close —
  // `useEscape` handles the key, this handles where the caret lands.
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const run = React.useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
      setPending(key);
      try {
        const result = await fn();
        if (result.ok) toast({ variant: "success", title: success });
        else toast({ variant: "error", title: result.error ?? "That didn’t work." });
        return result.ok;
      } finally {
        setPending(null);
      }
    },
    [toast],
  );

  /** Sending from anywhere lands the operator in the composer, never mid-send. */
  const openComposer = React.useCallback((next: "sms" | "whatsapp") => {
    setChannel(next);
    setTab("conversation");
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const noPhone = !lead.phone;
  const messagingBlocked = !canWrite || lead.opted_out || noPhone;

  // "Call with AI": the same dialog and server action as the lead page. A
  // viewer, or a drawer whose voice state could not be read, never gets an
  // enabled button; the server re-checks everything on press regardless.
  const aiCall = call ?? DRAWER_CALL_UNAVAILABLE;
  const aiCallReason = !canWrite ? "Viewers can't place calls." : aiCall.disabledReason;
  const [aiCallOpen, setAiCallOpen] = React.useState(false);
  const [aiCallRefusal, setAiCallRefusal] = React.useState<string | null>(null);
  const aiCallHintId = React.useId();
  const aiCallHint = aiCallRefusal ?? aiCallReason;

  return (
    <>
      {/* The list stays legible behind the drawer — this is a working overlay,
          not a modal that hides the context the operator came from. */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-[rgb(15_23_42/0.04)] animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]"
      />

      <div
        ref={panelRef}
        role="dialog"
        data-tour="lead-drawer"
        tabIndex={-1}
        aria-label={`Lead ${name}`}
        // The panel is focused so the dialog is announced on open, but it is
        // not a control the user aimed at, so it must not paint the global
        // :focus-visible ring. Inline, because that global rule uses the
        // `outline` shorthand and wins against utility classes.
        style={{ outline: "none" }}
        className={cn(
          "fixed inset-0 z-50 flex flex-col bg-surface outline-none focus:outline-none focus-visible:outline-none",
          "lg:inset-y-0 lg:left-auto lg:right-0 lg:top-[var(--lr-topbar-height)]",
          "lg:w-[clamp(600px,44vw,720px)] lg:border-l lg:border-line",
          "shadow-[-20px_0_50px_rgb(15_23_42/0.10)]",
          "animate-[lr-slide-in-right_var(--lr-duration-slow)_var(--lr-ease)]",
          "motion-reduce:animate-none",
        )}
      >
        {/* ------------------------------------------------------- header */}
        <div className="shrink-0 border-b border-line-subtle px-4 pt-4 sm:px-5">
          <div className="flex items-start gap-3">
            <Avatar name={name} src={lead.avatarUrl} size="lg" />

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[18px] font-semibold leading-tight text-content">
                {name}
              </h2>
              <p className="mt-0.5 truncate text-[12px] text-content-muted">
                {statusLabel(lead.status)} lead &middot;{" "}
                {formatRelative(lead.created_at)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="relative">
                <Select
                  aria-label="Lead status"
                  className="h-9 w-[136px] pl-7 text-[13px]"
                  disabled={!canWrite || pending === "status"}
                  value={lead.status}
                  onChange={(event) => {
                    const next = event.target.value;
                    // Won and lost need a reason, so they ask for one first.
                    if (statusNeedsReason(next)) {
                      setCloseOutcome(next);
                      return;
                    }
                    void run(
                      "status",
                      () => actions.updateLeadStatus({ leadId: lead.id, status: next }),
                      "Status updated.",
                    );
                  }}
                >
                  {allowedNextStatuses(lead.status).map((status) => (
                    <option key={status} value={status}>
                      {LEAD_STATUS[status].label}
                    </option>
                  ))}
                </Select>
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-3 top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                    statusDot(lead.status),
                  )}
                />
              </div>

              <Link
                href={leadPageHref(lead.id)}
                aria-label="Open full page"
                title="Open full page"
                className="rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
              >
                <Maximize2 className="size-4.5" aria-hidden />
              </Link>

              <button
                type="button"
                aria-label="Close lead"
                onClick={onClose}
                className="rounded-lg p-2 text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>

          {/* ------------------------------------------- primary actions */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {/* A small split: phone them yourself, or have the AI call. On
                narrow screens "Call with AI" moves into More. */}
            <div role="group" aria-label="Call" className="inline-flex">
              <PrimaryAction
                icon={Phone}
                label="Call yourself"
                disabled={noPhone}
                title={noPhone ? "This lead has no phone number." : undefined}
                className="sm:rounded-r-none"
                onClick={() => {
                  if (lead.phone) window.location.href = `tel:${lead.phone}`;
                }}
              />
              <PrimaryAction
                icon={Bot}
                label="Call with AI"
                disabled={Boolean(aiCallReason)}
                title={aiCallReason ?? undefined}
                describedBy={aiCallHint ? aiCallHintId : undefined}
                className="-ml-px hidden rounded-l-none sm:inline-flex"
                onClick={() => {
                  setAiCallRefusal(null);
                  setAiCallOpen(true);
                }}
              />
            </div>
            <PrimaryAction
              icon={MessageSquare}
              label="Send SMS"
              disabled={messagingBlocked || !capabilities.sms}
              title={
                lead.opted_out
                  ? "This lead opted out and cannot be messaged."
                  : noPhone
                    ? "This lead has no phone number."
                    : !capabilities.sms
                      ? "SMS is not connected for this workspace."
                      : undefined
              }
              onClick={() => openComposer("sms")}
            />
            <PrimaryAction
              icon={WhatsAppIcon}
              label="Send WhatsApp"
              disabled={messagingBlocked || !capabilities.whatsapp}
              title={
                lead.opted_out
                  ? "This lead opted out and cannot be messaged."
                  : noPhone
                    ? "This lead has no phone number."
                    : !capabilities.whatsapp
                      ? "WhatsApp is not connected for this workspace."
                      : undefined
              }
              onClick={() => openComposer("whatsapp")}
            />

            <DropdownMenu
              align="end"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-content-secondary shadow-xs transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                >
                  <MoreHorizontal className="size-4 text-content-subtle" aria-hidden />
                  More
                  <ChevronDown className="size-3.5 text-content-subtle" aria-hidden />
                </button>
              }
            >
              <DropdownItem
                className="sm:hidden"
                icon={Bot}
                disabled={Boolean(aiCallReason)}
                description={aiCallReason ?? undefined}
                onSelect={() => {
                  setAiCallRefusal(null);
                  setAiCallOpen(true);
                }}
              >
                Call with AI
              </DropdownItem>
              <DropdownItem onSelect={() => setTab("conversation")}>
                View conversation
              </DropdownItem>
              <DropdownItem onSelect={() => setTab("activity")}>
                View activity
              </DropdownItem>
              {lead.email && (
                <DropdownItem
                  onSelect={() => {
                    window.location.href = `mailto:${lead.email}`;
                  }}
                >
                  Email lead
                </DropdownItem>
              )}
              {actions.dataRights && canWrite && (
                <>
                  <DropdownSeparator />
                  <DropdownLabel>Data rights</DropdownLabel>
                  <DropdownItem onSelect={() => setRightsMode("SUPPRESS")}>
                    Suppress…
                  </DropdownItem>
                  <DropdownItem onSelect={() => setRightsMode("RESTRICT")}>
                    Restrict processing…
                  </DropdownItem>
                  {isAdmin && (
                    <>
                      <DropdownItem onSelect={() => setRightsMode("EXPORT")}>
                        Export data…
                      </DropdownItem>
                      <DropdownItem destructive onSelect={() => setRightsMode("ANONYMISE")}>
                        Anonymise…
                      </DropdownItem>
                      <DropdownItem destructive onSelect={() => setRightsMode("DELETE")}>
                        Erase…
                      </DropdownItem>
                    </>
                  )}
                </>
              )}
            </DropdownMenu>
          </div>

          {aiCallHint && (
            <p
              id={aiCallHintId}
              role={aiCallRefusal ? "alert" : undefined}
              className="mt-1.5 text-[12px] text-content-muted"
            >
              <span className="font-medium text-content-secondary">Call with AI:</span> {aiCallHint}{" "}
              {!aiCallRefusal && aiCall.fix && (
                <Link href={aiCall.fix.href} className="font-medium text-content-accent underline-offset-4 hover:underline">
                  {aiCall.fix.label}
                </Link>
              )}
            </p>
          )}

          <CallWithAiDialog
            open={aiCallOpen}
            onClose={() => setAiCallOpen(false)}
            leadId={lead.id}
            leadName={name}
            numberE164={aiCall.numberE164}
            onRefused={setAiCallRefusal}
          />

          {/* ------------------------------------------------------- tabs */}
          <div role="tablist" aria-label="Lead detail" className="mt-3 flex items-center gap-6">
            {TABS.map((item) => {
              const active = item.value === tab;
              return (
                <button
                  key={item.value}
                  role="tab"
                  type="button"
                  id={`lead-tab-${item.value}`}
                  aria-selected={active}
                  aria-controls={`lead-panel-${item.value}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(item.value)}
                  onKeyDown={(event) => {
                    const index = TABS.findIndex((t) => t.value === tab);
                    let next = index;
                    if (event.key === "ArrowRight") next = index + 1;
                    else if (event.key === "ArrowLeft") next = index - 1;
                    else return;
                    event.preventDefault();
                    const target = TABS[(next + TABS.length) % TABS.length];
                    setTab(target.value);
                    document.getElementById(`lead-tab-${target.value}`)?.focus();
                  }}
                  className={cn(
                    "relative -mb-px h-12 border-b-2 text-[13px] font-medium",
                    "transition-colors duration-[var(--lr-duration-fast)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
                    active
                      ? "border-accent-500 text-content"
                      : "border-transparent text-content-muted hover:text-content",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------- panels */}
        {tab === "summary" && (
          <div
            role="tabpanel"
            id="lead-panel-summary"
            aria-labelledby="lead-tab-summary"
            className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-4 sm:px-5"
          >
            <LeadSummarySection
              detail={detail}
              actions={actions}
              capabilities={capabilities}
              canWrite={canWrite}
              pending={pending}
              run={run}
              onOpenComposer={openComposer}
              onRequestClose={setCloseOutcome}
              focus={focus}
            />
          </div>
        )}

        {tab === "conversation" && (
          <div
            role="tabpanel"
            id="lead-panel-conversation"
            aria-labelledby="lead-tab-conversation"
            className="flex min-h-0 flex-1 flex-col"
          >
            <LeadConversationSection
              detail={detail}
              actions={actions}
              capabilities={capabilities}
              canWrite={canWrite}
              pending={pending}
              run={run}
              channel={channel}
              onChannelChange={setChannel}
              composerRef={composerRef}
            />
          </div>
        )}

        {tab === "activity" && (
          <div
            role="tabpanel"
            id="lead-panel-activity"
            aria-labelledby="lead-tab-activity"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"
          >
            <LeadActivitySection timeline={detail.timeline} />
          </div>
        )}
      </div>

      <CloseOutcomeDialog
        outcome={closeOutcome}
        onClose={() => setCloseOutcome(null)}
        onSubmit={(outcome, reason) =>
          run(
            outcome === "WON" ? "won" : "lost",
            () =>
              outcome === "WON"
                ? actions.markWon(lead.id, reason)
                : actions.markLost(lead.id, reason),
            outcome === "WON" ? "Marked as won." : "Marked as lost.",
          )
        }
      />

      {actions.dataRights && (
        <LeadDataRightsDialogs
          leadId={lead.id}
          mode={rightsMode}
          onClose={() => setRightsMode(null)}
          onErased={onClose}
          actions={actions.dataRights}
        />
      )}
    </>
  );
}
