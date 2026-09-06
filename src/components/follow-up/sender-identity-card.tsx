"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, CircleAlert, Info, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { SenderHealth } from "@/lib/outreach/campaigns/sender";

/**
 * Which mailbox warm email goes out from, and whether that mailbox is in a fit
 * state to send (V4 §19.5).
 *
 * Everything shown is read from the daily domain/mailbox health snapshots. A
 * tick beside DKIM means a real DNS check passed — there is no optimistic
 * default, and an unknown result renders as unknown rather than as valid.
 *
 * The selection here is a preference. The dispatcher re-resolves and
 * re-validates the identity immediately before every send, so a mailbox that
 * degrades after this page was rendered still stops the send.
 */
export function SenderIdentityCard({
  senders,
  value,
  onChange,
  canEdit,
}: {
  senders: SenderHealth[];
  value: string | null;
  onChange: (senderId: string) => void;
  canEdit: boolean;
}) {
  const selected = senders.find((sender) => sender.id === value) ?? senders[0] ?? null;

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-info-100 bg-info-50 text-info-600"
        >
          <Mail className="size-4" />
        </span>
        <h3 className="text-[15px] font-semibold text-content">
          Sender identity
        </h3>
      </div>

      <CardContent className="space-y-3 pt-0">
        {senders.length === 0 ? (
          <div className="rounded-[10px] border border-warning-100 bg-warning-50/70 p-3">
            <p className="text-[13px] font-medium text-content">
              No sending identity yet
            </p>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Email steps cannot send until a mailbox is connected and verified.
            </p>
            <Link
              href="/app/settings?section=connections"
              className="mt-1.5 inline-block text-[12.5px] font-medium text-content-accent hover:underline"
            >
              Connect a mailbox
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="Sending identity"
                  value={selected?.id ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => onChange(event.target.value)}
                >
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.email}
                    </option>
                  ))}
                </Select>
              </div>
              {selected && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    selected.status === "VERIFIED"
                      ? "border-success-100 bg-success-50 text-success-700"
                      : "border-warning-100 bg-warning-50 text-warning-700",
                  )}
                >
                  {selected.status === "VERIFIED" ? (
                    <BadgeCheck className="size-3.5" aria-hidden />
                  ) : (
                    <CircleAlert className="size-3.5" aria-hidden />
                  )}
                  {selected.status === "VERIFIED" ? "Verified" : "Not verified"}
                </span>
              )}
            </div>

            {selected && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <AuthChip label="SPF" state={selected.spf} />
                  <AuthChip label="DKIM" state={selected.dkim} />
                  <AuthChip label="DMARC" state={selected.dmarc} />

                  <span className="inline-flex items-center gap-1 text-[12.5px] text-content-muted">
                    {reputationLabel(selected)}
                    <Tooltip content={selected.warmSummary}>
                      <span
                        tabIndex={0}
                        className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                      >
                        <Info className="size-3.5 text-content-subtle" aria-hidden />
                        <span className="sr-only">
                          What this reputation is based on
                        </span>
                      </span>
                    </Tooltip>
                  </span>
                </div>

                {selected.warmState !== "HEALTHY" && (
                  <p className="text-[12.5px] text-warning-700">
                    {selected.warmSummary}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Never renders a tick for a state we did not actually verify. */
function AuthChip({ label, state }: { label: string; state: string }) {
  const pass = state === "PASS";
  const missing = state === "MISSING" || state === "UNKNOWN";

  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content">
      {label}
      <span
        className={cn(
          "text-[12.5px] font-normal",
          pass
            ? "text-success-600"
            : missing
              ? "text-content-subtle"
              : "text-danger-600",
        )}
      >
        {pass ? "✓" : missing ? "—" : "✕"}
      </span>
      <span className="sr-only">
        {pass ? "passing" : state === "FAIL" ? "failing" : "not verified"}
      </span>
    </span>
  );
}

function reputationLabel(sender: SenderHealth): string {
  if (sender.warmState === "BLOCKED") return "Sending blocked";
  if (sender.warmState === "WARNING") return "Reputation needs watching";
  return "Good reputation";
}
