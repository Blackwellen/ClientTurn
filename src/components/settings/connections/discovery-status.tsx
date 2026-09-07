import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Database } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATUS_META, type ServiceStatus } from "@/lib/status/types";

/**
 * Discovery providers (V4 §25.9).
 *
 * Sourcing, enrichment and verification providers are platform-managed: the
 * customer does not connect them, does not hold credentials for them, and has
 * no account with them. So this card deliberately shows one thing — whether
 * they are working — and nothing else.
 *
 * What is absent is the point. There is no API key, no provider account id, no
 * endpoint, no per-provider cost and no waterfall ordering, because all of
 * those are platform-confidential and none of them would help a customer.
 *
 * The state comes from the same `StatusService` the public status page reads,
 * so this card and status.clientturn.com cannot disagree.
 */
export function DiscoveryStatusCard({
  status,
}: {
  status: ServiceStatus;
}) {
  const meta = STATUS_META[status];

  const summary =
    status === "OPERATIONAL"
      ? "All prospect, enrichment and verification providers are running normally."
      : status === "MAINTENANCE"
        ? "Planned maintenance is in progress. Sourcing may be briefly slower."
        : status === "DEGRADED"
          ? "One or more providers are degraded. Sourcing may return fewer results than usual."
          : "Sourcing is currently unavailable. Runs already queued will resume automatically.";

  return (
    <section
      aria-labelledby="discovery-heading"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
          >
            <Database className="size-4" />
          </span>
          <div className="min-w-0">
            <h3
              id="discovery-heading"
              className="text-[14px] font-semibold text-content"
            >
              Discovery
            </h3>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Platform providers used for prospect sourcing, enrichment and
              verification.
            </p>
          </div>
        </div>

        {/* Status is never colour-only: the chip carries its word. */}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
            status === "OPERATIONAL"
              ? "border-success-100 bg-success-50 text-success-700"
              : status === "OUTAGE"
                ? "border-danger-100 bg-danger-50 text-danger-700"
                : status === "MAINTENANCE"
                  ? "border-line bg-surface-sunken text-content-muted"
                  : "border-warning-100 bg-warning-50 text-warning-700",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              status === "OPERATIONAL"
                ? "bg-success-500"
                : status === "OUTAGE"
                  ? "bg-danger-500"
                  : status === "MAINTENANCE"
                    ? "bg-content-subtle"
                    : "bg-warning-500",
            )}
          />
          {meta.label}
        </span>
      </div>

      <p className="mt-3 text-[12.5px] leading-[1.45] text-content-secondary">
        {summary}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
        <p className="text-[11.5px] text-content-subtle">
          These providers are managed by ClientTurn. There is nothing to connect
          and no credentials to hold.
        </p>
        <Link
          href="/status"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-content-accent hover:underline"
        >
          View provider status
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
