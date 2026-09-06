"use client";

import * as React from "react";
import { BarChart3, Braces, Check, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { CHANNEL_LABEL, type Channel } from "@/lib/automations/types";
import { estimateUsage } from "@/lib/follow-up/channel-policy";
import { MERGE_FIELD_OPTIONS } from "@/lib/follow-up/types";

/**
 * Allowance impact for one lead running the whole sequence (V4 §19.10).
 *
 * Deliberately expressed in message credits. Provider wholesale pricing is
 * platform-confidential and never appears on a customer surface; what a
 * customer needs to know is how much of their own allowance a sequence spends.
 */
export function EstimatedUsageCard({
  steps,
}: {
  steps: { channel: Channel; enabled: boolean }[];
}) {
  const usage = estimateUsage(steps);

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-success-100 bg-success-50 text-success-600"
        >
          <BarChart3 className="size-4" />
        </span>
        <h3 className="text-[15px] font-semibold text-content">
          Estimated usage
        </h3>
      </div>

      <CardContent className="pt-0">
        {usage.perChannel.length === 0 ? (
          <p className="text-[13px] text-content-muted">
            No steps are switched on, so this sequence uses no allowance.
          </p>
        ) : (
          <>
            <table className="w-full">
              <caption className="sr-only">
                Messages and allowance credits per channel, for one lead
                completing the whole sequence.
              </caption>
              <tbody>
                {usage.perChannel.map((row) => (
                  <tr key={row.channel}>
                    <th
                      scope="row"
                      className="py-1 text-left text-[13px] font-normal text-content-secondary"
                    >
                      {CHANNEL_LABEL[row.channel]} messages
                    </th>
                    <td className="lr-tabular py-1 pr-4 text-right text-[13px] font-semibold text-content">
                      {row.messages}
                    </td>
                    <td className="lr-tabular py-1 text-right text-[13px] text-content-muted">
                      ~ {row.credits} {row.credits === 1 ? "credit" : "credits"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-2.5 border-t border-line-subtle pt-2.5 text-[12.5px] text-content-muted">
              Estimated allowance usage:{" "}
              <span className="font-semibold text-content">
                ~{usage.totalCredits} message{" "}
                {usage.totalCredits === 1 ? "credit" : "credits"}
              </span>{" "}
              per lead who completes the sequence.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The tokens this surface can actually fill, straight from the canonical
 * registry. The picker cannot offer something the validator would then reject.
 */
export function MergeFieldsCard() {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState<string | null>(null);

  const copy = React.useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(label);
        window.setTimeout(() => setCopied(null), 1600);
      } catch {
        toast({
          variant: "error",
          title: "Could not copy. Select the field and copy it manually.",
        });
      }
    },
    [toast],
  );

  const all = MERGE_FIELD_OPTIONS.map((field) => field.token).join(" ");

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-purple-100 bg-purple-50 text-purple-700"
          >
            <Braces className="size-4" />
          </span>
          <h3 className="text-[15px] font-semibold text-content">
            Available merge fields
          </h3>
        </div>

        <button
          type="button"
          onClick={() => copy(all, "all")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface",
            "px-2.5 py-1 text-[12px] font-medium text-content shadow-xs hover:bg-surface-hover",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
          )}
        >
          {copied === "all" ? (
            <Check className="size-3.5 text-success-600" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied === "all" ? "Copied" : "Copy"}
        </button>
      </div>

      <CardContent className="pt-0">
        <ul className="flex flex-wrap gap-1.5">
          {MERGE_FIELD_OPTIONS.map((field) => (
            <li key={field.token}>
              <button
                type="button"
                title={field.hint}
                onClick={() => copy(field.token, field.token)}
                className={cn(
                  "rounded-md border border-line bg-surface-sunken px-2 py-1",
                  "font-mono text-[11.5px] text-content-secondary",
                  "hover:border-line-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                )}
              >
                {copied === field.token ? "Copied" : field.token}
                <span className="sr-only"> — {field.hint}. Click to copy.</span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
