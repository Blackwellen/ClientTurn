"use client";

import * as React from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

/**
 * One provider category, as a panel with its own header and collapse control.
 * The count in the header is computed from the cards actually rendered, so it
 * can never drift from the grid beneath it.
 */
export function ConnectionGroup({
  id,
  title,
  connected,
  total,
  columns,
  children,
}: {
  id: string;
  title: string;
  connected: number;
  total: number;
  /** Card columns at the widest breakpoint; below that the grid steps down. */
  columns: 1 | 2 | 3 | 5;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  const bodyId = `connections-${id}-body`;

  const grid = {
    1: "grid gap-3",
    2: "grid gap-3 sm:grid-cols-2",
    3: "grid gap-3 sm:grid-cols-2 2xl:grid-cols-3",
    5: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5",
  }[columns];

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2
          id={`connections-${id}`}
          className="flex min-w-0 items-baseline gap-2"
        >
          <span className="truncate text-[12.5px] font-bold uppercase tracking-[0.04em] text-content">
            {title}
          </span>
          <span className="lr-tabular shrink-0 text-[12.5px] font-normal text-content-muted">
            ({connected} of {total} connected)
          </span>
        </h2>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-content-muted",
            "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover hover:text-content",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
          )}
        >
          <span className="sr-only">
            {open ? `Collapse ${title}` : `Expand ${title}`}
          </span>
          <ChevronUp
            className={cn(
              "size-4 transition-transform duration-[var(--lr-duration-fast)] motion-reduce:transition-none",
              !open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      <div id={bodyId} hidden={!open} className="flex-1 px-4 pb-4">
        <div className={grid}>{children}</div>
      </div>
    </Card>
  );
}
