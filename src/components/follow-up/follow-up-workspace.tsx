"use client";

import * as React from "react";
import { Check, FileText, Plus, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { SequenceEditor, type DraftStep } from "./sequence-editor";
import { ChannelPolicyCard } from "./channel-policy-card";
import { MessagePreviewCard } from "./message-preview-card";
import { SenderIdentityCard } from "./sender-identity-card";
import { EstimatedUsageCard, MergeFieldsCard } from "./usage-and-fields";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import {
  createAutomation,
  updateFollowUpSequence,
} from "@/lib/automations/actions";
import {
  MAX_SEQUENCE_STEPS,
  validateSequence,
} from "@/lib/follow-up/types";
import { fallbackPreview } from "@/lib/follow-up/channel-policy";
import type { AutomationDetail, Channel, StepInput } from "@/lib/automations/types";
import type { SenderHealth } from "@/lib/outreach/campaigns/sender";
import { cn } from "@/lib/cn";

export type ChannelContextView = {
  available: Record<Channel, boolean>;
  fallbackEnabled: boolean;
  senderAvailable: boolean;
  senderIssue: string | null;
  policyAllows: Record<Channel, boolean>;
  smsConnected: boolean;
  whatsappEnabled: boolean;
  whatsappTemplateReady: boolean;
  policyName: string;
  senders: SenderHealth[];
  defaultSenderId: string | null;
};

function newKey() {
  return `step-${Math.random().toString(36).slice(2, 10)}`;
}

function toDraft(
  steps: AutomationDetail["steps"],
  defaultSenderId: string | null,
): DraftStep[] {
  return steps.map((step) => ({
    key: step.id,
    delaySeconds: step.delaySeconds,
    channel: step.channel,
    subject: step.channel === "email" ? (step.subject ?? "") : null,
    template: step.template,
    senderIdentityId: step.senderIdentityId ?? defaultSenderId,
    enabled: step.enabled,
  }));
}

function toInputs(rows: DraftStep[], senderId: string | null): StepInput[] {
  return rows.map((row) => ({
    delaySeconds: row.delaySeconds,
    channel: row.channel,
    subject: row.channel === "email" ? (row.subject ?? "") : null,
    template: row.template,
    senderIdentityId: row.channel === "email" ? senderId : null,
    enabled: row.enabled,
  }));
}

/**
 * The Sequence view of `/app/follow-up` (V4 §19.4).
 *
 * Owns the unsaved draft so that the sequence list, the message preview, the
 * usage estimate and the save bar are all reading the same thing. Splitting
 * that state would let the preview show a message the editor no longer holds,
 * which is precisely the kind of quiet lie this page must not tell.
 *
 * Nothing here decides whether a message may be sent. It renders what the
 * server said is configurable; `ChannelPolicyService` decides per lead, at send
 * time, every time.
 */
export function FollowUpWorkspace({
  automation,
  canEdit,
  context,
  previewValues,
}: {
  automation: AutomationDetail | null;
  canEdit: boolean;
  context: ChannelContextView;
  /** Real workspace values, so the preview is never invented sample data. */
  previewValues: Record<string, string | null>;
}) {
  const { toast } = useToast();
  const [senderId, setSenderId] = React.useState<string | null>(
    context.defaultSenderId,
  );
  const [steps, setSteps] = React.useState<DraftStep[]>(() =>
    automation ? toDraft(automation.steps, context.defaultSenderId) : [],
  );
  const [saving, setSaving] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  // Re-seed when the server sends a new version (after a publish, or when a
  // different sequence is opened).
  const signature = React.useMemo(
    () =>
      JSON.stringify(
        automation
          ? toInputs(toDraft(automation.steps, context.defaultSenderId), senderId)
          : [],
      ),
    // `senderId` is deliberately excluded: changing the sender must not look
    // like the server sent a new sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [automation, context.defaultSenderId],
  );
  const [seeded, setSeeded] = React.useState(signature);
  if (seeded !== signature) {
    setSeeded(signature);
    setSteps(automation ? toDraft(automation.steps, context.defaultSenderId) : []);
  }

  const edited = JSON.stringify(toInputs(steps, senderId)) !== signature;
  // A draft saved earlier but never published is still unpublished work.
  const dirty = edited || (automation?.editingIsDraft ?? false);

  const issues = validateSequence(steps, {
    unknownTokensFor: findUnknownMergeFields,
    whatsappEnabled: context.whatsappEnabled,
    available: context.available,
  });

  function addStep() {
    if (steps.length >= MAX_SEQUENCE_STEPS) {
      toast({
        variant: "error",
        title: `A sequence can hold at most ${MAX_SEQUENCE_STEPS} steps.`,
      });
      return;
    }
    // Default to whichever channel the workspace can actually use, preferring
    // email — the channel every warm lead has, and the one V4 made first-class.
    const channel: Channel = context.available.email
      ? "email"
      : context.available.sms
        ? "sms"
        : "email";

    setSteps((rows) => [
      ...rows,
      {
        key: newKey(),
        delaySeconds: rows.length === 0 ? 0 : 86400,
        channel,
        subject: channel === "email" ? "" : null,
        template: "",
        senderIdentityId: senderId,
        enabled: true,
      },
    ]);
  }

  async function createSequence() {
    setCreating(true);
    try {
      const result = await createAutomation({ type: "new_lead" });
      toast(
        result.ok
          ? { variant: "success", title: "Follow-up sequence created" }
          : { variant: "error", title: result.error },
      );
    } finally {
      setCreating(false);
    }
  }

  async function publish() {
    if (!automation) return;
    setSaving(true);
    try {
      const result = await updateFollowUpSequence({
        automationId: automation.id,
        name: automation.name,
        steps: toInputs(steps, senderId),
      });
      toast(
        result.ok
          ? { variant: "success", title: "Follow-up sequence updated" }
          : { variant: "error", title: result.error },
      );
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setSteps(automation ? toDraft(automation.steps, context.defaultSenderId) : []);
    setSenderId(context.defaultSenderId);
  }

  if (!automation) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={FileText}
            title="No follow-up sequence yet"
            description="A sequence chases every new lead automatically until they reply, book, or the sequence ends. Nothing sends until you publish it."
            action={
              canEdit ? (
                <Button onClick={createSequence} loading={creating}>
                  <Plus className="size-3.5" />
                  Create follow-up sequence
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    );
  }

  const usesEmail = steps.some((step) => step.channel === "email");
  const fallbackLines = fallbackPreview(
    steps.map((step) => step.channel),
    context.available,
    { fallbackEnabled: context.fallbackEnabled },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ sequence */}
        <Card className="min-w-0">
          <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
            <SectionHeader
              icon={FileText}
              tone="info"
              title="Follow-up sequence"
              description="Send a series of automated messages across multiple channels to engage warm leads."
            />
            {canEdit && (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="secondary" onClick={addStep}>
                  <Plus className="size-3.5" aria-hidden />
                  Add step
                </Button>
              </div>
            )}
          </CardHeader>

          <CardContent className="space-y-3 px-5 pt-4 pb-5">
            <SequenceEditor
              steps={steps}
              canEdit={canEdit}
              available={context.available}
              whatsappEnabled={context.whatsappEnabled}
              onChange={setSteps}
              onAdd={addStep}
            />

            {canEdit && steps.length > 0 && (
              <button
                type="button"
                onClick={addStep}
                className={cn(
                  "border-line text-content hover:bg-surface-hover hover:border-line-strong",
                  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-4 text-[13px] font-medium",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-content-accent focus-visible:outline-2 focus-visible:outline-offset-2",
                )}
              >
                <Plus className="text-content-muted size-4" aria-hidden />
                Add another step
              </button>
            )}

            {steps.length > 0 && fallbackLines.length > 0 && (
              <div className="rounded-lg border border-line bg-surface-sunken/50 px-3.5 py-3">
                <p className="text-[12.5px] font-semibold text-content">
                  If a channel is unavailable
                </p>
                <ul className="mt-1 space-y-0.5">
                  {fallbackLines.map((line) => (
                    <li key={line} className="text-[12.5px] text-content-muted">
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11.5px] text-content-subtle">
                  ClientTurn never switches channel silently. Every substitution
                  is recorded, and a lead with no permitted channel is raised for
                  a person to look at.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* --------------------------------------------- right rail */}
        <div className="min-w-0 space-y-4">
          <ChannelPolicyCard
            context={{
              available: context.available,
              fallbackEnabled: context.fallbackEnabled,
              senderAvailable: context.senderAvailable,
              senderIssue: context.senderIssue,
              policyAllows: context.policyAllows,
              smsConnected: context.smsConnected,
              whatsappEnabled: context.whatsappEnabled,
              whatsappTemplateReady: context.whatsappTemplateReady,
              policyName: context.policyName,
              senders: context.senders,
              defaultSenderId: context.defaultSenderId,
            }}
            canEdit={canEdit}
          />

          <MessagePreviewCard
            steps={steps.map((step) => ({
              key: step.key,
              channel: step.channel,
              subject: step.subject,
              template: step.template,
            }))}
            values={previewValues}
          />
        </div>
      </div>

      {/* ------------------------------------------- bottom rail */}
      <div className="grid gap-4 lg:grid-cols-3">
        {usesEmail ? (
          <SenderIdentityCard
            senders={context.senders}
            value={senderId}
            onChange={setSenderId}
            canEdit={canEdit}
          />
        ) : (
          <Card>
            <CardContent>
              <p className="text-[13px] font-medium text-content">
                No email steps
              </p>
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                Add an email step to choose which mailbox it sends from.
              </p>
            </CardContent>
          </Card>
        )}

        <EstimatedUsageCard steps={steps} />
        <MergeFieldsCard />
      </div>

      {steps.length > 0 && (
        <SaveBar
          issues={issues}
          canEdit={canEdit}
          dirty={dirty}
          saving={saving}
          onDiscard={discard}
          onPublish={publish}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- save bar */

function SaveBar({
  issues,
  canEdit,
  dirty,
  saving,
  onDiscard,
  onPublish,
}: {
  issues: { key: string; message: string }[];
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const valid = issues.length === 0;

  return (
    <div
      // Announced when validity flips, so a keyboard or screen-reader user
      // learns the sequence became publishable without hunting for the button.
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3.5",
        valid
          ? "border-success-100 bg-success-50"
          : "border-danger-100 bg-danger-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
          valid ? "bg-success-500" : "bg-danger-500",
        )}
      >
        {valid ? (
          <Check className="size-4" strokeWidth={3} />
        ) : (
          <TriangleAlert className="size-4" />
        )}
      </span>

      <div className="min-w-[11rem] flex-1">
        {valid ? (
          <>
            <p className="text-content text-[13px] font-semibold">
              Sequence looks good!
            </p>
            <p className="text-content-secondary mt-0.5 text-[12.5px]">
              All steps are properly configured and comply with channel policy.
            </p>
          </>
        ) : (
          <>
            <p className="text-danger-700 text-[13px] font-semibold">
              {issues.length === 1
                ? "One thing to fix before publishing"
                : `${issues.length} things to fix before publishing`}
            </p>
            <ul className="text-content-secondary mt-1 space-y-0.5 text-[13px]">
              {issues.slice(0, 4).map((issue) => (
                <li key={issue.key}>{issue.message}</li>
              ))}
              {issues.length > 4 && (
                <li className="text-content-subtle">
                  and {issues.length - 4} more.
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={onDiscard} disabled={!dirty}>
            Discard changes
          </Button>
          <Button
            variant="success"
            onClick={onPublish}
            loading={saving}
            disabled={!valid || !dirty}
          >
            Update sequence
          </Button>
        </div>
      )}
    </div>
  );
}
