"use client";

import * as React from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listCopilotActions } from "@/lib/copilot/actions";
import type { CopilotActionRow } from "@/lib/copilot/types";

const OUTCOME_TONE: Record<
  CopilotActionRow["outcome"],
  "success" | "warning" | "danger" | "neutral"
> = {
  SUCCESS: "success",
  PENDING: "neutral",
  DENIED: "warning",
  FAILED: "danger",
};

const OUTCOME_LABEL: Record<CopilotActionRow["outcome"], string> = {
  SUCCESS: "Successful",
  PENDING: "In progress",
  DENIED: "Refused",
  FAILED: "Failed",
};

/**
 * The History tab (V4 §28.11).
 *
 * Workspace-visible rather than private to whoever ran the action: this is an
 * accountability record. Refused and failed attempts are shown alongside the
 * successful ones — a log that only recorded what worked would be no use
 * during the conversation where it actually matters.
 */
export function CopilotHistory() {
  const [rows, setRows] = React.useState<CopilotActionRow[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    let active = true;
    listCopilotActions()
      .then((data) => {
        if (!active) return;
        setRows(data);
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
        <ul className="space-y-2" aria-hidden>
          {[0, 1, 2, 3].map((row) => (
            <li
              key={row}
              className="h-14 animate-pulse rounded-lg border border-line bg-surface-sunken/60"
            />
          ))}
        </ul>
      )}

      {state === "error" && (
        <p role="alert" className="text-[13px] text-danger-600">
          The action history could not be loaded.
        </p>
      )}

      {state === "ready" && rows.length === 0 && (
        <div className="rounded-xl border border-line bg-surface-sunken/50 px-4 py-10 text-center">
          <History aria-hidden className="mx-auto size-6 text-content-subtle" />
          <p className="mt-2 text-[13.5px] font-medium text-content">
            Nothing yet
          </p>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Every action Copilot takes is recorded here, including any it was
            refused.
          </p>
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <ol className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-line bg-surface px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-content">
                    {row.requestSummary}
                  </p>
                  <p className="mt-0.5 text-[11px] text-content-subtle">
                    {row.actorName ?? "Someone"} ·{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(row.createdAt))}
                    {row.confirmed && " · confirmed"}
                  </p>
                  {row.errorLabel && (
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      {readableError(row.errorLabel)}
                    </p>
                  )}
                </div>
                <Badge tone={OUTCOME_TONE[row.outcome]} dense className="shrink-0">
                  {OUTCOME_LABEL[row.outcome]}
                </Badge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Stored labels are stable slugs; people read sentences. */
function readableError(label: string): string {
  if (label === "insufficient_role") return "You do not have permission for that action.";
  if (label === "domain_service_refused") return "The action was not permitted by the rules that govern it.";
  return "Something went wrong running that action.";
}
