"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canReplyOn, channelLabel } from "@/lib/inbox/types";
import { inboxAction } from "@/lib/inbox/actions";

/**
 * One id per composed message, so pressing Send twice on the same draft (or
 * retrying it after a dropped response) is recognised exactly by the server's
 * duplicate check. Undefined where `randomUUID` is unavailable (an insecure
 * origin); the server then falls back to its time-bucketed content key.
 */
function newComposeNonce(): string | undefined {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : undefined;
}

/**
 * Per-conversation actions.
 *
 * Reply is only offered on channels ClientTurn can actually send from, and the
 * disabled case says where to reply instead rather than presenting a box that
 * would fail on submit.
 */
export function InboxControls({
  id,
  channel,
  hasLead,
  archived,
  replyBlockedReason = null,
}: {
  id: string;
  channel: string;
  hasLead: boolean;
  archived: boolean;
  /** Why a reply cannot be sent from here right now (Meta approval, the 24-hour window, LinkedIn). */
  replyBlockedReason?: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  // Tied to the draft: kept across retries of the same text, replaced when the
  // text changes or the reply is sent.
  const nonceRef = React.useRef<string | undefined>(undefined);
  if (nonceRef.current === undefined) nonceRef.current = newComposeNonce();
  // The same text in another conversation is another message.
  React.useEffect(() => {
    nonceRef.current = newComposeNonce();
  }, [id]);
  const [error, setError] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const canReply = canReplyOn(channel, hasLead) && !replyBlockedReason;

  function run(action: "read" | "archive" | "restore" | "reply") {
    startTransition(async () => {
      try {
        const result = await inboxAction(
          action === "reply"
            ? { id, action, body, clientNonce: nonceRef.current }
            : { id, action },
        );
        setError(result.error ?? "");
        if (!result.error) {
          if (action === "reply") {
            setBody("");
            nonceRef.current = newComposeNonce();
          }
          router.refresh();
        }
      } catch {
        setError("You need member access to manage conversations.");
      }
    });
  }

  return (
    <div className="space-y-3 border-t border-line p-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("read")}>
          Mark read
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(archived ? "restore" : "archive")}
        >
          {archived ? "Restore" : "Archive"}
        </Button>
      </div>

      {canReply ? (
        <div className="space-y-2">
          <label className="block text-[12px] font-medium text-content-secondary">
            Reply
            <textarea
              value={body}
              maxLength={1200}
              rows={3}
              onChange={(event) => {
                setBody(event.target.value);
                nonceRef.current = newComposeNonce();
              }}
              className="mt-1.5 w-full rounded-md border border-line-strong bg-surface p-2.5 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
            />
          </label>
          <Button
            size="sm"
            loading={pending}
            disabled={!body.trim()}
            onClick={() => run("reply")}
          >
            Send reply
          </Button>
        </div>
      ) : (
        <p className="text-[11.5px] text-content-muted">
          {replyBlockedReason
            ? replyBlockedReason
            : hasLead
            ? `Sending from ${channelLabel(channel)} is not connected yet. Reply in the original app.`
            : "This conversation is not linked to a lead, so replies are sent from the original app."}
        </p>
      )}

      <FormError message={error} />
    </div>
  );
}
