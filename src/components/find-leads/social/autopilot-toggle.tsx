"use client";

import * as React from "react";
import { Bot, UserCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { setSocialAutopilotAction } from "@/lib/outreach/social-actions";

/**
 * Autopilot or review, where the person deciding can see it.
 *
 * The setting existed — `social_autonomous_sending` on the workspace's data
 * controls — buried three screens from the queue it governs. That is the wrong
 * place for it: the question "is this sending on its own right now?" is asked
 * while looking at the queue, and an answer that requires navigating to
 * Settings to find is one people stop checking.
 *
 * The honest caveat is rendered alongside rather than hidden in a tooltip:
 * autopilot has no effect on an ASSISTED account, because there is no way to
 * send from a personal LinkedIn account without a person. Showing the switch as
 * "on" while nothing sends automatically would be a lie the customer only
 * discovers a week later.
 */
export function AutopilotToggle({
  enabled,
  canManage,
  hasPartnerAccount,
}: {
  enabled: boolean;
  canManage: boolean;
  /** True when at least one account can actually send server-side. */
  hasPartnerAccount: boolean;
}) {
  const [value, setValue] = React.useState(enabled);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function choose(next: boolean) {
    if (next === value) return;
    setError(null);
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setSocialAutopilotAction(next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-content">How this runs</h3>
          <p className="mt-0.5 text-[12px] text-content-muted">
            {value
              ? "Messages are decided, written and sent without waiting for you."
              : "Everything is decided and written for you; you perform the send."}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Outreach mode"
          className="flex shrink-0 rounded-lg border border-line p-0.5"
        >
          {[
            { key: false, label: "Review", Icon: UserCheck },
            { key: true, label: "Autopilot", Icon: Bot },
          ].map(({ key, label, Icon }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={value === key}
              disabled={!canManage || pending}
              onClick={() => choose(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium",
                value === key
                  ? "bg-accent-500 text-white shadow-xs"
                  : "text-content-muted hover:text-content",
                (!canManage || pending) && "cursor-not-allowed opacity-60",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {value && !hasPartnerAccount && (
        // The caveat that stops this being a lie. Stated where the switch is,
        // not in a help article.
        <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-[12px] leading-relaxed text-warning-700">
          Autopilot is on, but none of your connected accounts can send on their own.
          There is no API that sends a connection request or a message from a personal
          LinkedIn account, so these still wait for you — automating one any other way
          is what gets an account restricted. Nothing is being sent without you.
        </p>
      )}

      {error && <p className="mt-2 text-[12px] text-danger-700">{error}</p>}
    </div>
  );
}
