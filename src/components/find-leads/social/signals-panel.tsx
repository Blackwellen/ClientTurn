"use client";

import * as React from "react";
import { Play, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  SIGNAL_KIND_LABELS,
  nextRunLabel,
  signalHealth,
  type Signal,
} from "@/lib/find-leads/signals";
import {
  launchSignalAction,
  setSignalActiveAction,
} from "@/lib/find-leads/signal-actions";

/**
 * The searches feeding this agent, one row each.
 *
 * Previously these ran inside the sourcing waterfall and were invisible: a
 * customer saw a total and could not tell which search produced it, which had
 * stopped working, or run one on demand. A signal that has found nothing for a
 * fortnight is worth turning off and one finding ten a day is worth running
 * more often — neither decision is available from a total.
 *
 * The health word is deliberately three states rather than a count. "47 leads"
 * means nothing without knowing whether that is a week or a morning; what a
 * person needs is whether to leave it, look at it, or switch it off.
 */
export function SignalsPanel({
  signals,
  canManage,
}: {
  signals: Signal[];
  canManage: boolean;
}) {
  if (signals.length === 0) return null;

  const activeCount = signals.filter((signal) => signal.active).length;

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-content">
            <Radar aria-hidden className="size-4 text-content-accent" />
            Signals
            <Badge tone="neutral" dense>
              {activeCount}/{signals.length} active
            </Badge>
          </h3>
          <p className="mt-0.5 text-[12px] text-content-muted">
            The individual searches feeding this agent. Pause the ones that are not
            producing; run one now if you do not want to wait for its schedule.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-line">
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} canManage={canManage} />
        ))}
      </ul>
    </section>
  );
}

function SignalRow({ signal, canManage }: { signal: Signal; canManage: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const [active, setActive] = React.useState(signal.active);
  const [error, setError] = React.useState<string | null>(null);
  const [launched, setLaunched] = React.useState(false);

  // Recomputed from the local `active` so the health word follows the toggle
  // immediately rather than waiting for a round trip.
  const health = signalHealth({ ...signal, active });
  const nextRun = nextRunLabel(signal.nextRunAt);

  function toggle() {
    const next = !active;
    setActive(next);
    setError(null);
    startTransition(async () => {
      const result = await setSignalActiveAction(signal.id, next);
      if (!result.ok) {
        setActive(!next);
        setError(result.error);
      }
    });
  }

  function launch() {
    setError(null);
    startTransition(async () => {
      const result = await launchSignalAction(signal.id);
      if (result.ok) setLaunched(true);
      else setError(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-content">{signal.name}</p>
        <p className="truncate text-[11.5px] text-content-muted">
          {SIGNAL_KIND_LABELS[signal.kind]}
          {signal.query ? ` · ${signal.query}` : ""}
        </p>
      </div>

      <div className="text-right">
        <p className="text-[13px] font-semibold tabular-nums text-content">
          {signal.leadsFound.toLocaleString("en-GB")}
        </p>
        <p className="text-[11px] text-content-subtle">leads found</p>
      </div>

      <Badge
        tone={
          health.tone === "healthy"
            ? "success"
            : health.tone === "quiet"
              ? "warning"
              : "neutral"
        }
        dense
      >
        {health.label}
      </Badge>

      <span
        className={cn(
          "min-w-[7rem] text-right text-[11.5px]",
          nextRun ? "text-content-muted" : "text-content-subtle",
        )}
      >
        {active ? (nextRun ? `Runs ${nextRun}` : "No run scheduled") : "Paused"}
      </span>

      {canManage && (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}>
            {active ? "Pause" : "Resume"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={launch}
            disabled={pending || !active || launched}
          >
            <Play aria-hidden className="size-3.5" />
            {launched ? "Queued" : "Launch now"}
          </Button>
        </div>
      )}

      {(error || health.tone !== "healthy") && (
        <p
          className={cn(
            "w-full text-[11.5px]",
            error ? "text-danger-700" : "text-content-muted",
          )}
        >
          {error ?? health.detail}
        </p>
      )}
    </li>
  );
}
