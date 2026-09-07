"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Handshake,
  MessageSquare,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { shortAgo } from "@/lib/prospects/activity";
import { gradeTone } from "@/lib/prospects/types";
import type { SocialQueue, SocialQueueRow } from "@/lib/outreach/social-outreach";

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
}: {
  queue: SocialQueue;
  canManage: boolean;
}) {
  const { accounts, readyToInvite, readyToMessage, awaitingAcceptance, staleInvites } =
    queue;

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
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
