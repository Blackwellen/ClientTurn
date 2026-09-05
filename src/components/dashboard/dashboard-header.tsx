import * as React from "react";

/**
 * Compact greeting, not a hero: a small uppercase eyebrow over the workspace's
 * own name, with the global date control on the right.
 */
export function DashboardHeader({
  greeting,
  businessName,
  description,
  action,
}: {
  greeting: string;
  businessName: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-content-subtle text-[11px] font-semibold tracking-[0.09em] uppercase">
          {greeting}
        </p>
        <h2 className="text-content mt-1 truncate text-[26px] leading-tight font-bold tracking-[-0.025em] xl:text-[29px]">
          {businessName}
        </h2>
        <p className="text-content-muted mt-1 text-[13.5px]">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
