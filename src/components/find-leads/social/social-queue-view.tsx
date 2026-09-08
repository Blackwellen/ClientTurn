"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Handshake,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ChannelReality } from "./channel-reality";
import { AutopilotToggle } from "./autopilot-toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { shortAgo } from "@/lib/prospects/activity";
import { gradeTone } from "@/lib/prospects/types";
import type {
  SocialDraft,
  SocialQueue,
  SocialQueueRow,
} from "@/lib/outreach/social-outreach";
import {
  recordSocialReplyAction,
  sendSocialMessageAction,
} from "@/lib/outreach/social-actions";

/**
 * The social work queue (V4 §16, social channels).
 *
 * Organised around the scarce resource, which is the account's daily allowance
 * rather than the number of prospects. If three invites are left today they
 * should go to the three best prospects, so every list is ordered by score and
 * the remaining capacity is stated at the top rather than discovered on the
 * fourth click.
 *
 * "Ready to message" is deliberately first. Someone who accepted a connection
 * request and has not been messaged is the most perishable opportunity in the
 * product — they remember you today and will not in a fortnight.
 */
export function SocialQueueView({
  queue,
  canManage,
  plan,
  funnel,
  autopilot,
  signals,
}: {
  queue: SocialQueue;
  canManage: boolean;
  /** The sequence diagram, rendered on the server and passed in. */
  plan?: React.ReactNode;
  /** The Found → Contacted → Replied → Interested panel. */
  funnel?: React.ReactNode;
  /** Whether the workspace has opted into sending without a person. */
  autopilot?: boolean;
  /** The signals feeding this agent. */
  signals?: React.ReactNode;
}) {
  const {
    accounts,
    drafts,
    readyToInvite,
    readyToMessage,
    awaitingAcceptance,
    staleInvites,
  } = queue;

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface">
        <EmptyState
          icon={Handshake}
          title="No social account connected"
          description="Connect a LinkedIn, Facebook, Instagram or TikTok account to reach prospects there. You connect or follow first, and message once they accept."
          action={
            canManage ? (
              <Link
                href="/app/settings?section=connections"
                className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Connect an account
              </Link>
            ) : undefined
          }
        />
        {/* Shown here above all: this is the screen where somebody decides
            which platforms to connect, and the difference between them is
            large enough that choosing without knowing it wastes weeks. */}
        <div className="border-t border-line p-4">
          <ChannelReality />
        </div>
      </div>
    );
  }

  // Whether anything could actually send on its own. An ASSISTED account never
  // can, and showing autopilot as active while nothing sends would be a lie the
  // customer discovers a week later.
  const hasPartnerAccount = accounts.some(
    (account) => account.sendMode === "PARTNER_API" && account.status === "ACTIVE",
  );

  return (
    <div className="space-y-4">
      <AutopilotToggle
        enabled={autopilot ?? false}
        canManage={canManage}
        hasPartnerAccount={hasPartnerAccount}
      />

      {funnel}

      {signals}

      <ChannelReality />

      {plan}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-content">
                  {account.displayName}
                </p>
                <p className="text-[11.5px] text-content-muted">
                  {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()} ·{" "}
                  {account.tier.replace(/_/g, " ").toLowerCase()}
                </p>
              </div>
              <Badge
                tone={account.capacity.blockedReason ? "warning" : "success"}
                dense
                dot
              >
                {account.capacity.blockedReason ? "Paused" : "Ready"}
              </Badge>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              <Capacity label="Invites" value={account.capacity.connectsLeftToday} />
              <Capacity label="Messages" value={account.capacity.messagesLeftToday} />
              <Capacity
                label="Notes"
                value={account.capacity.notesLeftThisMonth}
                hint="Personalised invitation notes left this month. Running out is not a blocker — invites still send without one."
              />
            </dl>

            {account.capacity.blockedReason && (
              <p className="mt-2 text-[11.5px] text-warning-700">
                {account.capacity.blockedReason}
              </p>
            )}

            {account.sendMode === "ASSISTED" && !account.capacity.blockedReason && (
              <p className="mt-2 text-[11px] text-content-subtle">
                You send from your own account; ClientTurn tracks the state and the limits.
              </p>
            )}
          </div>
        ))}
      </div>

      {staleInvites.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-100 bg-warning-50 px-4 py-3">
          <p className="flex items-center gap-2 text-[12.5px] text-warning-700">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">{staleInvites.length}</strong> invite
              {staleInvites.length === 1 ? " has" : "s have"} been pending for three weeks or
              more. Each one keeps consuming your weekly allowance — withdrawing them frees
              that capacity up.
            </span>
          </p>
        </div>
      )}

      {drafts.length > 0 && (
        <section className="rounded-xl border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-content">
              <Send className="size-4 text-content-accent" aria-hidden />
              Written and waiting to be sent
              <Badge tone="accent" dense>
                {drafts.length}
              </Badge>
            </h2>
            <p className="mt-1 text-[12px] text-content-muted">
              ClientTurn decided these were due, checked the limits and contactability, and
              wrote them. All that is left is sending them from your own account — copy the
              message, open the profile, then mark it sent so the follow-up is timed from
              the right moment.
            </p>
          </header>
          <ul className="divide-y divide-line">
            {drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} canManage={canManage} />
            ))}
          </ul>
        </section>
      )}

      <QueueSection
        icon={MessageSquare}
        title="Ready to message"
        description="They accepted. This is the most perishable list in the product — they remember you now."
        rows={readyToMessage}
        empty="Nobody is waiting on a message."
        tone="success"
      />

      <QueueSection
        icon={Send}
        title="Ready to invite"
        description="Approved, eligible, and with a profile to reach. Ordered by score, because your daily allowance is the scarce thing."
        rows={readyToInvite}
        empty="No approved prospects with a social profile yet."
        tone="accent"
      />

      <QueueSection
        icon={Clock}
        title="Waiting on them"
        description="Invites sent. Nothing further can happen until they accept — that wait is the platform's, not a delay we set."
        rows={awaitingAcceptance}
        empty="No invites are outstanding."
        tone="neutral"
        showPending
      />
    </div>
  );
}

/**
 * One composed message, and the two things a person can do with it.
 *
 * Both buttons are wrong in different directions if pressed carelessly, which
 * is why neither is combined with the copy action. "I have sent this" advances
 * the sequence clock, so pressing it without actually sending means the
 * follow-up chases a message nobody received. "They replied" stops the
 * sequence and may create a Lead. Neither is undoable from this screen.
 */
function DraftRow({ draft, canManage }: { draft: SocialDraft; canManage: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [showReply, setShowReply] = React.useState(false);
  const [reply, setReply] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The browser can refuse clipboard access. The body is on screen and
      // selectable, so this is a convenience failing rather than the task.
      setError("Copying was blocked by the browser. Select the message and copy it.");
    }
  }

  function markSent() {
    setError(null);
    startTransition(async () => {
      const result = await sendSocialMessageAction({
        prospectId: draft.prospectId,
        platform: draft.platform,
        accountId: draft.accountId,
        messageBody: draft.body,
      });
      if (!result.ok) setError(result.error);
    });
  }

  function submitReply() {
    if (!reply.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await recordSocialReplyAction({
        prospectId: draft.prospectId,
        platform: draft.platform,
        body: reply,
      });
      if (result.ok) {
        setReply("");
        setShowReply(false);
      } else {
        setError(result.error);
      }
    });
  }

  const kindLabel =
    draft.kind === "INVITE_NOTE"
      ? "Invitation note"
      : draft.kind === "OPENER"
        ? "First message"
        : `Follow-up ${Math.max(1, draft.sequenceStep - 1)}`;

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-content">{draft.name}</p>
          <p className="truncate text-[11.5px] text-content-muted">
            {draft.companyName ?? "No company recorded"} · {kindLabel}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Which composer wrote it. A customer is entitled to know whether
              the words going out under their name came from a model. */}
          <Badge tone={draft.composedBy === "AI" ? "accent" : "neutral"} dense>
            {draft.composedBy === "AI" ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" aria-hidden />
                Written for this person
              </span>
            ) : (
              "Standard message"
            )}
          </Badge>
          {draft.profileUrl && (
            <a
              href={draft.profileUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Open profile
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </div>

      <p className="mt-2.5 whitespace-pre-wrap rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] leading-relaxed text-content">
        {draft.body}
      </p>

      {draft.fallbackReason && (
        <p className="mt-1.5 text-[11px] text-content-subtle">{draft.fallbackReason}</p>
      )}

      {canManage && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={copy} disabled={pending}>
            {copied ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy message"}
          </Button>
          <Button size="sm" onClick={markSent} disabled={pending}>
            <Send className="size-3.5" aria-hidden />
            I have sent this
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowReply((open) => !open)}
            disabled={pending}
          >
            <CornerDownLeft className="size-3.5" aria-hidden />
            They replied
          </Button>
        </div>
      )}

      {showReply && (
        <div className="mt-2.5">
          <label
            className="text-[11.5px] font-medium text-content-muted"
            htmlFor={`reply-${draft.id}`}
          >
            Paste what they said. It is classified, the sequence stops, and anything that
            reads as an opt-out suppresses them on every channel.
          </label>
          <textarea
            id={`reply-${draft.id}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-content"
          />
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" onClick={submitReply} disabled={pending || !reply.trim()}>
              Record reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowReply(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[11.5px] text-danger-700">{error}</p>}
    </li>
  );
}

function Capacity({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  const body = (
    <div className="min-w-0">
      <dd
        className={cn(
          "text-[17px] font-semibold leading-none tabular-nums",
          value === 0 ? "text-warning-700" : "text-content",
        )}
      >
        {value}
      </dd>
      <dt className="mt-1 truncate text-[11px] text-content-muted">{label}</dt>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

function QueueSection({
  icon: Icon,
  title,
  description,
  rows,
  empty,
  tone,
  showPending,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  rows: SocialQueueRow[];
  empty: string;
  tone: "success" | "accent" | "neutral";
  showPending?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Icon
              className={cn(
                "size-4 shrink-0",
                tone === "success"
                  ? "text-success-600"
                  : tone === "accent"
                    ? "text-content-accent"
                    : "text-content-subtle",
              )}
              aria-hidden
            />
            {title}
            <span className="font-normal tabular-nums text-content-subtle">
              {rows.length}
            </span>
          </h2>
          <p className="mt-0.5 text-[12px] text-content-muted">{description}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-subtle">
          {rows.slice(0, 12).map((row) => (
            <li
              key={`${row.prospectId}-${row.platform}`}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <Link
                  href={`/app/find-leads?view=prospects&prospect=${row.prospectId}`}
                  className="text-[12.5px] font-medium text-content underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
                <p className="truncate text-[11.5px] text-content-muted">
                  {row.companyName ?? "No company recorded"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {showPending && row.pendingDays !== null && (
                  <span
                    className={cn(
                      "text-[11.5px] tabular-nums",
                      row.pendingDays >= 21 ? "text-warning-700" : "text-content-subtle",
                    )}
                  >
                    {row.pendingDays}d pending
                  </span>
                )}
                {row.acceptedAt && !showPending && (
                  <span className="text-[11.5px] text-content-subtle">
                    accepted {shortAgo(row.acceptedAt)}
                  </span>
                )}
                {row.grade && (
                  <Badge tone={gradeTone(row.grade as never)} dense className="tabular-nums">
                    {row.grade}
                    {row.score !== null && (
                      <span className="ml-1 font-normal opacity-70">
                        {Math.round(row.score)}
                      </span>
                    )}
                  </Badge>
                )}
                {row.profileUrl && (
                  <a
                    href={row.profileUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Open ${row.name}'s profile`}
                    className="text-content-subtle transition-colors hover:text-content-accent"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/app/find-leads?view=prospects&prospect=${row.prospectId}`}>
                    Open
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 12 && (
        <p className="mt-2 text-[11.5px] text-content-subtle">
          Showing the 12 highest-scoring of {rows.length}.
        </p>
      )}
    </section>
  );
}
