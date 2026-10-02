import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getAiBehaviour } from "@/lib/ai-settings/queries";
import {
  listLias,
  loadBudgetView,
  loadQualificationPolicyView,
  loadSalesSettings,
  loadScoringWeightsView,
  loadSenderHealth,
  loadWorkspaceObjections,
} from "@/lib/settings/ai-selling-queries";
import { ScoringWeightsCard } from "@/components/settings/ai-selling/scoring-weights-card";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { AiStrategyCard } from "@/components/settings/ai-selling/ai-strategy-card";
import { BudgetCard } from "@/components/settings/ai-selling/budget-card";
import { getCreditStatus } from "@/lib/billing/token-service";
import { SalesBehaviourCard } from "@/components/settings/ai-selling/sales-behaviour-card";
import { BrandCard } from "@/components/settings/ai-selling/brand-card";
import { ChannelsCard } from "@/components/settings/ai-selling/channels-card";
import { ComplianceCard } from "@/components/settings/ai-selling/compliance-card";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";
import { QualificationPolicyCard } from "@/components/settings/ai-selling/qualification-policy-card";
import { ObjectionsCard } from "@/components/settings/ai-selling/objections-card";
import { CompetitorsCard } from "@/components/settings/ai-selling/competitors-card";
import { loadCompetitors } from "@/lib/commercial/rules-queries";
import { AiPermissionsCard } from "@/components/settings/ai-selling/ai-permissions-card";
import { loadCommercialAuthoritySettings } from "@/lib/commercial/queries";
import { aiAuthorityOf } from "@/lib/commercial/authority";
import { can } from "@/lib/billing/capabilities";
import { PipelineStagesCard } from "@/components/settings/ai-selling/pipeline-stages-card";
import { loadSemanticMap } from "@/lib/opportunities/pipeline-apply";
import { loadWorkspaceMotion } from "@/lib/opportunities/service";

/**
 * Settings -> AI & selling (brief §74).
 *
 * Cards in the order a workspace sets them up: how much the assistant may do,
 * how many AI credits it may use, how this business sells, how leads are scored, how it
 * sounds, the objections it hears and its own answers, which channels it sends
 * on, and the compliance record behind contacting people.
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

  const [behaviour, sales, budgets, credits, lias, senders] = await Promise.all([
    settle(() => getAiBehaviour(workspace.businessId)),
    settle(() => loadSalesSettings(workspace.businessId)),
    settle(() => loadBudgetView(workspace.businessId)),
    // AI credits used and left (the allowance ledger). Credits only: no money
    // and no model tokens on a customer surface (owner decision, 2026-09-30).
    settle(() => getCreditStatus(workspace.businessId)),
    settle(() => listLias(workspace.businessId)),
    settle(() => loadSenderHealth(workspace.businessId)),
  ]);
  const policy = await settle(() => loadQualificationPolicyView(workspace.businessId, workspace.role));
  const objections = await settle(() => loadWorkspaceObjections(workspace.businessId));
  // Competitor positioning (0174): approved points and never-say lines.
  const competitors = await settle(() => loadCompetitors(workspace.businessId));
  // What the AI may do (brief §74): commercial authority v2 and the plan's AI quoting.
  const aiAuthority = await settle(async () => ({
    authority: aiAuthorityOf(await loadCommercialAuthoritySettings(workspace.businessId)),
    quoteAi: await can(workspace.businessId, "quote_ai_enabled"),
  }));
  // Pipeline stages (gap map §46): the semantic map and the motion it lands on.
  const pipeline = await settle(async () => ({
    map: (await loadSemanticMap(workspace.businessId)).map,
    motion: await loadWorkspaceMotion(workspace.businessId),
  }));
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

      {aiAuthority.ok ? (
        <AiPermissionsCard
          // Remount after a save so the switches show what was stored.
          key={JSON.stringify(aiAuthority.value.authority)}
          authority={aiAuthority.value.authority}
          canManage={canManage}
          quoteAiAllowed={aiAuthority.value.quoteAi.allowed}
          quoteAiMessage={aiAuthority.value.quoteAi.message ?? null}
        />
      ) : (
        <SectionLoadError title="What the AI may do" />
      )}

      {budgets.ok ? (
        <BudgetCard view={budgets.value} credits={credits.ok ? credits.value : null} canManage={canManage} />
      ) : (
        <SectionLoadError title="AI credits" />
      )}

      {sales.ok ? (
        <SalesBehaviourCard settings={sales.value} canManage={canManage} />
      ) : (
        <SectionLoadError title="Sales behaviour" />
      )}

      {pipeline.ok ? (
        <PipelineStagesCard
          // Remount after a save so the pickers show what was stored.
          key={JSON.stringify(pipeline.value.map)}
          mapping={pipeline.value.map}
          motion={pipeline.value.motion}
          canManage={canManage}
        />
      ) : (
        <SectionLoadError title="Pipeline stages" />
      )}

      {policy.ok ? (
        <QualificationPolicyCard
          // Remount after a save so every scope shows what was stored.
          key={JSON.stringify([policy.value.workspace, policy.value.offers.map((o) => o.policy), policy.value.engineMode])}
          view={policy.value}
          canManage={canManage}
          subscriptionActive={entitlements.active}
          agentMode={behaviour.ok ? behaviour.value.agentMode : null}
        />
      ) : (
        <SectionLoadError title="Qualification policy" />
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

      {objections.ok ? (
        <ObjectionsCard
          // Remount after a save so the editor shows what was stored.
          key={JSON.stringify(objections.value)}
          set={objections.value}
          canManage={canManage}
        />
      ) : (
        <SectionLoadError title="Objections" />
      )}

      {competitors.ok ? (
        <CompetitorsCard
          // Remount after a save so the editor shows what was stored.
          key={JSON.stringify(competitors.value.competitors)}
          competitors={competitors.value.competitors}
          invalid={competitors.value.invalid}
          schemaReady={competitors.value.schemaReady}
          canManage={canManage}
        />
      ) : (
        <SectionLoadError title="Competitors" />
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
