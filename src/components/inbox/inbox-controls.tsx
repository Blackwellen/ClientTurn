"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canReplyOn, channelLabel } from "@/lib/inbox/types";
import { inboxAction } from "@/lib/inbox/actions";

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
}: {
  id: string;
  channel: string;
  hasLead: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const canReply = canReplyOn(channel, hasLead);

  function run(action: "read" | "archive" | "restore" | "reply") {
    startTransition(async () => {
      try {
        const result = await inboxAction({ id, action, body });
        setError(result.error ?? "");
        if (!result.error) {
          if (action === "reply") setBody("");
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
              onChange={(event) => setBody(event.target.value)}
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
          {hasLead
            ? `Sending from ${channelLabel(channel)} is not connected yet. Reply in the original app.`
            : "This conversation is not linked to a lead, so replies are sent from the original app."}
        </p>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
