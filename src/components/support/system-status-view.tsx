"use client";

import * as React from "react";
import Link from "next/link";
import { readSystemStatus } from "@/lib/support/actions";

type Summary = Awaited<ReturnType<typeof readSystemStatus>>;

const labels = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  OUTAGE: "Outage",
  MAINTENANCE: "Maintenance",
};

export function SystemStatusView() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    readSystemStatus().then((data) => {
      if (active) setSummary(data);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, []);

  return (
    <section className="space-y-4 p-5" aria-label="System status">
      <h2 className="text-lg font-semibold">System status</h2>
      {error ? (
        <p role="alert" className="text-sm text-danger-600">System status could not be loaded. Please try again later.</p>
      ) : !summary ? (
        <p role="status" className="text-sm text-content-muted">Loading system status…</p>
      ) : (
        <>
          <p className="text-sm">{summary.stale ? "Status checks are out of date." : labels[summary.overall]}</p>
          {summary.groups.length === 0 ? (
            <p className="text-sm text-content-muted">No service status is available yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {summary.groups.map((group) => (
                <li key={group.name} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{group.name}</span>
                  <span className="text-content-muted">{labels[group.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Link href="/status" className="inline-block text-sm font-medium text-content-accent underline">View full system status</Link>
    </section>
  );
}
