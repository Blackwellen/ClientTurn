"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { renderPreview } from "@/lib/messaging/merge-fields";
import type { Channel } from "@/lib/automations/types";

export type PreviewStep = {
  key: string;
  channel: Channel;
  subject: string | null;
  template: string;
};

/**
 * What a lead actually receives (V4 §19.4).
 *
 * Rendered with `renderPreview`, not the send-path renderer: a token that
 * cannot be filled stays visible here on purpose, so the customer can see
 * exactly which merge field still needs a value rather than being shown a
 * plausible message that would in fact pause at send time.
 */
export function MessagePreviewCard({
  steps,
  values,
}: {
  steps: PreviewStep[];
  /** Real workspace values, so the preview is not invented sample data. */
  values: Record<string, string | null>;
}) {
  const [active, setActive] = React.useState(0);
  const index = Math.min(active, Math.max(steps.length - 1, 0));
  const step = steps[index];

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-info-100 bg-info-50 text-info-600"
        >
          <Eye className="size-4" />
        </span>
        <h3 className="text-[15px] font-semibold text-content">
          Message preview
        </h3>
      </div>

      {steps.length === 0 ? (
        <CardContent className="pt-0">
          <p className="text-[13px] text-content-muted">
            Add a step to see what a lead receives.
          </p>
        </CardContent>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Preview step"
            className="flex items-center gap-1 overflow-x-auto border-b border-line px-3"
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % steps.length
                  : (index - 1 + steps.length) % steps.length;
              setActive(next);
            }}
          >
            {steps.map((item, i) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-medium",
                  "transition-colors duration-[var(--lr-duration-fast)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
                  i === index
                    ? "border-success-600 text-content"
                    : "border-transparent text-content-muted hover:text-content",
                )}
              >
                Step {i + 1}
              </button>
            ))}
          </div>

          <CardContent>
            <div className="rounded-[10px] border border-line bg-surface-sunken/50 p-3.5">
              {step.channel === "email" && (
                <p className="mb-2 text-[13px] font-semibold text-content">
                  Subject:{" "}
                  <span className="font-normal">
                    {renderPreview(step.subject ?? "", values, "follow-up") ||
                      "—"}
                  </span>
                </p>
              )}
              <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-content-secondary">
                {renderPreview(step.template, values, "follow-up") ||
                  "Nothing written yet."}
              </p>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}
