import * as React from "react";
import { randomUUID } from "node:crypto";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getAiBehaviour } from "@/lib/ai-settings/queries";
import { runOperation } from "@/lib/services";
import {
  listLias,
  loadBudgetView,
  loadSalesSettings,
  loadScoringWeightsView,
  loadSenderHealth,
} from "@/lib/settings/ai-selling-queries";
import { ScoringWeightsCard } from "@/components/settings/ai-selling/scoring-weights-card";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { AiStrategyCard } from "@/components/settings/ai-selling/ai-strategy-card";
import { BudgetCard, type SpendSnapshot } from "@/components/settings/ai-selling/budget-card";
import { SalesBehaviourCard } from "@/components/settings/ai-selling/sales-behaviour-card";
import { BrandCard } from "@/components/settings/ai-selling/brand-card";
import { ChannelsCard } from "@/components/settings/ai-selling/channels-card";
import { ComplianceCard } from "@/components/settings/ai-selling/compliance-card";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";

/**
 * Settings -> AI & selling (brief §74).
 *
 * Seven cards in the order a workspace sets them up: how much the assistant may
 * do, how much it may spend, how this business sells, how leads are scored,
 * how it sounds, which channels it sends on, and the compliance record behind
 * contacting people.
 *
 * Each card loads independently and fails independently: a failed budget read
 * shows an error in the budget card and leaves the rest usable. Owners and
 * admins edit; everyone else sees the same values read-only, because the
 * operations behind every save are admin-only.
 */

async function settle<T>(load: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    console.error("[settings: ai & selling] read failed", error);
    return { ok: false };
  }
}

export async function AiSellingSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");
  const entitlements = await getEntitlements(workspace.businessId);

  const [behaviour, sales, budgets, spend, lias, senders] = await Promise.all([
    settle(() => getAiBehaviour(workspace.businessId)),
    settle(() => loadSalesSettings(workspace.businessId)),
    settle(() => loadBudgetView(workspace.businessId, entitlements.plan)),
    // Spend comes from the same operation Copilot and MCP read, which is
    // member-only; a viewer is told that rather than shown a zero.
    hasRole(workspace.role, "member")
      ? runOperation<{ spentGbp: number; ceilingGbp: number | null; ceilingSource: string | null }>(
          "ai_usage.get",
          {},
          {
            businessId: workspace.businessId,
            userId: workspace.userId,
            role: workspace.role,
            caller: "UI",
            correlationId: randomUUID(),
          },
        ).then(
          (result): SpendSnapshot =>
            result.success
              ? { state: "ok", ...result.data }
              : { state: "error" },
          (): SpendSnapshot => ({ state: "error" }),
        )
      : Promise.resolve<SpendSnapshot>({ state: "hidden" }),
    settle(() => listLias(workspace.businessId)),
    settle(() => loadSenderHealth(workspace.businessId)),
  ]);
  const weights = sales.ok
    ? await settle(() =>
        loadScoringWeightsView(workspace.businessId, sales.value.archetypeKey, sales.value.salesMotions[0] ?? null),
      )
    : ({ ok: false } as const);

  return (
    <div className="space-y-4">
      {!canManage && (
        <ReadOnlyNotice message="Only an owner or admin can change how ClientTurn sells and spends. You can see every setting here." />
      )}

      {behaviour.ok && sales.ok ? (
        <AiStrategyCard
          agentMode={behaviour.value.agentMode}
          aiEnabled={behaviour.value.enabled}
          aiAssistAllowed={entitlements.aiAssistAllowed}
          preferences={sales.value.preferences}
          canManage={canManage}
        />
      ) : (
        <SectionLoadError title="AI strategy" />
      )}

      {budgets.ok ? (
        <BudgetCard view={budgets.value} spend={spend} canManage={canManage} />
      ) : (
        <SectionLoadError title="AI budget" />
      )}

      {sales.ok ? (
        <SalesBehaviourCard settings={sales.value} canManage={canManage} />
      ) : (
        <SectionLoadError title="Sales behaviour" />
      )}

      {sales.ok && weights.ok ? (
        <ScoringWeightsCard
          // Remount after a save so the sliders show what was stored.
          key={JSON.stringify(weights.value.current)}
          current={weights.value.current}
          defaults={weights.value.defaults}
          overridden={weights.value.overridden}
          canManage={canManage}
        />
      ) : (
        <SectionLoadError title="Scoring weights" />
      )}

      {sales.ok ? (
        <BrandCard brand={sales.value.brand} preferences={sales.value.preferences} canManage={canManage} />
      ) : (
        <SectionLoadError title="Brand" />
      )}

      {senders.ok ? <ChannelsCard health={senders.value} /> : <SectionLoadError title="Channels" />}

      {lias.ok ? (
        <ComplianceCard lias={lias.value} canManage={canManage} />
      ) : (
        <SectionLoadError title="Compliance" />
      )}
    </div>
  );
}
