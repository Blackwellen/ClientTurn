"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarPlus,
  ChevronDown,
  Hand,
  Lock,
  MessageSquare,
  FileLock2,
  Play,
  RefreshCcw,
  ShieldOff,
  StickyNote,
  Trophy,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea, FormField } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  DropdownGroup,
  DropdownItem,
  DropdownMenu,
} from "@/components/ui/dropdown";
import { STAGE_LABEL, type OpportunityStage } from "@/lib/opportunities/stages";
import {
  leadPageHref,
  type ActionAvailability,
  type LeadPageAction,
} from "@/lib/leads/detail-page";
import type { WorkspaceMember } from "@/lib/leads/types";
import {
  addLeadNoteAction,
  archiveLeadAction,
  assignLeadAction,
  closeLeadOutcomeAction,
  rescoreLeadAction,
  restoreLeadAction,
  resumeLeadAction,
  setOpportunityStageAction,
  takeoverLeadAction,
  type LeadPageActionResult,
} from "@/lib/leads/detail-actions";
import { sendBookingLink } from "@/lib/leads/actions";
import { HANDOVER_COPY } from "@/lib/leads/resume-rule";
import { suppressLeadAction } from "@/lib/data-rights/actions";
import { CloseOutcomeDialog } from "../close-outcome-dialog";

/**
 * Every action the lead page offers, each a registry operation behind a
 * server action, as the page's right-rail "Actions" card: one primary action
 * (Message), an "Actions" menu grouped Contact / Pipeline / Outcome / Record
 * (the same shape as the lead drawer), and the two inline controls people
 * change most (owner, deal stage).
 *
 * Suppress, restrict, export, anonymise and erase live on the Data rights tab
 * (LeadPageDataRights), which the menu links to. An action the viewer's role
 * or the lead's state rules out stays in the menu, disabled, with the reason
 * printed under it rather than hidden, so a person learns why. The server
 * enforces all of it again.
 */

export type LeadPageActionsProps = {
  leadId: string;
  members: WorkspaceMember[];
  assignedUserId: string | null;
  opportunity: { id: string; stage: string; outcome: string; stagesAvailable: string[] } | null;
  availability: Record<LeadPageAction, ActionAvailability>;
  bookingConfigured: boolean;
  readOnly: boolean;
};

export function LeadPageActions({
  leadId,
  members,
  assignedUserId,
  opportunity,
  availability,
  bookingConfigured,
  readOnly,
}: LeadPageActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "note" | "archive" | "unsubscribe">(null);
  const [closeOutcome, setCloseOutcome] = React.useState<"WON" | "LOST" | null>(null);
  const [note, setNote] = React.useState("");
  const [noteError, setNoteError] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (key: string, fn: () => Promise<LeadPageActionResult | { ok: boolean; error?: string }>, success?: string) => {
      setPending(key);
      try {
        const result = await fn();
        if (result.ok) {
          const message = "message" in result && result.message ? result.message : success ?? "Done.";
          toast({ variant: "success", title: message });
          router.refresh();
        } else {
          toast({ variant: "error", title: ("error" in result && result.error) || "That did not work." });
        }
        return result.ok;
      } finally {
        setPending(null);
      }
    },
    [router, toast],
  );

  if (readOnly) {
    return (
      <section
        aria-label="Actions"
        className="flex items-start gap-3 rounded-xl border border-line bg-surface-sunken px-4 py-3"
      >
        <Lock className="mt-0.5 size-4 shrink-0 text-content-muted" aria-hidden />
        <p className="text-[13px] text-content-muted">
          Your role can view this lead but not act on it. Ask an owner or admin if you need to.
        </p>
      </section>
    );
  }

  const a = availability;
  const stages = opportunity?.stagesAvailable ?? [];
  const book: ActionAvailability =
    a.book.allowed && !bookingConfigured
      ? { allowed: false, reason: "No booking destination is configured. Connect a calendar first." }
      : a.book;
  const menuBusy = pending !== null && pending !== "assign" && pending !== "stage";

  const item = (
    key: string,
    icon: React.ComponentType<{ className?: string }>,
    label: string,
    state: ActionAvailability,
    onSelect: () => void,
    options: { destructive?: boolean; help?: string } = {},
  ) => (
    <DropdownItem
      key={key}
      icon={icon}
      disabled={!state.allowed || pending === key}
      description={!state.allowed ? (state.reason ?? undefined) : options.help}
      destructive={Boolean(options.destructive && state.allowed)}
      onSelect={onSelect}
    >
      {label}
    </DropdownItem>
  );

  return (
    <>
      <section
        aria-labelledby="lead-actions-title"
        className="rounded-xl border border-line bg-surface shadow-xs"
      >
        <div className="border-b border-line-subtle px-5 py-4">
          <h2 id="lead-actions-title" className="text-[15px] font-semibold text-content">
            Actions
          </h2>
          <div className="mt-3 flex items-center gap-2">
            {a.message.allowed ? (
              // A link, not a button: the composer lives on the Conversation tab.
              <Button size="sm" className="flex-1" asChild>
                <Link href={`${leadPageHref(leadId)}#composer`}>
                  <MessageSquare className="size-3.5" aria-hidden />
                  Message
                </Link>
              </Button>
            ) : (
              <Button size="sm" className="flex-1" disabled title={a.message.reason ?? undefined}>
                <MessageSquare className="size-3.5" aria-hidden />
                Message
                {a.message.reason && <span className="sr-only">. {a.message.reason}</span>}
              </Button>
            )}

            <DropdownMenu
              align="end"
              label="Lead actions"
              className="w-72"
              trigger={
                <Button variant="secondary" size="sm" loading={menuBusy} disabled={menuBusy}>
                  Actions
                  <ChevronDown className="size-3.5 text-content-subtle" aria-hidden />
                </Button>
              }
            >
              <DropdownGroup label="Contact">
                {item("book", CalendarPlus, "Send booking link", book, () =>
                  run("book", () => sendBookingLink({ leadId }), "Booking link sent."),
                )}
                {item("unsubscribe", ShieldOff, "Unsubscribe from everything…", a.unsubscribe, () =>
                  setDialog("unsubscribe"),
                )}
              </DropdownGroup>
              <DropdownGroup label="Pipeline">
                {item("note", StickyNote, "Add note…", a.note, () => setDialog("note"))}
                {item("rescore", RefreshCcw, "Re-score", a.rescore, () =>
                  run("rescore", () => rescoreLeadAction({ leadId })),
                )}
                {a.resume.allowed
                  ? item(
                      "resume",
                      Play,
                      HANDOVER_COPY.handBack,
                      a.resume,
                      () => run("resume", () => resumeLeadAction({ leadId })),
                      { help: HANDOVER_COPY.handBackHelp },
                    )
                  : item(
                      "takeover",
                      Hand,
                      HANDOVER_COPY.takeOver,
                      a.takeover,
                      () => run("takeover", () => takeoverLeadAction({ leadId })),
                      { help: HANDOVER_COPY.takeOverHelp },
                    )}
              </DropdownGroup>
              <DropdownGroup label="Outcome">
                {item("won", Trophy, "Mark won…", a.close, () => setCloseOutcome("WON"))}
                {item("lost", XCircle, "Mark lost…", a.close, () => setCloseOutcome("LOST"), {
                  destructive: true,
                })}
              </DropdownGroup>
              <DropdownGroup label="Record">
                {a.restore.allowed
                  ? item("restore", Archive, "Restore", a.restore, () =>
                      run("restore", () => restoreLeadAction({ leadId })),
                    )
                  : item("archive", Archive, "Archive…", a.archive, () => setDialog("archive"), {
                      destructive: true,
                    })}
                <DropdownItem
                  icon={FileLock2}
                  onSelect={() => router.push(leadPageHref(leadId, "data-rights"))}
                >
                  Suppress, export or erase…
                </DropdownItem>
              </DropdownGroup>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <FormField label="Owner" htmlFor="lead-page-owner">
            <Select
              id="lead-page-owner"
              className="text-[13px]"
              disabled={!a.assign.allowed || pending === "assign"}
              title={a.assign.reason ?? undefined}
              value={assignedUserId ?? ""}
              onChange={(event) =>
                run("assign", () => assignLeadAction({ leadId, userId: event.target.value || null }))
              }
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Deal stage"
            htmlFor="lead-page-stage"
            hint={
              !opportunity
                ? "A deal opens when the lead qualifies."
                : opportunity.outcome !== "OPEN"
                  ? "This deal is closed."
                  : undefined
            }
          >
            <Select
              id="lead-page-stage"
              className="text-[13px]"
              disabled={!a.change_stage.allowed || !opportunity || pending === "stage"}
              title={a.change_stage.reason ?? undefined}
              value={opportunity?.outcome === "OPEN" ? opportunity.stage : ""}
              onChange={(event) =>
                opportunity &&
                run("stage", () =>
                  setOpportunityStageAction({ leadId, opportunityId: opportunity.id, stage: event.target.value }),
                )
              }
            >
              {!opportunity || opportunity.outcome !== "OPEN" ? (
                <option value="">{opportunity ? "Closed" : "No deal yet"}</option>
              ) : null}
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABEL[stage as OpportunityStage] ?? stage}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </section>

      {/* ------------------------------------------------------------ note */}
      <Modal
        open={dialog === "note"}
        onClose={() => setDialog(null)}
        title="Add a note"
        description="Notes are visible to everyone in this workspace and appear in the activity log."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDialog(null)} disabled={pending === "note"}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={pending === "note"}
              onClick={async () => {
                if (!note.trim()) {
                  setNoteError("Write a note before saving it.");
                  return;
                }
                const ok = await run("note", () => addLeadNoteAction({ leadId, body: note }));
                if (ok) {
                  setNote("");
                  setDialog(null);
                }
              }}
            >
              Save note
            </Button>
          </>
        }
      >
        <FormField label="Note" htmlFor="lead-note" error={noteError ?? undefined}>
          <Textarea
            id="lead-note"
            rows={5}
            maxLength={4000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteError(null);
            }}
          />
        </FormField>
      </Modal>

      {/* --------------------------------------------------------- archive */}
      <ConfirmDialog
        open={dialog === "archive"}
        variant="warning"
        title="Archive this lead?"
        scope="The lead stops appearing in your lists and all follow-up for it stops."
        consequence="Its history is kept and an owner or admin can restore it."
        confirmLabel="Archive"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const ok = await run("archive", () => archiveLeadAction({ leadId }));
          if (ok) setDialog(null);
        }}
      />

      {/* ----------------------------------------------------- unsubscribe */}
      <ConfirmDialog
        open={dialog === "unsubscribe"}
        variant="warning"
        title="Unsubscribe this lead from everything?"
        scope="Every address held for this lead is added to the do-not-contact list on every channel, recorded as their opt-out."
        consequence="Follow-up stops and nothing is sent to them again from this workspace. Only ClientTurn support can lift the entry, with a recorded reason."
        confirmLabel="Unsubscribe"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const ok = await run(
            "unsubscribe",
            async () => {
              const result = await suppressLeadAction({ leadId, channel: "ALL", reason: "OPT_OUT" });
              return result.ok ? { ok: true, message: result.message } : result;
            },
            "Unsubscribed.",
          );
          if (ok) setDialog(null);
        }}
      />

      <CloseOutcomeDialog
        outcome={closeOutcome}
        onClose={() => setCloseOutcome(null)}
        onSubmit={(outcome, reason) =>
          run(outcome === "WON" ? "won" : "lost", () => closeLeadOutcomeAction({ leadId, outcome, reason }))
        }
      />

    </>
  );
}
