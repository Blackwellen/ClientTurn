"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, MoreHorizontal, PanelLeftOpen, Plus } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { SessionGroup } from "@/lib/find-leads/server/sessions";
import {
  archiveSearchSessionAction,
  createSearchSessionAction,
  duplicateSearchSessionAction,
  renameSearchSessionAction,
} from "@/lib/find-leads/actions";

/**
 * The search sessions rail.
 *
 * Collapsible, because the chat is the point of this page and a permanent rail
 * competes with it on a laptop screen. Collapsed state is per-viewer chrome, so
 * it lives in `localStorage` rather than in the URL — a shared Find Leads link
 * should reproduce what the sender was looking at, not how wide their rail was.
 */

const COLLAPSE_KEY = "ct-find-leads-rail-collapsed";

export function SearchSessionsRail({
  groups,
  activeSessionId,
  totalCount,
}: {
  groups: SessionGroup[];
  activeSessionId?: string | null;
  totalCount: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    // Wrapped: a browser with site data blocked throws on access rather than
    // returning null, and a rail that crashes the page is worse than a rail
    // that forgets it was closed.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore a browser-only preference after hydration; the server has no localStorage.
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* keep the default */
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* the rail still works, it just will not remember */
    }
  };

  const newSearch = () => {
    startTransition(async () => {
      const result = await createSearchSessionAction();
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      router.push(`/app/find-leads/search/${result.data.sessionId}`);
    });
  };

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
        <IconButton
          variant="secondary"
          size="md"
          label="Show search sessions"
          onClick={toggle}
        >
          <PanelLeftOpen className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          variant="secondary"
          size="md"
          label="New search"
          onClick={newSearch}
          disabled={pending}
        >
          <Plus className="size-4" aria-hidden />
        </IconButton>
      </div>
    );
  }

  return (
    <aside
      aria-label="Search sessions"
      className="flex w-full shrink-0 flex-col rounded-xl border border-line bg-surface shadow-xs lg:w-[268px]"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-[14.5px] font-semibold text-content">Search sessions</h2>
        <IconButton
          variant="ghost"
          size="sm"
          label="Hide search sessions"
          onClick={toggle}
          aria-expanded
        >
          <ChevronDown className="size-4" aria-hidden />
        </IconButton>
      </div>

      <div className="px-3 pb-3">
        <Button
          variant="secondary"
          size="md"
          fullWidth
          onClick={newSearch}
          loading={pending}
          className="border-dashed"
        >
          <Plus className="size-4" aria-hidden />
          New search
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {totalCount === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] leading-relaxed text-content-muted">
            Your saved searches will appear here.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mb-3">
              <h3 className="px-1 pb-1.5 pt-1 text-[11.5px] font-semibold uppercase tracking-wide text-content-subtle">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <SessionRow
                      session={session}
                      active={session.id === activeSessionId}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {totalCount > 0 && (
        <div className="border-t border-line-subtle px-4 py-3">
          <Link
            href="/app/find-leads?view=prospects"
            className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Show all sessions →
          </Link>
        </div>
      )}
    </aside>
  );
}

function SessionRow({
  session,
  active,
}: {
  session: SessionGroup["sessions"][number];
  active: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const act = (run: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: success });
      router.refresh();
    });
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg transition-colors",
        active ? "bg-accent-50" : "hover:bg-surface-hover",
      )}
    >
      <Link
        href={`/app/find-leads/search/${session.id}`}
        aria-current={active ? "page" : undefined}
        className="block rounded-lg px-2.5 py-2 pr-8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              active ? "text-content-accent" : "text-content",
            )}
          >
            {session.title}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-content-subtle">
            {relativeLabel(session.updatedAt)}
          </span>
        </div>
        <span className="mt-0.5 block text-[11.5px] tabular-nums text-content-muted">
          {session.prospectsFound.toLocaleString("en-GB")} prospects
        </span>
      </Link>

      <div className="absolute right-1 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu
          trigger={
            <IconButton variant="ghost" size="xs" label={`Actions for ${session.title}`}>
              <MoreHorizontal className="size-3.5" aria-hidden />
            </IconButton>
          }
        >
          <DropdownItem
            onSelect={() => {
              const title = window.prompt("Rename this search", session.title);
              if (title && title.trim()) {
                act(() => renameSearchSessionAction(session.id, title), "Search renamed.");
              }
            }}
          >
            Rename
          </DropdownItem>
          <DropdownItem
            onSelect={() =>
              act(async () => {
                const result = await duplicateSearchSessionAction(session.id);
                if (result.ok) router.push(`/app/find-leads/search/${result.data.sessionId}`);
                return result;
              }, "Search duplicated.")
            }
          >
            Duplicate
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            // Archive, not delete. The runs and prospects this search produced
            // are provenance for records the workspace still holds, and
            // removing the search would orphan them.
            onSelect={() =>
              act(() => archiveSearchSessionAction(session.id), "Search archived.")
            }
            disabled={pending}
          >
            Archive
          </DropdownItem>
        </DropdownMenu>
      </div>
    </div>
  );
}

function relativeLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  const days = Math.floor((now.getTime() - date.getTime()) / 864e5);
  if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "short" });
  return `${days}d`;
}
