import * as React from "react";
import Link from "next/link";
import { CircleCheck, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/page-header";
import {
  AUTOMATION_STATUS_META,
  AUTOMATION_TYPE_META,
  type AutomationListItem,
} from "@/lib/automations/types";

/**
 * Who gets enrolled, and what takes them back out again (V4 §19.4).
 *
 * Enrolment in ClientTurn is a property of the automation's trigger, not a
 * separate rule engine: a lead enters the new-lead sequence because a lead was
 * created, and the unresponsive sequence because the first one finished without
 * a reply. Rendering that plainly is more honest than offering a rules builder
 * whose only legal configuration is the one already in force.
 *
 * The exit conditions listed are the same ones `evaluateStopConditions`
 * enforces, re-checked against live state immediately before every send.
 */
export function EnrolmentRulesPanel({
  sequences,
  canEdit,
}: {
  sequences: AutomationListItem[];
  canEdit: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            icon={ListChecks}
            tone="info"
            title="Enrolment rules"
            description="What puts a lead into each sequence."
          />
        </CardHeader>
        <CardContent className="space-y-3 px-5 pt-4 pb-5">
          {sequences.length === 0 ? (
            <p className="text-[13px] text-content-muted">
              No sequences yet, so nothing is being enrolled.
            </p>
          ) : (
            <ul className="space-y-3">
              {sequences.map((sequence) => {
                const meta = AUTOMATION_TYPE_META[sequence.type];
                const status = AUTOMATION_STATUS_META[sequence.status];
                return (
                  <li
                    key={sequence.id}
                    className="rounded-lg border border-line px-4 py-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[14px] font-semibold text-content">
                        {meta.label}
                      </p>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] text-content-muted">
                      <span className="font-medium text-content-secondary">
                        Enrols when:
                      </span>{" "}
                      {meta.trigger}
                    </p>
                    <p className="mt-1 text-[12.5px] text-content-muted">
                      {meta.description}
                    </p>
                    <p className="mt-1.5 text-[12px] text-content-subtle">
                      {sequence.leadsInSequence.toLocaleString("en-GB")}{" "}
                      {sequence.leadsInSequence === 1 ? "lead is" : "leads are"}{" "}
                      part-way through it now.
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit && (
            <p className="text-[12.5px] text-content-muted">
              Enrolment follows the trigger for each sequence and is not
              separately configurable. To change who is chased, change which
              leads reach ClientTurn in{" "}
              <Link
                href="/app/settings?section=connections"
                className="font-medium text-content-accent hover:underline"
              >
                Connections
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            title="Automatic exit"
            description="Re-checked against live lead state immediately before every send."
            dense
          />
        </CardHeader>
        <CardContent className="px-5 pt-3 pb-5">
          <ul className="space-y-2">
            {[
              "The lead replies",
              "The lead books",
              "The lead is marked won or lost",
              "The lead opts out or is suppressed",
              "A person takes over the conversation",
              "The chosen channel is no longer permitted for that lead",
              "Follow-up is paused, or the subscription lapses",
            ].map((rule) => (
              <li key={rule} className="flex items-start gap-2">
                <CircleCheck
                  className="mt-px size-4 shrink-0 text-success-600"
                  aria-hidden
                />
                <span className="text-[12.5px] leading-[1.45] text-content-secondary">
                  {rule}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
