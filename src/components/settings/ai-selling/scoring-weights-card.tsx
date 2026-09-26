"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { SCORE_DIMENSIONS, type DimensionWeights, type ScoreDimension } from "@/lib/sales-library/types";
import { SCORE_DIMENSION_COPY } from "@/lib/settings/ai-selling";
import { saveScoringWeightsAction } from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

/**
 * Scoring weights (brief §17): how much each dimension counts in the lead
 * score, as whole points out of 100. Saved through `scoring_weights.update`;
 * "Reset to default" deletes the override so the library profile for this
 * business type and sales motion applies again. Leads re-score on their next
 * scoring event.
 */
export function ScoringWeightsCard({
  current,
  defaults,
  overridden,
  canManage,
}: {
  current: DimensionWeights;
  defaults: DimensionWeights;
  overridden: boolean;
  canManage: boolean;
}) {
  const [weights, setWeights] = React.useState<DimensionWeights>(current);
  const { save, saving } = useSettingsSave();
  const total = SCORE_DIMENSIONS.reduce((sum, d) => sum + weights[d], 0);
  const dirty = SCORE_DIMENSIONS.some((d) => weights[d] !== current[d]);
  const locked = !canManage || saving;

  const set = (dimension: ScoreDimension, value: number) =>
    setWeights((previous) => ({ ...previous, [dimension]: Math.max(0, Math.min(100, Math.round(value))) }));

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={SlidersHorizontal}
          title="Scoring weights"
          description="How much each part of the lead score counts, out of 100. The default comes from your business type and sales motion."
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {SCORE_DIMENSIONS.map((dimension) => (
          <div key={dimension} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3">
            <label htmlFor={`weight-${dimension}`} className="text-[13px] text-content">
              {SCORE_DIMENSION_COPY[dimension]}
            </label>
            <input
              id={`weight-${dimension}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={weights[dimension]}
              disabled={locked}
              onChange={(event) => set(dimension, Number(event.target.value))}
              className="w-full accent-primary"
              aria-describedby="weights-total"
            />
            <span className="text-right text-[13px] tabular-nums text-content-muted">{weights[dimension]}</span>
          </div>
        ))}
        <p
          id="weights-total"
          className={`text-[12.5px] ${total === 100 ? "text-content-muted" : "font-medium text-danger-700"}`}
          role={total === 100 ? undefined : "alert"}
        >
          Total {total} of 100{total === 100 ? "." : ". The weights must add up to exactly 100 before they can be saved."}
        </p>
        <p className="text-[12px] text-content-subtle">
          {overridden ? "Your own weights are in use." : "The library default is in use."} Scores update the next time
          each lead is re-scored.
        </p>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || (!overridden && !dirty)}
            onClick={async () => {
              setWeights(defaults);
              if (overridden) await save(() => saveScoringWeightsAction({ weights: null }));
            }}
          >
            Reset to default
          </Button>
          <Button
            size="sm"
            disabled={!dirty || total !== 100 || locked}
            loading={saving}
            onClick={() => save(() => saveScoringWeightsAction({ weights }))}
          >
            Save weights
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
