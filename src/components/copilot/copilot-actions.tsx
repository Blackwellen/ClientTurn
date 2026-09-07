"use client";

import * as React from "react";
import { Lock, Play, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { runCopilotTool } from "@/lib/copilot/actions";
import { COPILOT_TOOLS, type ToolDeclaration } from "@/lib/copilot/types";
import { ConfirmToolDialog } from "./confirm-tool-dialog";

/**
 * The Actions tab (V4 §28.6).
 *
 * Lists exactly what Copilot can do, which is as much a safety feature as a
 * convenience: a customer can see the whole surface, and can see that it does
 * not include sending outreach, enabling overage, or editing a locked fact.
 *
 * Actions needing an argument this panel cannot supply — a campaign to pause,
 * a lead to assign — are shown but not runnable from here; they are offered in
 * Chat, where the object is already in context.
 */
export function CopilotActions({ sessionId }: { sessionId: string | null }) {
  const [confirming, setConfirming] = React.useState<ToolDeclaration | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  const reads = COPILOT_TOOLS.filter((tool) => tool.kind === "READ");
  const writes = COPILOT_TOOLS.filter((tool) => tool.kind === "WRITE");

  async function run(tool: ToolDeclaration, confirmed: boolean) {
    setPending(true);
    setResult(null);
    try {
      const outcome = await runCopilotTool({
        sessionId,
        tool: tool.name,
        args: {},
        confirmed,
      });
      setResult(outcome.ok ? outcome.data.summary : outcome.error);
    } finally {
      setPending(false);
      setConfirming(null);
    }
  }

  /**
   * A tool that acts on one record cannot be run from a bare list with no
   * argument. Read from the declaration rather than from a list of names kept
   * here: the catalogue is now partly derived from the service registry, and a
   * hardcoded exception list would silently fall out of step with it.
   */
  const runnable = (tool: ToolDeclaration) =>
    tool.kind === "READ" && !tool.needsObject && tool.name !== "getCampaign";

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div className="flex gap-2.5 rounded-lg border border-info-100 bg-info-50/70 px-3 py-2.5">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-info-600" />
        <p className="text-[12px] leading-[1.45] text-content-secondary">
          Copilot runs the same actions the app does, with your permissions. It
          cannot send outreach, change budgets, enable overage, contact a
          suppressed prospect, or edit a locked business fact.
        </p>
      </div>

      <Section title="Read" description="Copilot can look these up for you.">
        {reads.map((tool) => (
          <li key={tool.name}>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-content">
                  {tool.summary}
                </span>
                <span className="block text-[11px] text-content-subtle">
                  {tool.scope === "viewer" ? "Any member" : `${cap(tool.scope)} and above`}
                </span>
              </span>
              {runnable(tool) && (
                <Button
                  size="xs"
                  variant="secondary"
                  loading={pending}
                  onClick={() => void run(tool, false)}
                >
                  <Play className="size-3" aria-hidden />
                  Run
                </Button>
              )}
            </div>
          </li>
        ))}
      </Section>

      <Section
        title="Act"
        description="These change something. High-impact ones ask first."
      >
        {writes.map((tool) => (
          <li key={tool.name}>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-content">
                  {tool.summary}
                </span>
                <span className="block text-[11px] text-content-subtle">
                  {cap(tool.scope)} and above
                </span>
              </span>
              {tool.requiresConfirmation && (
                <Badge tone="warning" dense className="shrink-0">
                  <Lock className="size-2.5" aria-hidden />
                  Confirms
                </Badge>
              )}
            </div>
          </li>
        ))}
      </Section>

      {result && (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-[12.5px]",
            "border-line bg-surface-sunken/60 text-content-secondary",
          )}
        >
          {result}
        </p>
      )}

      {confirming && (
        <ConfirmToolDialog
          tool={confirming.name}
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run(confirming, true)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-content">{title}</h3>
      <p className="mt-0.5 text-[11.5px] text-content-muted">{description}</p>
      <ul className="mt-2 space-y-1.5">{children}</ul>
    </section>
  );
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
