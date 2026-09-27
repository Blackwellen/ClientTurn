"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PanelEmpty } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import {
  COST_LINES,
  belowFloorOnly,
  sortWorkspaces,
  type SortKey,
  type WorkspaceEconomics,
} from "@/lib/admin/economics-model";
import { gbp, percent } from "./format";

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
  none: "No plan",
};

function MarginBadge({ margin, below }: { margin: number | null; below: boolean }) {
  if (margin === null) {
    return (
      <Badge tone="neutral" dense>
        No revenue
      </Badge>
    );
  }
  return (
    <Badge tone={below ? "danger" : "success"} dense>
      {percent(margin)}
    </Badge>
  );
}

/**
 * Per-workspace economics, sortable, with the "below 75%" filter. Worst
 * margin first by default: the table exists to find the workspaces costing
 * more than the rule allows. Horizontal scroll on narrow screens, with the
 * workspace column pinned.
 */
export function WorkspaceTable({ rows, open }: { rows: WorkspaceEconomics[]; open: boolean }) {
  const [sort, setSort] = React.useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "margin",
    direction: "asc",
  });
  const [belowOnly, setBelowOnly] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    const filtered = belowOnly ? belowFloorOnly(rows) : rows;
    return sortWorkspaces(filtered, sort.key, sort.direction);
  }, [rows, belowOnly, sort]);

  const belowCount = React.useMemo(() => belowFloorOnly(rows).length, [rows]);

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
        className={cn("px-3 py-2 font-medium", align === "right" && "text-right")}
      >
        <button
          type="button"
          onClick={() =>
            setSort((current) => ({
              key,
              direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
            }))
          }
          className={cn(
            "inline-flex items-center gap-1 uppercase tracking-wide hover:text-content",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            active && "text-content",
          )}
        >
          {label}
          {active &&
            (sort.direction === "asc" ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            ))}
        </button>
      </th>
    );
  };

  const columns = open ? 8 : 7;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-4 py-2.5 sm:px-5">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-content-secondary">
          <input
            type="checkbox"
            checked={belowOnly}
            onChange={(event) => setBelowOnly(event.target.checked)}
            className="size-4 rounded border-line accent-danger-600"
          />
          Below 75% only
          <Badge tone={belowCount > 0 ? "danger" : "neutral"} dense>
            {belowCount}
          </Badge>
        </label>
        <p className="text-[11.5px] text-content-subtle">
          {visible.length} of {rows.length} workspaces
          {open ? " · below 75% counts month to date or projected month end" : ""}
        </p>
      </div>

      {visible.length === 0 ? (
        <PanelEmpty>
          {belowOnly
            ? "No workspace is below 75% in this period."
            : "No workspace used anything or was billed in this period."}
        </PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-y border-line text-[11px] uppercase tracking-wide text-content-muted">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium sm:px-5">
                  <button
                    type="button"
                    onClick={() =>
                      setSort((current) => ({
                        key: "name",
                        direction: current.key === "name" && current.direction === "asc" ? "desc" : "asc",
                      }))
                    }
                    className="uppercase tracking-wide hover:text-content"
                  >
                    Workspace
                  </button>
                </th>
                {header("plan", "Plan", "left")}
                {header("revenue", "Revenue")}
                {header("cost", "Cost")}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Gross profit
                </th>
                {header("margin", "Margin")}
                {open && header("projected", "Month end")}
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Not measured
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {visible.map((row) => {
                const isOpen = expanded === row.businessId;
                return (
                  <React.Fragment key={row.businessId}>
                    <tr className={cn(row.belowFloor && "bg-danger-50/40")}>
                      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 sm:px-5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} cost breakdown for ${row.name}`}
                            onClick={() => setExpanded(isOpen ? null : row.businessId)}
                            className="rounded p-0.5 text-content-subtle hover:bg-surface-hover hover:text-content"
                          >
                            {isOpen ? (
                              <ChevronDown className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronRight className="size-3.5" aria-hidden />
                            )}
                          </button>
                          <Link
                            href={`/admin/customers?customer=${row.businessId}`}
                            className="max-w-[180px] truncate text-[13px] font-medium text-content hover:text-content-accent"
                          >
                            {row.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-content-secondary">
                        {PLAN_LABEL[row.plan] ?? row.plan}
                        {row.interval === "annual" && (
                          <span className="ml-1 text-[11px] text-content-subtle">annual</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                        {row.revenue.total === null ? (
                          <span title="Contract price is not stored locally">not recorded</span>
                        ) : (
                          gbp(row.revenue.total)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                        {gbp(row.totalCost)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-[12.5px] tabular-nums",
                          row.grossProfit !== null && row.grossProfit < 0 ? "text-danger-600" : "text-content",
                        )}
                      >
                        {gbp(row.grossProfit)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <MarginBadge margin={row.margin} below={row.belowFloor} />
                      </td>
                      {open && (
                        <td className="px-3 py-2.5 text-right">
                          <MarginBadge
                            margin={row.projected?.margin ?? null}
                            below={row.projected?.belowFloor ?? false}
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-[11.5px] text-content-muted sm:px-5">
                        {row.notMeasured.length === 0
                          ? "—"
                          : row.notMeasured.map((key) => COST_LINES[key].label).join(", ")}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={columns} className="bg-surface-sunken px-4 py-3 sm:px-5">
                          <Breakdown row={row} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Breakdown({ row }: { row: WorkspaceEconomics }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {row.lines.map((line) => (
        <div key={line.key} className="flex items-baseline justify-between gap-3 text-[12px]">
          <span className="text-content-muted">
            {COST_LINES[line.key].label}
            {COST_LINES[line.key].kind === "allocation" && (
              <span className="ml-1 text-[10.5px] uppercase tracking-wide text-content-subtle">allocation</span>
            )}
            {line.note && <span className="block text-[11px] text-content-subtle">{line.note}</span>}
          </span>
          <span className="shrink-0 tabular-nums text-content">
            {line.value === null ? <em className="not-italic text-warning-700">not measured</em> : gbp(line.value)}
          </span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-content-muted">Leads · qualified</span>
        <span className="tabular-nums text-content">
          {row.leads} · {row.qualifiedLeads}
        </span>
      </div>
      {row.revenue.credits > 0 && (
        <div className="flex items-baseline justify-between gap-3 text-[12px]">
          <span className="text-content-muted">Top-up revenue (in total)</span>
          <span className="tabular-nums text-content">{gbp(row.revenue.credits)}</span>
        </div>
      )}
    </div>
  );
}
