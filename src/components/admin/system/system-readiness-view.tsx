import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CircleHelp, OctagonX, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import type { ReadinessArea, ReadinessReport, ReadinessState } from "@/lib/admin/readiness";

/**
 * Platform readiness (Programme §20).
 *
 * Every row is measured from the running system when the page loads. Nothing
 * here is a checklist someone ticks, because a ticked checklist is green on the
 * day it is filled in and silent about everything that changed afterwards.
 *
 * The design decision worth knowing: **"unknown" is shown as its own state, not
 * folded into green or red.** Backups, for instance, live in the hosting
 * project and this application has never observed one — so the honest answer is
 * that it cannot say, and a release decision is better made against that than
 * against a tick nobody earned.
 */

const STATE_META: Record<
  ReadinessState,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    chip: string;
    dot: string;
  }
> = {
  READY: {
    label: "Ready",
    icon: ShieldCheck,
    chip: "border-success-100 bg-success-50 text-success-700",
    dot: "bg-success-500",
  },
  ATTENTION: {
    label: "Needs attention",
    icon: AlertTriangle,
    chip: "border-warning-100 bg-warning-50 text-warning-700",
    dot: "bg-warning-500",
  },
  BLOCKED: {
    label: "Blocking",
    icon: OctagonX,
    chip: "border-danger-100 bg-danger-50 text-danger-700",
    dot: "bg-danger-500",
  },
  UNKNOWN: {
    label: "Not measurable here",
    icon: CircleHelp,
    chip: "border-line bg-surface-sunken text-content-secondary",
    dot: "bg-content-subtle",
  },
};

export function SystemReadinessView({ report }: { report: ReadinessReport }) {
  const { summary } = report;

  return (
    <div className="space-y-4">
      <Panel
        icon={ShieldCheck}
        title="Release readiness"
        description="Measured from the running system each time this page loads. Nothing here is ticked by hand."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tally label="Ready" value={summary.ready} tone="READY" />
          <Tally label="Needs attention" value={summary.attention} tone="ATTENTION" />
          <Tally label="Blocking" value={summary.blocked} tone="BLOCKED" />
          <Tally label="Not measurable" value={summary.unknown} tone="UNKNOWN" />
        </div>

        {summary.blocked > 0 ? (
          <p className="mt-3 rounded-lg border border-danger-100 bg-danger-50/70 px-3 py-2 text-[12.5px] text-danger-700">
            {summary.blocked === 1 ? "One area is" : `${summary.blocked} areas are`}{" "}
            blocking. These are not judgement calls — the product cannot operate
            correctly until they are resolved.
          </p>
        ) : (
          <p className="mt-3 text-[12px] text-content-subtle">
            Nothing is blocking. &ldquo;Not measurable&rdquo; means this
            application has no way to observe that area — it is not a pass.
          </p>
        )}
      </Panel>

      <div className="space-y-2">
        {report.areas.map((area) => (
          <AreaRow key={area.key} area={area} />
        ))}
      </div>

      <p className="text-[11.5px] text-content-subtle">
        Generated {new Date(report.generatedAt).toLocaleString("en-GB")}.
      </p>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: ReadinessState;
}) {
  const meta = STATE_META[tone];
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={`size-1.5 rounded-full ${meta.dot}`} />
        <span className="text-[11.5px] text-content-muted">{label}</span>
      </span>
      <span className="mt-0.5 block text-[20px] font-semibold tabular-nums text-content">
        {value}
      </span>
    </div>
  );
}

function AreaRow({ area }: { area: ReadinessArea }) {
  const meta = STATE_META[area.state];
  const Icon = meta.icon;

  return (
    <section className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-content-secondary" />
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-content">{area.label}</h3>
            <p className="mt-0.5 text-[12.5px] text-content-secondary">{area.detail}</p>

            {area.evidence.length > 0 && (
              <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                {area.evidence.map((item) => (
                  <div key={item.label} className="flex gap-1.5">
                    <dt className="text-[11.5px] text-content-subtle">{item.label}:</dt>
                    <dd className="text-[11.5px] font-medium tabular-nums text-content">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
          >
            {meta.label}
          </span>
          {area.href && (
            <Link
              href={area.href}
              className="text-content-secondary hover:text-content"
              aria-label={`Open ${area.label}`}
            >
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
