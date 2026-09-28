"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  MessageSquareReply,
  RefreshCw,
  Settings2,
  SkipForward,
  UserPlus,
} from "lucide-react";
import type { LinkedInAssistBoard } from "@/lib/linkedin-assist/queries";
import {
  bodyLimitFor,
  canSnooze,
  INMAIL_CREDIT_CEILING,
  LINKEDIN_ACCOUNT_TIERS,
  LINKEDIN_ASSIST_LIMITS,
  TASK_KIND_LABEL,
  taskInstruction,
  type LinkedInAccountTier,
  type LinkedInAssistSettings,
  type LinkedInTaskView,
} from "@/lib/linkedin-assist/types";
import {
  addLinkedInContact,
  logLinkedInReply,
  markLinkedInTaskSent,
  moveLinkedInContact,
  redraftLinkedInTask,
  saveLinkedInAssistSettings,
  skipLinkedInTask,
  snoozeLinkedInTask,
} from "@/lib/linkedin-assist/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, FormError } from "@/components/ui/feedback";
import { FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

const TIER_LABEL: Record<LinkedInAccountTier, string> = {
  FREE: "Free",
  PREMIUM: "Premium",
  SALES_NAVIGATOR: "Sales Navigator",
};

type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = React.useTransition();
  const run = React.useCallback(
    (fn: () => Promise<ActionResult>, success?: string, after?: (data: unknown) => void) => {
      start(async () => {
        const result = await fn();
        if (!result.ok) {
          toast({ variant: "error", title: "That did not work", description: result.error });
          return;
        }
        if (success) toast({ variant: "success", title: success });
        after?.(result.data);
        router.refresh();
      });
    },
    [router, toast],
  );
  return { pending, run };
}

export function LinkedInAssistBoardView({ board }: { board: LinkedInAssistBoard }) {
  const [showSettings, setShowSettings] = React.useState(!board.configured);
  const actionable = board.tasks.filter((task) => !task.blocked);
  const stopped = board.tasks.filter((task) => task.blocked);
  const held = board.pace.held.connections + board.pace.held.messages + board.pace.held.inmails;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            <span className="font-semibold text-content">Today</span>
            <span className="text-content-secondary">
              {board.pace.remaining.connections} connection {board.pace.remaining.connections === 1 ? "request" : "requests"} left
            </span>
            <span className="text-content-secondary">{board.pace.remaining.messages} messages left</span>
            {held > 0 && <Badge tone="warning">{held} held for another day</Badge>}
            {board.pace.paused && <Badge tone="warning">Paused</Badge>}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setShowSettings((value) => !value)}
              aria-expanded={showSettings}
            >
              <Settings2 className="size-3.5" aria-hidden />
              Pacing
            </Button>
          </div>
          {board.pace.notesExhausted && (
            <p className="mt-2 text-[12.5px] text-content-muted">
              Your free LinkedIn account has used this month&apos;s personalised notes, so connection requests go without one.
            </p>
          )}
        </Card>

        {showSettings && <SettingsPanel settings={board.settings} onDone={() => setShowSettings(false)} />}

        {actionable.length === 0 ? (
          <Card>
            <EmptyState
              icon={UserPlus}
              title={board.activeContacts > 0 ? "Nothing more for today" : "Your LinkedIn list is empty"}
              description={
                board.activeContacts > 0
                  ? held > 0
                    ? "You have reached today's pacing. The rest are held for the coming days."
                    : board.upcoming > 0
                      ? `${board.upcoming} follow-up${board.upcoming === 1 ? " is" : "s are"} scheduled for the coming days.`
                      : "Add more people with a LinkedIn profile to keep going."
                  : "Add a lead or prospect with a LinkedIn profile. We write the note; you send it from your own account."
              }
            />
          </Card>
        ) : (
          <ol className="space-y-3" aria-label="Today's LinkedIn tasks">
            {actionable.map((task) => (
              <li key={task.id}>
                <TaskCard task={task} notesExhausted={board.pace.notesExhausted} />
              </li>
            ))}
          </ol>
        )}

        {stopped.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Stopped</CardTitle>
              <CardDescription>These no longer need doing. Clear them from your list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-3">
              {stopped.map((task) => (
                <StoppedRow key={task.id} task={task} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <AddPanel board={board} />
        <Card>
          <CardHeader>
            <CardTitle>Assisted by design</CardTitle>
            <CardDescription>
              ClientTurn never logs in to LinkedIn, runs a browser extension or sends on your behalf. It writes and
              paces; you send. That is what keeps your account safe.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ task */

function TaskCard({ task, notesExhausted }: { task: LinkedInTaskView; notesExhausted: boolean }) {
  const { pending, run } = useAction();
  const { toast } = useToast();
  const [body, setBody] = React.useState(task.body ?? "");
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [reply, setReply] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const limit = bodyLimitFor(task.kind);
  const withoutNote = task.kind === "CONNECTION_NOTE" && notesExhausted;
  const moves = task.moves.filter((move) => move.allowed);

  // A fresh draft from the server replaces the edit box (adjusting state on a
  // prop change during render, not in an effect).
  const [seenBody, setSeenBody] = React.useState(task.body);
  if (seenBody !== task.body) {
    setSeenBody(task.body);
    setBody(task.body ?? "");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      toast({ variant: "success", title: "Copied", description: "Paste it into LinkedIn." });
    } catch {
      toast({ variant: "error", title: "Could not copy", description: "Select the text and copy it yourself." });
    }
  }

  const sourceLabel =
    task.bodySource === "AI"
      ? "Written by AI"
      : task.bodySource === "AGENT"
        ? "Suggested by the assistant"
        : task.bodySource === "PERSON"
          ? "Your words"
          : "Standard message";

  return (
    <Card className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-content">{task.name}</p>
          {task.subtitle && <p className="truncate text-[12.5px] text-content-muted">{task.subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={task.kind === "REPLY" ? "success" : "accent"}>
            {TASK_KIND_LABEL[task.kind]}
            {task.kind === "FOLLOW_UP" && task.step > 1 ? ` · follow-up ${task.step - 1}` : ""}
          </Badge>
          <Badge tone="neutral">{task.leadId ? "Lead" : "Prospect"}</Badge>
        </div>
      </div>

      <p className="mt-2 text-[12.5px] text-content-secondary">{taskInstruction(task.kind, task.step, notesExhausted)}</p>

      {task.inboundBody && (
        <blockquote className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2 text-[13px] text-content-secondary whitespace-pre-wrap">
          {task.inboundBody}
        </blockquote>
      )}

      {!withoutNote && (
        <FormField
          className="mt-3"
          label={task.kind === "REPLY" ? "Your reply" : "Message"}
          htmlFor={`body-${task.id}`}
          hint={`${sourceLabel} · ${body.length}/${limit} characters`}
          error={body.length > limit ? `Keep it under ${limit} characters.` : undefined}
        >
          <Textarea
            id={`body-${task.id}`}
            rows={task.kind === "CONNECTION_NOTE" ? 3 : 5}
            value={body}
            placeholder={task.drafting ? "The assistant is writing a suggested reply. Refresh in a moment, or write your own." : ""}
            onChange={(event) => setBody(event.target.value)}
          />
        </FormField>
      )}
      {task.fallbackReason && <p className="mt-1.5 text-[12px] text-content-muted">{task.fallbackReason}</p>}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button asChild size="sm" variant="secondary">
          <a href={task.profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
            Open profile
          </a>
        </Button>
        {!withoutNote && (
          <Button size="sm" variant="secondary" onClick={copy} disabled={!body}>
            <Copy className="size-3.5" aria-hidden />
            Copy message
          </Button>
        )}
        <Button
          size="sm"
          loading={pending}
          disabled={(!withoutNote && !body.trim() && task.kind !== "CONNECTION_NOTE") || body.length > limit}
          onClick={() =>
            run(
              () =>
                markLinkedInTaskSent({
                  taskId: task.id,
                  body: withoutNote ? undefined : body,
                  withoutNote: withoutNote || undefined,
                }),
              "Marked sent",
            )
          }
        >
          <Check className="size-3.5" aria-hidden />
          Mark sent
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => skipLinkedInTask({ taskId: task.id }), "Skipped")}>
          <SkipForward className="size-3.5" aria-hidden />
          Skip
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setReplyOpen((value) => !value)} aria-expanded={replyOpen}>
          <MessageSquareReply className="size-3.5" aria-hidden />
          Log reply
        </Button>
        {canSnooze(task.kind, task.step, task.snoozeCount) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => snoozeLinkedInTask({ taskId: task.id }), "We'll check again later")}
          >
            <Clock className="size-3.5" aria-hidden />
            Not accepted yet
          </Button>
        )}
        {task.kind !== "REPLY" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => redraftLinkedInTask({ taskId: task.id }), "Rewritten")}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Rewrite
          </Button>
        )}
      </div>

      {replyOpen && (
        <div className="mt-3 space-y-2 rounded-md border border-line p-3">
          <FormField
            label="Paste their reply"
            htmlFor={`reply-${task.id}`}
            hint="The assistant drafts your answer. Its rules decide what it may say; nothing is sent until you send it."
          >
            <Textarea id={`reply-${task.id}`} rows={4} value={reply} onChange={(event) => setReply(event.target.value)} />
          </FormField>
          <FormError message={error} />
          <Button
            size="sm"
            loading={pending}
            disabled={!reply.trim()}
            onClick={() =>
              run(
                async () => {
                  const result = await logLinkedInReply({ taskId: task.id, body: reply });
                  setError(result.ok ? null : result.error);
                  return result;
                },
                "Reply logged",
                (data) => {
                  setReply("");
                  setReplyOpen(false);
                  if ((data as { optedOut?: boolean } | undefined)?.optedOut) {
                    toast({
                      variant: "warning",
                      title: "They asked not to be contacted",
                      description: "They are now on your do-not-contact list and off every sequence.",
                    });
                  }
                },
              )
            }
          >
            Save reply
          </Button>
        </div>
      )}

      {moves.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="inline-flex items-center gap-1 text-[12px] text-content-muted">
            <ArrowRightLeft className="size-3.5" aria-hidden />
            Move to
          </span>
          {moves.map((move) => (
            <MoveButton key={move.channel} taskId={task.id} channel={move.channel} title={move.reason} />
          ))}
        </div>
      )}
    </Card>
  );
}

function MoveButton({ taskId, channel, title }: { taskId: string; channel: "email" | "sms" | "call"; title: string }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const label = channel === "email" ? "Email" : channel === "sms" ? "SMS" : "Call";
  return (
    <Button
      size="xs"
      variant="secondary"
      title={title}
      loading={pending}
      onClick={() =>
        run(
          () => moveLinkedInContact({ taskId, channel }),
          `Moved to ${label.toLowerCase()}`,
          (data) => {
            const href = (data as { href?: string } | undefined)?.href;
            if (href) router.push(href);
          },
        )
      }
    >
      {label}
    </Button>
  );
}

function StoppedRow({ task }: { task: LinkedInTaskView }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-content">{task.name}</p>
        <p className="text-[12px] text-content-muted">{task.blocked}</p>
      </div>
      <Button size="xs" variant="ghost" loading={pending} onClick={() => run(() => skipLinkedInTask({ taskId: task.id }))}>
        Clear
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- adding */

function AddPanel({ board }: { board: LinkedInAssistBoard }) {
  const { pending, run } = useAction();
  const [leadId, setLeadId] = React.useState("");
  const [profileUrl, setProfileUrl] = React.useState("");
  const [firstTouch, setFirstTouch] = React.useState<"CONNECTION_NOTE" | "INMAIL">("CONNECTION_NOTE");
  const inmailAvailable = board.settings.monthlyInMailCredits > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add people</CardTitle>
        <CardDescription>Anyone with a LinkedIn profile link. Today&apos;s list fills up to your pacing.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {board.leadOptions.length > 0 && (
          <div className="space-y-2">
            <FormField label="Lead" htmlFor="li-lead">
              <Select id="li-lead" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
                <option value="">Choose a lead</option>
                {board.leadOptions.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Their LinkedIn profile" htmlFor="li-url" hint="linkedin.com/in/their-name">
              <Input
                id="li-url"
                inputMode="url"
                value={profileUrl}
                onChange={(event) => setProfileUrl(event.target.value)}
                placeholder="https://www.linkedin.com/in/…"
              />
            </FormField>
            {inmailAvailable && (
              <FormField label="First step" htmlFor="li-first">
                <Select
                  id="li-first"
                  value={firstTouch}
                  onChange={(event) => setFirstTouch(event.target.value as "CONNECTION_NOTE" | "INMAIL")}
                >
                  <option value="CONNECTION_NOTE">Connection request</option>
                  <option value="INMAIL">InMail (uses a credit)</option>
                </Select>
              </FormField>
            )}
            <Button
              size="sm"
              loading={pending}
              disabled={!leadId || !profileUrl.trim()}
              onClick={() =>
                run(
                  () => addLinkedInContact({ leadId, profileUrl, firstTouch }),
                  "Added to LinkedIn Assist",
                  () => {
                    setLeadId("");
                    setProfileUrl("");
                  },
                )
              }
            >
              <UserPlus className="size-3.5" aria-hidden />
              Add lead
            </Button>
          </div>
        )}

        <div>
          <p className="text-[12.5px] font-semibold text-content">Prospects with a LinkedIn profile</p>
          {board.candidates.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-content-muted">
              None waiting. Prospects found in Find Leads with a LinkedIn profile appear here.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {board.candidates.map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-content">{candidate.name}</p>
                    {candidate.subtitle && <p className="truncate text-[11.5px] text-content-muted">{candidate.subtitle}</p>}
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={pending || !candidate.profileUrl}
                    onClick={() =>
                      run(
                        () =>
                          addLinkedInContact({
                            prospectId: candidate.id,
                            profileUrl: candidate.profileUrl ?? "",
                            firstTouch: "CONNECTION_NOTE",
                          }),
                        "Added to LinkedIn Assist",
                      )
                    }
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- pacing */

function SettingsPanel({ settings, onDone }: { settings: LinkedInAssistSettings; onDone: () => void }) {
  const { pending, run } = useAction();
  const [form, setForm] = React.useState(settings);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof LinkedInAssistSettings>(key: K, value: LinkedInAssistSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const number = (key: "dailyConnectionNotes" | "weeklyConnectionRequests" | "dailyMessages" | "monthlyInMailCredits" | "followUpAfterDays" | "maxFollowUps", max: number, min = 0, label: string, hint?: string) => (
    <FormField label={label} htmlFor={`li-${key}`} hint={hint ?? `Up to ${max}. You can only go lower.`}>
      <Input
        id={`li-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={form[key]}
        onChange={(event) => set(key, Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
      />
    </FormField>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pacing for your account</CardTitle>
        <CardDescription>
          The limits are set well under LinkedIn&apos;s own, so your account stays safe. You can make them lower, never higher.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-3 sm:grid-cols-2">
        <FormField label="Your LinkedIn plan" htmlFor="li-tier">
          <Select
            id="li-tier"
            value={form.accountTier}
            onChange={(event) => {
              const tier = event.target.value as LinkedInAccountTier;
              setForm((current) => ({
                ...current,
                accountTier: tier,
                monthlyInMailCredits: Math.min(current.monthlyInMailCredits, INMAIL_CREDIT_CEILING[tier]),
              }));
            }}
          >
            {LINKEDIN_ACCOUNT_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {TIER_LABEL[tier]}
              </option>
            ))}
          </Select>
        </FormField>
        {number("dailyConnectionNotes", LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes, 0, "Connection requests a day")}
        {number("weeklyConnectionRequests", LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests, 0, "Connection requests a week")}
        {number("dailyMessages", LINKEDIN_ASSIST_LIMITS.dailyMessages, 0, "Messages a day", "Up to 30. Replies to people who wrote to you are never held back.")}
        {number("monthlyInMailCredits", INMAIL_CREDIT_CEILING[form.accountTier], 0, "InMail credits a month", form.accountTier === "FREE" ? "A free account has none." : undefined)}
        {number("followUpAfterDays", LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMax, LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMin, "Days between steps", "Between 3 and 30.")}
        {number("maxFollowUps", LINKEDIN_ASSIST_LIMITS.maxFollowUps, 0, "Follow-ups after the first message", "At most 2, then we stop.")}
        <div className="flex items-end sm:col-span-2">
          <Switch checked={form.paused} onCheckedChange={(value) => set("paused", value)} label="Pause my list (replies still show)" />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <FormError message={error} />
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              run(
                async () => {
                  const result = await saveLinkedInAssistSettings(form);
                  setError(result.ok ? null : result.error);
                  return result;
                },
                "Pacing saved",
                onDone,
              )
            }
          >
            Save pacing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
