"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { listCopilotInsights } from "@/lib/copilot/actions";
import type { CopilotInsight } from "@/lib/copilot/insights";

/**
 * The Insights tab (V4 §28.12).
 *
 * Every insight is arithmetic over the workspace's own records, produced by the
 * same rules the Analytics page uses. Nothing here is generated, so an empty
 * list is a correct answer rather than a failure to fill space.
 */
export function CopilotInsights() {
  const [insights, setInsights] = React.useState<CopilotInsight[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let active = true;
    listCopilotInsights()
      .then((rows) => {
        if (!active) return;
        setInsights(rows);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {state === "loading" && (
        <ul className="space-y-2.5" aria-hidden>
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="h-[72px] animate-pulse rounded-xl border border-line bg-surface-sunken/60"
            />
          ))}
        </ul>
      )}

      {state === "error" && (
        <p role="alert" className="text-[13px] text-danger-600">
          Insights could not be loaded. Please try again.
        </p>
      )}

      {state === "ready" && insights.length === 0 && (
        <div className="rounded-xl border border-line bg-surface-sunken/50 px-4 py-10 text-center">
          <Lightbulb aria-hidden className="mx-auto size-6 text-content-subtle" />
          <p className="mt-2 text-[13.5px] font-medium text-content">
            Nothing worth flagging yet
          </p>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Insights appear once there is enough activity to compare. Nothing is
            invented to fill the space.
          </p>
        </div>
      )}

      {state === "ready" && insights.length > 0 && (
        <ul className="space-y-2.5">
          {insights.map((insight) => (
            <li key={insight.key}>
              <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      insight.tone === "positive"
                        ? "bg-success-500"
                        : insight.tone === "attention"
                          ? "bg-warning-500"
                          : "bg-info-500",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-content">
                      {insight.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[1.45] text-content-muted">
                      {insight.body}
                    </p>
                    {insight.href && (
                      <Link
                        href={insight.href}
                        className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-content-accent hover:underline"
                      >
                        Take a look
                        <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
