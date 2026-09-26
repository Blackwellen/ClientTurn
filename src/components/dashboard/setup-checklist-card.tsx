"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { Progress } from "@/components/ui/progress";

export type SetupChecklistItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

const HIDDEN_KEY = "ct-setup-checklist-hidden";

/**
 * "Finish setting up" (Phase 8.29).
 *
 * Onboarding now lets you skip anything optional and go live with the
 * recommended settings, so what you skipped has to be findable afterwards.
 * This is that list, on the dashboard where you land: the same getting-started
 * steps Help shows (`getGettingStarted`), outstanding ones first, each linking
 * to the page where it is done. It disappears once everything is done, and
 * "Hide" puts it away in this browser until something new is outstanding.
 */
export function SetupChecklistCard({ items }: { items: SetupChecklistItem[] }) {
  const outstanding = items.filter((item) => !item.done);
  // A fingerprint of what is outstanding: hiding it hides this list, not every
  // future one.
  const signature = outstanding.map((item) => item.id).join(",");
  const [hidden, setHidden] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === signature);
    } catch {
      setHidden(false);
    }
  }, [signature]);

  // Rendered only after the stored choice is read, so a hidden card never
  // flashes on load.
  if (outstanding.length === 0 || hidden !== false) return null;

  const done = items.length - outstanding.length;
  const ordered = [...outstanding, ...items.filter((item) => item.done)];

  return (
    <Card data-tour="dashboard-setup-checklist">
      <CardHeader className="block">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            title="Finish setting up"
            description={`${done} of ${items.length} done. Pick up anything you skipped, in any order.`}
          />
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(HIDDEN_KEY, signature);
              } catch {
                // Storage unavailable: hide for this visit only.
              }
              setHidden(true);
            }}
            className="text-content-muted hover:bg-surface-hover hover:text-content focus-visible:outline-content-accent -mr-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium focus-visible:outline-2"
          >
            <X className="size-3.5" aria-hidden />
            Hide
          </button>
        </div>
        <Progress
          className="mt-3"
          value={done}
          max={items.length}
          tone="accent"
          label="Setup progress"
        />
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group focus-visible:outline-content-accent -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 focus-visible:outline-2"
              >
                <span
                  aria-hidden
                  className={
                    item.done
                      ? "bg-success-500 mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-white"
                      : "border-line-strong mt-0.5 flex size-4.5 shrink-0 rounded-full border"
                  }
                >
                  {item.done && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      item.done
                        ? "text-content-muted block text-[13px] font-medium line-through"
                        : "text-content block text-[13px] font-medium"
                    }
                  >
                    {item.label}
                    <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                  </span>
                  {!item.done && (
                    <span className="text-content-muted block text-[12.5px]">{item.description}</span>
                  )}
                </span>
                <ArrowUpRight className="text-content-subtle group-hover:text-content-muted mt-0.5 size-3.5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
