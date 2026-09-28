"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GitBranch, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import {
  DEFAULT_SEMANTIC_MAP,
  PIPELINE_SEMANTICS,
  SEMANTIC_META,
  TARGET_LABEL,
  allowedTargets,
  stageForMotion,
  type PipelineSemantic,
  type PipelineTarget,
  type SemanticMap,
} from "@/lib/opportunities/pipeline-semantics";
import { STAGE_LABEL, stagesForMotion, type OpenStage } from "@/lib/opportunities/stages";
import { savePipelineMapping } from "@/lib/automation/rule-actions";

/**
 * Settings -> AI & selling -> Pipeline stages (gap map §46): where each
 * system step (Quoted, Payment pending, Won...) puts the deal on this
 * workspace's pipeline. Saved through `pipeline.set_mapping`; applied by the
 * automation dispatcher when a quote, call or payment event happens. Moves
 * are forward only and never touch a closed deal, whatever the mapping says.
 */
export function PipelineStagesCard({
  mapping,
  motion,
  canManage,
}: {
  mapping: SemanticMap;
  motion: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [map, setMap] = React.useState<SemanticMap>(mapping);
  const [saving, startSaving] = React.useTransition();
  const dirty = PIPELINE_SEMANTICS.some((s) => map[s] !== mapping[s]);
  const motionStages = stagesForMotion(motion);

  const main = PIPELINE_SEMANTICS.filter((s) => !SEMANTIC_META[s].side);
  const side = PIPELINE_SEMANTICS.filter((s) => SEMANTIC_META[s].side);

  function save() {
    startSaving(async () => {
      const result = await savePipelineMapping(map);
      if (result.ok) {
        toast({ variant: "success", title: "Pipeline mapping saved" });
        router.refresh();
      } else toast({ variant: "error", title: result.error });
    });
  }

  function landsOn(target: PipelineTarget): string | null {
    if (target === "NO_MOVE" || target === "CLOSE_WON" || target === "CLOSE_LOST") return null;
    const stage = stageForMotion(target as OpenStage, motion);
    if (!stage) return "Your sales motion has no stage for this, so nothing moves.";
    return stage === target ? null : `Your sales motion has no ${STAGE_LABEL[target as OpenStage]}; lands on ${STAGE_LABEL[stage]}.`;
  }

  const row = (semantic: PipelineSemantic) => {
    const note = landsOn(map[semantic]);
    const changed = map[semantic] !== DEFAULT_SEMANTIC_MAP[semantic];
    return (
      <li key={semantic} className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <p className="text-content text-[13px] font-medium">
            {SEMANTIC_META[semantic].label}
            {changed && <span className="text-content-accent ml-2 text-[11px] font-normal">changed</span>}
          </p>
          <p className="text-content-muted text-[12px]">{SEMANTIC_META[semantic].description}</p>
          {note && <p className="text-warning-700 mt-0.5 text-[12px]">{note}</p>}
        </div>
        <Select
          aria-label={`${SEMANTIC_META[semantic].label} moves the deal to`}
          value={map[semantic]}
          disabled={!canManage || saving}
          options={allowedTargets(semantic).map((target) => ({
            value: target,
            label: TARGET_LABEL[target],
            description: target === DEFAULT_SEMANTIC_MAP[semantic] ? "Default" : undefined,
          }))}
          onValueChange={(value) => setMap((m) => ({ ...m, [semantic]: value as PipelineTarget }))}
        />
      </li>
    );
  };

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={GitBranch}
          title="Pipeline stages"
          description="Where each step of a sale puts the deal on your pipeline when a quote, call or payment happens. Deals only ever move forward, and a closed deal is never moved."
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-content-muted text-[12.5px]">
          Your pipeline{motion ? " for this sales motion" : ""}: {motionStages.map((s) => STAGE_LABEL[s]).join(" → ")}, then Closed.
        </p>
        <ul className="divide-line divide-y">{main.map(row)}</ul>
        <details className="group" open={side.some((s) => map[s] !== DEFAULT_SEMANTIC_MAP[s])}>
          <summary className="text-content-secondary cursor-pointer text-[13px] font-medium">Nurture, disqualified, lost and reactivation</summary>
          <ul className="divide-line mt-1 divide-y">{side.map(row)}</ul>
        </details>
      </CardContent>
      {canManage && (
        <CardFooter className={cn("flex flex-wrap justify-end gap-2")}>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => setMap({ ...DEFAULT_SEMANTIC_MAP })}>
            <RotateCcw className="size-3.5" aria-hidden />
            Defaults
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save mapping
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
