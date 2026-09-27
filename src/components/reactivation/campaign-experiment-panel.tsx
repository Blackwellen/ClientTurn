"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatGbp } from "@/lib/dates";
import type { CampaignExperimentView } from "@/lib/learning/experiments";
import {
  createCampaignExperiment,
  setCampaignExperimentState,
} from "@/lib/campaigns/experiment-actions";

/**
 * Reactivation A/B test for one campaign: set up (draft campaigns), start,
 * stop, and the per-arm results. Outcomes come first -- meetings, sales,
 * opt-outs -- and replies last, because a message that gets more replies and
 * fewer meetings is not better. Until every arm has the minimum sample the
 * panel says "not enough data". Nothing is ever applied automatically: a
 * person reads the result and edits the campaign.
 */
export function CampaignExperimentPanel({
  campaignId,
  campaignStatus,
  experiment,
  canManage,
}: {
  campaignId: string;
  campaignStatus: string;
  experiment: CampaignExperimentView | null | undefined;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState("Message test");
  const [variantBody, setVariantBody] = React.useState("");
  const [holdout, setHoldout] = React.useState("10");

  const canSetUp = canManage && !experiment && (campaignStatus === "DRAFT" || campaignStatus === "SCHEDULED");

  function create() {
    startTransition(async () => {
      const result = await createCampaignExperiment({
        campaignId,
        name,
        variantBody,
        holdoutPercent: Number(holdout),
        primaryMetric: "BOOKING",
      });
      toast(result.ok ? { variant: "success", title: "A/B test saved as a draft. Start it before launching." } : { variant: "error", title: result.error });
    });
  }

  function move(to: "start" | "stop") {
    if (!experiment) return;
    startTransition(async () => {
      const result = await setCampaignExperimentState({ experimentId: experiment.id, to });
      toast(result.ok ? { variant: "success", title: to === "start" ? "A/B test started." : "A/B test stopped." } : { variant: "error", title: result.error });
    });
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3.5 shadow-xs" aria-labelledby="ab-test-title">
      <div className="flex items-center justify-between gap-2">
        <h4 id="ab-test-title" className="flex items-center gap-2 text-[13px] font-semibold text-content">
          <FlaskConical aria-hidden className="size-4 text-content-muted" />
          A/B test
        </h4>
        {experiment && (
          <Badge tone={experiment.status === "RUNNING" ? "success" : experiment.status === "DRAFT" ? "neutral" : "info"}>
            {experiment.status === "RUNNING" ? "Running" : experiment.status === "DRAFT" ? "Draft" : "Stopped"}
          </Badge>
        )}
      </div>

      {!experiment && !canSetUp && (
        <p className="mt-2 text-[12.5px] text-content-muted">
          No A/B test on this campaign. A test can be set up while a campaign is a draft.
        </p>
      )}

      {canSetUp && (
        <div className="mt-3 space-y-2.5">
          <p className="text-[12px] leading-[1.45] text-content-muted">
            Half the audience gets your current message, half gets variant B. A holdout gets nothing, which shows whether messaging helps at all. Judged on meetings booked, never on replies.
          </p>
          <FormField label="Test name" htmlFor="ab-name">
            <Input id="ab-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField label="Variant B message" hint="Merge fields work as in the campaign." htmlFor="ab-body">
            <Textarea id="ab-body" rows={4} value={variantBody} maxLength={2000} onChange={(event) => setVariantBody(event.target.value)} />
          </FormField>
          <FormField label="Holdout" hint="Percent of the audience not messaged (0-50)" htmlFor="ab-holdout">
            <Input id="ab-holdout" type="number" min={0} max={50} inputMode="numeric" value={holdout} onChange={(event) => setHoldout(event.target.value)} />
          </FormField>
          <Button size="sm" onClick={create} loading={pending} disabled={!variantBody.trim()}>
            Save test
          </Button>
        </div>
      )}

      {experiment && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-content-muted">
            {experiment.name} · holdout {experiment.holdoutPercent}% · judged on{" "}
            {experiment.metric === "WIN" ? "sales won" : "meetings booked"}
          </p>

          {experiment.status === "DRAFT" ? (
            <p className="text-[12.5px] text-content-muted">Not started. Start it before the campaign sends so every contact is assigned.</p>
          ) : experiment.rows.every((row) => row.leads === 0) ? (
            <p className="text-[12.5px] text-content-muted">No contacts have been assigned to an arm yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead className="text-content-muted">
                  <tr>
                    <th className="px-1 py-1.5 font-medium">Arm</th>
                    <th className="px-1 py-1.5 text-right font-medium">Leads</th>
                    <th className="px-1 py-1.5 text-right font-medium">Meetings</th>
                    <th className="px-1 py-1.5 text-right font-medium">Sales</th>
                    <th className="px-1 py-1.5 text-right font-medium">Opt-outs</th>
                    <th className="px-1 py-1.5 text-right font-medium text-content-subtle">Replies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {experiment.rows.map((row) => (
                    <tr key={row.arm}>
                      <td className="px-1 py-1.5 text-content">
                        {row.label}
                        {!row.enoughData && (
                          <span className="ml-1.5 text-[11px] text-content-subtle">not enough data</span>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{row.leads.toLocaleString("en-GB")}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{row.meetings.toLocaleString("en-GB")}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums">
                        {row.sales.toLocaleString("en-GB")}
                        {row.salesValue > 0 && <span className="text-content-muted"> ({formatGbp(row.salesValue)})</span>}
                      </td>
                      <td className="px-1 py-1.5 text-right tabular-nums">{row.optOuts.toLocaleString("en-GB")}</td>
                      <td className="px-1 py-1.5 text-right tabular-nums text-content-subtle">{row.replies.toLocaleString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {experiment.status !== "DRAFT" && (
            <p className="text-[12px] leading-[1.45] text-content">
              {experiment.verdict === "NOT_ENOUGH_DATA"
                ? `Not enough data yet: every arm needs at least ${experiment.minSamplePerArm} leads before a result is shown.`
                : experiment.explanation}
            </p>
          )}
          <p className="text-[11px] text-content-subtle">
            Nothing changes automatically. If a variant wins, edit the campaign message yourself.
          </p>

          {canManage && experiment.status === "DRAFT" && (
            <Button size="sm" onClick={() => move("start")} loading={pending}>
              Start test
            </Button>
          )}
          {canManage && experiment.status === "RUNNING" && (
            <Button size="sm" variant="secondary" onClick={() => move("stop")} loading={pending}>
              Stop test
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
