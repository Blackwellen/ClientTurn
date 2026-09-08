import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  PRIVATE_REPLY_WINDOW_DAYS,
  privateReplyState,
  remainingLabel,
} from "@/lib/prospects/private-reply-window";

/**
 * The private-reply countdown, rendered.
 *
 * The rule itself lives in `lib/prospects/private-reply-window.ts` so it can be
 * tested without rendering anything. This is only the presentation of it — and
 * the presentation matters, because the deadline it shows expires with no error
 * of any kind. A customer who does not see it has no other way to learn that a
 * prospect has quietly become unreachable.
 */
export function PrivateReplyWindow({
  commentId,
  commentedAt,
  sentAt,
  now,
}: {
  commentId: string | null;
  commentedAt: string | null;
  sentAt: string | null;
  now?: Date;
}) {
  const status = privateReplyState({ commentId, commentedAt, sentAt, now });

  // Nothing to say about somebody who did not comment. This renders beside
  // other social state, and an empty row reading "no reply window" would be
  // noise on every DM-sourced prospect in the list.
  if (status.state === "NONE") return null;

  if (status.state === "SPENT") {
    return (
      <p className="text-[11.5px] text-content-muted">
        <Badge tone="neutral" dense>
          Reply sent
        </Badge>{" "}
        You get one reply per comment, and it went out on{" "}
        {new Date(status.sentAt).toLocaleDateString("en-GB")}. Anything further
        has to wait for them to answer.
      </p>
    );
  }

  if (status.state === "EXPIRED") {
    return (
      <p className="text-[11.5px] text-content-muted">
        <Badge tone="neutral" dense>
          Too late to reply
        </Badge>{" "}
        Their comment is more than {PRIVATE_REPLY_WINDOW_DAYS} days old. Meta
        will not deliver a reply to it, and there is no other way to reach
        somebody who has only commented — they would have to message you, or
        comment again.
      </p>
    );
  }

  // Under a day is worth flagging in amber: it is the last chance, and the
  // sweep runs every five minutes so a person still has time to intervene.
  const urgent = status.hoursLeft <= 24;

  return (
    <p className="text-[11.5px] text-content-muted">
      <Badge tone={urgent ? "warning" : "accent"} dense>
        {remainingLabel(status.hoursLeft)}
      </Badge>{" "}
      They commented, so you may send one direct message — within{" "}
      {PRIVATE_REPLY_WINDOW_DAYS} days of the comment, counted from when they
      posted it rather than from when it was found.
    </p>
  );
}
