"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, MoreHorizontal } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import type { SearchSessionView } from "@/lib/find-leads/types";
import type { SearchPlan } from "@/lib/find-leads/plan";
import { SearchConversation } from "./search-conversation";
import { StructuredPlanPanel } from "./structured-plan-panel";
import { SourcingControls } from "./sourcing-controls";
import {
  archiveSearchSessionAction,
  duplicateSearchSessionAction,
  previewBudgetAction,
  renameSearchSessionAction,
  updateSearchPlanAction,
} from "@/lib/find-leads/actions";

/**
 * The search session (V4 §10).
 *
 * Conversation on the left at roughly 58%, plan and controls on the right.
 * The split is the product argument made visible: the customer talks, and what
 * their words became is beside it, editable, before anything is spent.
 *
 * Plan edits are optimistic locally and authoritative server-side. The server
 * clamps the target and the cost cap to what the workspace may actually run,
 * and the clamped plan replaces the local one — so the panel always shows what
 * will happen, not what was asked for.
 */

export function SearchSessionView({
  session,
  initialBudget,
  canManage,
}: {
  session: SearchSessionView;
  initialBudget: {
    maxTarget: number;
    maxProviderCostMinor: number;
    allowed: boolean;
    reason: string;
  };
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [plan, setPlan] = React.useState<SearchPlan>(session.plan);
  const [budget, setBudget] = React.useState(initialBudget);
  const [saving, startSaving] = React.useTransition();

  // A refreshed session (a new agent turn landed) replaces the local draft.
  const [previousPlan, setPreviousPlan] = React.useState(session.plan);
  if (previousPlan !== session.plan) {
    setPreviousPlan(session.plan);
    setPlan(session.plan);
  }

  const commit = (next: SearchPlan) => {
    setPlan(next);
    startSaving(async () => {
      const result = await updateSearchPlanAction(session.id, next);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        setPlan(session.plan);
        return;
      }
      // The server's clamped plan wins over the local draft.
      setPlan(result.data.plan);

      const preview = await previewBudgetAction(result.data.plan);
      if (preview.ok) setBudget(preview.data);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Link
        href="/app/find-leads"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Find Leads
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight text-content">
              {session.title}
            </h1>
            <Badge tone={session.saved ? "success" : "neutral"}>
              {session.saved ? (
                <>
                  <CheckCircle2 className="size-3" aria-hidden />
                  Saved
                </>
              ) : (
                "Unsaved"
              )}
            </Badge>
          </div>
          <p className="mt-1 text-[13.5px] text-content-muted">
            This search session uses AI to help you source and qualify the right
            prospects for your business.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu
            trigger={
              <IconButton variant="secondary" size="md" label="More session actions">
                <MoreHorizontal className="size-4" aria-hidden />
              </IconButton>
            }
          >
            <DropdownItem
              onSelect={() => {
                const title = window.prompt("Rename this search", session.title);
                if (title?.trim()) {
                  void renameSearchSessionAction(session.id, title).then(() =>
                    router.refresh(),
                  );
                }
              }}
            >
              Rename
            </DropdownItem>
            <DropdownItem
              onSelect={() =>
                void duplicateSearchSessionAction(session.id).then((result) => {
                  if (result.ok) {
                    router.push(`/app/find-leads/search/${result.data.sessionId}`);
                  }
                })
              }
            >
              Duplicate
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem
              onSelect={() =>
                void archiveSearchSessionAction(session.id).then(() =>
                  router.push("/app/find-leads"),
                )
              }
            >
              Archive
            </DropdownItem>
          </DropdownMenu>

          {/* Saving is a plan write, never a run. The header deliberately has
              no way to start sourcing — that lives with the budget controls. */}
          <Button
            variant="secondary"
            size="md"
            loading={saving}
            disabled={!canManage}
            onClick={() => commit(plan)}
          >
            Save session
          </Button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)]">
        <SearchConversation sessionId={session.id} messages={session.messages} />

        <div className="space-y-4">
          <StructuredPlanPanel plan={plan} onChange={commit} disabled={!canManage} />
          <SourcingControls
            sessionId={session.id}
            plan={plan}
            onChange={commit}
            budget={budget}
            canManage={canManage}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}
