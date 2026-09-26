"use client";

import * as React from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Select } from "@/components/ui/form";
import { PlanLimitState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { AGENT_MODE_OPTIONS, type AgentModeValue } from "@/lib/ai-settings/types";
import {
  RESEARCH_DEPTHS,
  RESEARCH_DEPTH_COPY,
  RISK_TOLERANCES,
  RISK_TOLERANCE_COPY,
  type ResearchDepth,
  type RiskTolerance,
  type SellingPreferences,
} from "@/lib/settings/ai-selling";
import { saveSalesSettingsAction } from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

/**
 * AI strategy: how deep the assistant researches and how readily it hands
 * over. The automation level (the assistant's mode) is shown read-only: its one
 * editor is Settings -> Workspace -> AI assistant, so the mode cannot be changed
 * in two places with two different sets of surrounding controls. Model,
 * prompts and token budgets are never exposed.
 */
export function AiStrategyCard({
  agentMode,
  aiEnabled,
  aiAssistAllowed,
  preferences,
  canManage,
}: {
  /** Shown read-only; edited in Workspace -> AI assistant. */
  agentMode: AgentModeValue;
  aiEnabled: boolean;
  aiAssistAllowed: boolean;
  preferences: SellingPreferences;
  canManage: boolean;
}) {
  const [research, setResearch] = React.useState<ResearchDepth>(preferences.researchDepth);
  const [risk, setRisk] = React.useState<RiskTolerance>(preferences.riskTolerance);
  const { save, saving } = useSettingsSave();

  const locked = !canManage || !aiAssistAllowed;
  const dirty = research !== preferences.researchDepth || risk !== preferences.riskTolerance;
  const activeMode = AGENT_MODE_OPTIONS.find((option) => option.value === agentMode) ?? AGENT_MODE_OPTIONS[0];

  async function onSave() {
    await save(() =>
      saveSalesSettingsAction({ preferences: { researchDepth: research, riskTolerance: risk } }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Bot}
          title="AI strategy"
          description="How much the assistant may do on its own, how much it researches, and when it hands over."
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {!aiAssistAllowed && (
          <PlanLimitState
            title="The AI assistant is not included on your plan"
            description="Follow-up and qualification still run on your configured rules."
            action={
              <Link
                href="/app/settings?section=billing"
                className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                See plans
              </Link>
            }
          />
        )}

        {aiAssistAllowed && !aiEnabled && (
          <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] text-content-muted">
            AI is switched off for this workspace, so the assistant stays off. Turn AI on in{" "}
            <Link href="/app/settings?section=workspace" className="font-medium text-content-accent hover:underline">
              Workspace settings
            </Link>
            .
          </p>
        )}

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-content">Automation level</p>
          <div className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium text-content">
                {aiEnabled ? activeMode.label : "Off"}
              </span>
              <span className="block text-[12.5px] text-content-muted">
                {aiEnabled ? activeMode.description : "AI is switched off for this workspace."}
              </span>
            </span>
          </div>
          <p className="text-[12px] text-content-muted">
            Set in{" "}
            <Link
              href="/app/settings?section=workspace#ai-assistant"
              className="font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Workspace → AI assistant
            </Link>
            , together with the channels it may use and when it hands over.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Research depth" htmlFor="research-depth" hint={RESEARCH_DEPTH_COPY[research].description}>
            <Select
              id="research-depth"
              value={research}
              disabled={locked}
              onChange={(event) => setResearch(event.target.value as ResearchDepth)}
            >
              {RESEARCH_DEPTHS.map((value) => (
                <option key={value} value={value}>
                  {RESEARCH_DEPTH_COPY[value].label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Risk tolerance" htmlFor="risk-tolerance" hint={RISK_TOLERANCE_COPY[risk].description}>
            <Select
              id="risk-tolerance"
              value={risk}
              disabled={locked}
              onChange={(event) => setRisk(event.target.value as RiskTolerance)}
            >
              {RISK_TOLERANCES.map((value) => (
                <option key={value} value={value}>
                  {RISK_TOLERANCE_COPY[value].label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <p className="text-[12px] text-content-subtle">
          Whatever is chosen here, the hard rules still apply: suppression and opt-outs, quiet hours, handover on a
          review decision, and the AI never quoting a price, a promise or availability it was not given.
        </p>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button size="sm" disabled={!dirty || locked} loading={saving} onClick={onSave}>
            Save strategy
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
