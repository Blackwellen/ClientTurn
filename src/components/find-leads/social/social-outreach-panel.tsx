"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ExternalLink,
  Handshake,
  MessageSquare,
  Send,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { shortAgo } from "@/lib/prospects/activity";
import {
  MAX_INVITE_NOTE_CHARS,
  MAX_SOCIAL_MESSAGE_CHARS,
  canMessage,
  socialStateLabel,
  socialStateTone,
  type SocialPlatform,
  type SocialState,
} from "@/lib/outreach/social-limits";
import {
  markSocialAcceptedAction,
  markSocialDeclinedAction,
  sendSocialInviteAction,
  sendSocialMessageAction,
  withdrawSocialInviteAction,
} from "@/lib/outreach/social-actions";

/**
 * The connect-then-message panel on a prospect (V4 §16, social channels).
 *
 * The design principle here is that the panel should make the platform's own
 * gate obvious rather than hiding it behind a generic "Send" button. Before
 * acceptance the only thing offered is the invite; after it, the message. A
 * customer who understands *why* they are waiting does not raise a support
 * ticket about it.
 *
 * In assisted mode the buttons record what the person has just done in the
 * platform's own interface. That is why they read "Mark as sent" rather than
 * "Send" — claiming to have sent something we did not send would be a lie the
 * numbers are then built on.
 */

export type SocialPanelState = {
  platform: SocialPlatform;
  state: SocialState;
  profileUrl: string | null;
  noteAttached: boolean;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  messagedAt: string | null;
  /** Server-computed, so rendering stays pure and SSR matches the client. */
  pendingDays: number | null;
};

export type SocialPanelAccount = {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  sendMode: "ASSISTED" | "PARTNER_API";
  connectsLeftToday: number;
  messagesLeftToday: number;
  notesLeftThisMonth: number;
  blockedReason: string | null;
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

/** LinkedIn invites; the rest follow. The wording has to match the platform. */
function inviteVerb(platform: SocialPlatform): string {
  return platform === "LINKEDIN" ? "connection request" : "follow";
}

export function SocialOutreachPanel({
  prospectId,
  prospectName,
  accounts,
  states,
  eligible,
}: {
  prospectId: string;
  prospectName: string;
  accounts: SocialPanelAccount[];
  states: SocialPanelState[];
  /** False when contactability has not been confirmed. Nothing is offered. */
  eligible: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs lg:col-span-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-content">
          <Handshake className="size-4 shrink-0 text-content-accent" aria-hidden />
          Social outreach
        </h3>
        <p className="mt-2 text-[12.5px] text-content-muted">
          No social account is connected yet. Connect one in Settings to reach prospects on
          LinkedIn, Facebook, Instagram or TikTok.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs lg:col-span-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-content">
        <Handshake className="size-4 shrink-0 text-content-accent" aria-hidden />
        Social outreach
      </h3>
      <p className="mt-0.5 text-[12px] text-content-muted">
        You connect first and message once they accept. That order is the platform&rsquo;s
        rule, not ours — a message sent before then either cannot be delivered or is never
        seen.
      </p>

      <div className="mt-3 space-y-3">
        {accounts.map((account) => (
          <PlatformRow
            key={account.id}
            account={account}
            prospectId={prospectId}
            prospectName={prospectName}
            state={states.find((entry) => entry.platform === account.platform) ?? null}
            eligible={eligible}
          />
        ))}
      </div>
    </section>
  );
}

function PlatformRow({
  account,
  prospectId,
  prospectName,
  state,
  eligible,
}: {
  account: SocialPanelAccount;
  prospectId: string;
  prospectName: string;
  state: SocialPanelState | null;
  eligible: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [composing, setComposing] = React.useState<"INVITE" | "MESSAGE" | null>(null);

  const current: SocialState = state?.state ?? "NOT_CONNECTED";
  const platform = account.platform;
  const label = PLATFORM_LABELS[platform];

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: success });
      setComposing(null);
      router.refresh();
    });
  };

  const terminal = current === "DECLINED" || current === "BLOCKED";
  const awaiting = current === "INVITE_SENT" || current === "INVITE_QUEUED";
  const messageable = canMessage(current);

  // Why an action is unavailable is always stated. "Not eligible", "no capacity
  // left today" and "waiting on them" are different answers and the person
  // deciding what to do next needs to know which applies.
  const blocked = !eligible
    ? "Contactability has not been confirmed for this prospect."
    : terminal
      ? current === "DECLINED"
        ? "They did not accept. Sending another request is what gets accounts restricted, so it will not be offered."
        : "They have blocked this account."
      : (account.blockedReason ?? null);

  const pendingDays = state?.pendingDays ?? null;

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[12.5px] font-medium text-content">{label}</span>
          <Badge tone={socialStateTone(current)} dense dot>
            {socialStateLabel(current)}
          </Badge>
          {state?.noteAttached && (
            <Badge tone="neutral" dense>
              note attached
            </Badge>
          )}
        </div>

        {state?.profileUrl && (
          <a
            href={state.profileUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11.5px] text-content-accent underline-offset-4 hover:underline"
          >
            Open profile <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      <p className="mt-1.5 text-[11.5px] text-content-subtle">
        {account.displayName}
        {account.sendMode === "ASSISTED" && " · you send, we track"}
        {" · "}
        {messageable
          ? `${account.messagesLeftToday} messages left today`
          : `${account.connectsLeftToday} ${inviteVerb(platform)}s left today`}
        {platform === "LINKEDIN" && !messageable && (
          <> · {account.notesLeftThisMonth} notes left this month</>
        )}
      </p>

      {blocked ? (
        <p className="mt-2 text-[12px] text-warning-700">{blocked}</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {!awaiting && !messageable && (
            <Button size="sm" disabled={pending} onClick={() => setComposing("INVITE")}>
              <Send className="size-3.5" aria-hidden />
              Send {inviteVerb(platform)}
            </Button>
          )}

          {awaiting && (
            <>
              <Button
                size="sm"
                loading={pending}
                disabled={pending}
                onClick={() =>
                  run(
                    () => markSocialAcceptedAction(prospectId, platform),
                    "Marked as accepted. You can message them now.",
                  )
                }
              >
                <Check className="size-3.5" aria-hidden />
                They accepted
              </Button>

              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      withdrawSocialInviteAction({
                        prospectId,
                        platform,
                        accountId: account.id,
                      }),
                    "Withdrawn. That frees up an invite from your allowance.",
                  )
                }
              >
                <Undo2 className="size-3.5" aria-hidden />
                Withdraw
              </Button>

              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(
                    () => markSocialDeclinedAction(prospectId, platform, false),
                    "Recorded. They will not be invited again.",
                  )
                }
              >
                <Ban className="size-3.5" aria-hidden />
                They declined
              </Button>
            </>
          )}

          {messageable && current !== "MESSAGED" && current !== "REPLIED" && (
            <Button size="sm" disabled={pending} onClick={() => setComposing("MESSAGE")}>
              <MessageSquare className="size-3.5" aria-hidden />
              Message them
            </Button>
          )}

          {(current === "MESSAGED" || current === "REPLIED") && (
            <p className="text-[12px] text-content-muted">
              Messaged {state?.messagedAt ? shortAgo(state.messagedAt) : ""}. The thread is
              on the Conversation tab.
            </p>
          )}
        </div>
      )}

      {awaiting && pendingDays !== null && pendingDays >= 21 && (
        <p className="mt-2 text-[11.5px] text-warning-700">
          Pending for {pendingDays} days. A pending invite keeps counting against your
          weekly allowance — withdrawing it frees that up.
        </p>
      )}

      <SocialComposer
        key={composing ?? "closed"}
        open={composing !== null}
        kind={composing ?? "INVITE"}
        platform={platform}
        prospectName={prospectName}
        accountId={account.id}
        prospectId={prospectId}
        notesLeft={account.notesLeftThisMonth}
        onClose={() => setComposing(null)}
        onDone={(message) => {
          toast({ variant: "success", title: message });
          setComposing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * Composes the invite note or the message.
 *
 * The note field is capped at the platform's own 300 characters and shows the
 * remaining monthly allowance, because on a free LinkedIn account that
 * allowance is the binding constraint and someone about to spend their last one
 * should know it.
 */
function SocialComposer({
  open,
  kind,
  platform,
  prospectName,
  prospectId,
  accountId,
  notesLeft,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: "INVITE" | "MESSAGE";
  platform: SocialPlatform;
  prospectName: string;
  prospectId: string;
  accountId: string;
  notesLeft: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const isInvite = kind === "INVITE";
  const max = isInvite ? MAX_INVITE_NOTE_CHARS : MAX_SOCIAL_MESSAGE_CHARS;
  const noteAvailable = platform === "LINKEDIN" && notesLeft > 0;

  const submit = () => {
    startTransition(async () => {
      const result = isInvite
        ? await sendSocialInviteAction({
            prospectId,
            platform,
            accountId,
            noteBody: noteAvailable ? body : undefined,
          })
        : await sendSocialMessageAction({
            prospectId,
            platform,
            accountId,
            messageBody: body,
          });

      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      onDone(isInvite ? "Recorded. We will track the acceptance." : "Message recorded.");
    });
  };

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title={
        isInvite
          ? `Send a ${inviteVerb(platform)} to ${prospectName}`
          : `Message ${prospectName}`
      }
      description={
        isInvite
          ? "Send it from your own account, then confirm here so the allowance and the follow-up stay accurate."
          : "They have accepted, so this will reach them."
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            loading={pending}
            disabled={pending || (!isInvite && !body.trim())}
            onClick={submit}
          >
            {isInvite ? "Mark as sent" : "Mark as sent"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isInvite && platform === "LINKEDIN" && (
          <p
            className={cn(
              "rounded-lg border px-3 py-2 text-[12px]",
              noteAvailable
                ? "border-line bg-surface-sunken/60 text-content-secondary"
                : "border-warning-100 bg-warning-50 text-warning-700",
            )}
          >
            {noteAvailable
              ? `${notesLeft} personalised notes left this month on this account. A note roughly doubles acceptance.`
              : "No invitation notes left this month. Send the request without one — it still works, and it is not capped as tightly."}
          </p>
        )}

        {(!isInvite || noteAvailable) && (
          <div>
            <Label htmlFor="social-body">{isInvite ? "Note" : "Message"}</Label>
            <Textarea
              id="social-body"
              rows={isInvite ? 4 : 7}
              value={body}
              maxLength={max}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                isInvite
                  ? "One or two lines on why you are getting in touch."
                  : "Keep it short and specific to them."
              }
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-content-subtle">
              {body.length} / {max}
            </p>
          </div>
        )}

        <p className="text-[11.5px] text-content-muted">
          Suppression and quiet hours are checked again when you confirm, so a prospect who
          opted out in the meantime will be refused here rather than contacted.
        </p>
      </div>
    </Modal>
  );
}
