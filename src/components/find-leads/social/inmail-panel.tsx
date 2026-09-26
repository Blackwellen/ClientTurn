"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { shortAgo } from "@/lib/prospects/activity";
import { recordInMailReplyAction, recordInMailSentAction } from "@/lib/outreach/inmail-actions";
import type { InMailPanelData } from "@/lib/outreach/inmail-queries";

/**
 * LinkedIn InMail credits (Phase 3.5). LinkedIn stays ASSISTED: a person sends
 * the InMail in LinkedIn and records it here, and records the reply when one
 * arrives, so the derived balance -- under the account's own subscription
 * (none on Free; 50 a month rolling to 150 on Sales Navigator), with a credit
 * back for a reply within 90 days -- stays true. Nothing here sends anything.
 */
export function InMailPanel({
  data,
  loadError,
  canManage,
}: {
  data: InMailPanelData | null;
  loadError: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function reply(inmailId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordInMailReplyAction({ inmailId });
        if (!result.ok) setError(result.error);
        else router.refresh();
      } catch {
        setError("You do not have permission to record InMail replies.");
      }
    });
  }

  if (loadError || !data) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-content">
          <Mail className="size-4 text-content-subtle" aria-hidden />
          LinkedIn InMail credits
        </h2>
        <p className="mt-1 text-[12.5px] text-content-muted">
          The InMail record could not be read right now. Nothing has changed; try again shortly.
        </p>
      </section>
    );
  }

  const { balance, awaiting } = data;

  if (!data.hasInMail) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-content">
          <Mail className="size-4 text-content-subtle" aria-hidden />
          LinkedIn InMail
        </h2>
        <p className="mt-1 text-[12.5px] text-content-muted">
          {data.tier === "FREE"
            ? "Your LinkedIn account is on the Free plan, which includes no InMail. Invitations and messages after a connection accepts still work."
            : "No LinkedIn sending account is set up, so there are no InMail credits to track."}{" "}
          If you have Premium or Sales Navigator, set it on the account in Settings, Connections.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-content">
          <Mail className="size-4 text-content-accent" aria-hidden />
          LinkedIn InMail credits
        </h2>
        <p className="mt-1 text-[12px] text-content-muted">
          Worked out from the InMails recorded here under {data.basis}. Record each one you send, and each
          reply, so the balance matches LinkedIn&apos;s.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        <div>
          <dd className={balance.balance <= 0 ? "text-[18px] font-semibold text-warning-700" : "text-[18px] font-semibold text-content"}>
            {balance.balance}
          </dd>
          <dt className="text-[11px] text-content-muted">Credits left</dt>
        </div>
        <div>
          <dd className="text-[18px] font-semibold tabular-nums text-content">{balance.sentThisMonth}</dd>
          <dt className="text-[11px] text-content-muted">Sent this month</dt>
        </div>
        <div>
          <dd className="text-[18px] font-semibold tabular-nums text-content">{balance.refundedThisMonth}</dd>
          <dt className="text-[11px] text-content-muted">Credited back this month</dt>
        </div>
        <div>
          <dd className="text-[18px] font-semibold tabular-nums text-content">{balance.awaitingReply}</dd>
          <dt className="text-[11px] text-content-muted">Awaiting a reply</dt>
        </div>
      </dl>
      <p className="px-4 pb-3 text-[11.5px] text-content-subtle">
        Next monthly credits on {formatDate(balance.nextGrantAt)}.
        {balance.balance < 0 && " More InMails are recorded than LinkedIn would allow, so some records are probably wrong."}
      </p>

      {awaiting.length > 0 && (
        <ul className="divide-y divide-line-subtle border-t border-line">
          {awaiting.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-content">{item.name}</span>
                <span className="text-[11.5px] text-content-muted">InMail sent {shortAgo(item.sentAt)}</span>
              </span>
              {canManage && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => reply(item.id)}>
                  <CornerDownLeft className="size-3.5" aria-hidden />
                  Reply received
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="px-4 pb-3 text-[11.5px] text-danger-700">{error}</p>}
    </section>
  );
}

/** "Mark InMail sent" for one prospect in a LinkedIn queue row. */
export function MarkInMailSentButton({ prospectId }: { prospectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || done}
        title={error ?? "Record that you sent this person an InMail on LinkedIn. It uses one credit."}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await recordInMailSentAction({ prospectId });
              if (result.ok) {
                setDone(true);
                router.refresh();
              } else {
                setError(result.error);
              }
            } catch {
              setError("You do not have permission to record InMails.");
            }
          });
        }}
      >
        <Mail className="size-3.5" aria-hidden />
        {done ? "InMail recorded" : "Mark InMail sent"}
      </Button>
      {error && <span className="text-[11px] text-danger-700">{error}</span>}
    </span>
  );
}
