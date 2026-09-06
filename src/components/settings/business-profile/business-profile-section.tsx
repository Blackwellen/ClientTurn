"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Globe,
  Lock,
  LockOpen,
  Plus,
  Target,
  Trash2,
  Unlock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  analysisStatusLabel,
  factKeyLabel,
  factSourceLabel,
  factSourceTone,
  formatFactValue,
  goalLabel,
  type BusinessProfileData,
} from "@/lib/business-profile/types";
import {
  analyseWebsite,
  deleteFact,
  saveFact,
  setFactLocked,
  setIcpActive,
} from "@/lib/business-profile/actions";
import { IcpEditor } from "./icp-editor";
import { GoalEditor } from "./goal-editor";

/**
 * Settings → Business Profile (V4 §26).
 *
 * The point of this surface is that nothing ClientTurn believes about a
 * business is hidden. Every fact shows where it came from, an inferred fact is
 * visibly the one to check, and locking a fact stops any later inference from
 * overwriting it.
 */
export function BusinessProfileSection({
  data,
  canManage,
}: {
  data: BusinessProfileData;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const [website, setWebsite] = React.useState(data.profile?.websiteUrl ?? "");
  const [factKey, setFactKey] = React.useState("");
  const [factValue, setFactValue] = React.useState("");
  const [editingIcp, setEditingIcp] = React.useState<string | null>(null);
  const [editingGoal, setEditingGoal] = React.useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else toast({ title: result.error ?? "That did not work.", variant: "error" });
    });
  }

  const analysing =
    data.profile?.analysisStatus === "QUEUED" || data.profile?.analysisStatus === "RUNNING";

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ business learning */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <SectionHeader
          icon={Globe}
          title="What we know about your business"
          description="ClientTurn reads your website to understand what you sell, so searches and messages stay accurate."
        />

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1.5 block text-[12px] font-medium text-content-secondary">
              Website
            </span>
            <input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://your-business.co.uk"
              disabled={!canManage}
              className={INPUT}
            />
          </label>
          {canManage && (
            <Button
              variant="secondary"
              loading={pending && analysing}
              disabled={!website.trim() || analysing}
              onClick={() => run(() => analyseWebsite(website))}
            >
              {analysing ? "Reading…" : "Analyse"}
            </Button>
          )}
        </div>

        {data.profile && (
          <p className="mt-2 text-[12px] text-content-muted">
            {analysisStatusLabel(data.profile.analysisStatus)}
            {data.profile.pagesAnalysed > 0 &&
              ` · ${data.profile.pagesAnalysed} page${data.profile.pagesAnalysed === 1 ? "" : "s"} read`}
            {data.profile.lastAnalysedAt &&
              ` · ${new Date(data.profile.lastAnalysedAt).toLocaleDateString("en-GB")}`}
          </p>
        )}

        {data.profile?.summary && (
          <p className="mt-3 rounded-lg border border-line bg-surface-sunken/50 p-3.5 text-[12.5px] text-content-secondary">
            {data.profile.summary}
          </p>
        )}
      </section>

      {/* --------------------------------------------------------- facts */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <SectionHeader
          icon={Brain}
          title="Business facts"
          description="Everything we hold, and where it came from. Lock a fact to stop it being changed automatically."
        />

        {canManage && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-[160px] flex-1">
              <span className="mb-1.5 block text-[12px] font-medium text-content-secondary">
                Fact
              </span>
              <input
                value={factKey}
                onChange={(event) => setFactKey(event.target.value)}
                placeholder="e.g. coverage.radius_miles"
                className={INPUT}
              />
            </label>
            <label className="min-w-[200px] flex-[2]">
              <span className="mb-1.5 block text-[12px] font-medium text-content-secondary">
                Value
              </span>
              <input
                value={factValue}
                onChange={(event) => setFactValue(event.target.value)}
                placeholder="e.g. 40"
                className={INPUT}
              />
            </label>
            <Button
              variant="secondary"
              disabled={!factKey.trim() || !factValue.trim()}
              onClick={() =>
                run(async () => {
                  const result = await saveFact({ factKey, value: factValue });
                  if (result.ok) {
                    setFactKey("");
                    setFactValue("");
                  }
                  return result;
                })
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          </div>
        )}

        {data.facts.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Analyse your website, or add a fact yourself. Anything you type is treated as verified and locked."
          />
        ) : (
          <ul className="mt-4 divide-y divide-line-subtle">
            {data.facts.map((fact) => (
              <li key={fact.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-content">
                    {factKeyLabel(fact.factKey)}
                  </p>
                  <p className="mt-0.5 break-words text-[12.5px] text-content-secondary">
                    {formatFactValue(fact.value)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={factSourceTone(fact.sourceType)} dense>
                      {factSourceLabel(fact.sourceType)}
                    </Badge>
                    {fact.locked && (
                      <Badge tone="neutral" dense>
                        <Lock className="size-2.5" aria-hidden /> locked
                      </Badge>
                    )}
                    {fact.sourceType === "AI" && !fact.verifiedByUser && (
                      <span className="text-[11px] text-warning-700">Worth checking</span>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      title={fact.locked ? "Allow automatic updates" : "Lock this fact"}
                      onClick={() => run(() => setFactLocked(fact.id, !fact.locked))}
                    >
                      {fact.locked ? (
                        <Unlock className="size-3.5" />
                      ) : (
                        <LockOpen className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      title="Delete"
                      onClick={() => run(() => deleteFact(fact.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- ICPs */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <SectionHeader
          icon={Target}
          title="Ideal customer profiles"
          description="Who you are trying to reach. Sourcing agents and intent monitors both target these."
          action={
            canManage ? (
              <Button size="sm" variant="secondary" onClick={() => setEditingIcp("new")}>
                <Plus className="size-3.5" aria-hidden />
                New profile
              </Button>
            ) : undefined
          }
        />

        {editingIcp && (
          <IcpEditor
            profile={
              editingIcp === "new"
                ? null
                : (data.icpProfiles.find((p) => p.id === editingIcp) ?? null)
            }
            onClose={() => setEditingIcp(null)}
          />
        )}

        {data.icpProfiles.length === 0 && !editingIcp ? (
          <EmptyState
            title="No customer profiles yet"
            description="Describe the kind of business you sell to — industry, area, and who you need to speak to. Sourcing cannot score anyone without one."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setEditingIcp("new")}>
                  Create a profile
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="mt-4 divide-y divide-line-subtle">
            {data.icpProfiles.map((profile) => (
              <li key={profile.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-content">{profile.name}</span>
                    {!profile.active && (
                      <Badge tone="neutral" dense>
                        inactive
                      </Badge>
                    )}
                    {profile.source === "AI_PROPOSED" && (
                      <Badge tone="warning" dense>
                        suggested
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-content-muted">
                    {[
                      profile.industries.slice(0, 3).join(", "),
                      profile.locations.slice(0, 2).join(", "),
                      profile.roles.slice(0, 2).join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No criteria set"}
                  </p>
                  {profile.prospectCount > 0 && (
                    <p className="mt-0.5 text-[11.5px] text-content-subtle">
                      {profile.prospectCount.toLocaleString("en-GB")} prospect
                      {profile.prospectCount === 1 ? "" : "s"} sourced
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditingIcp(profile.id)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => run(() => setIcpActive(profile.id, !profile.active))}
                    >
                      {profile.active ? "Pause" : "Activate"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------- conversion goals */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <SectionHeader
          icon={Target}
          title="Conversion goals"
          description="What success looks like. Every campaign and agent drives toward one of these."
          action={
            canManage ? (
              <Button size="sm" variant="secondary" onClick={() => setEditingGoal("new")}>
                <Plus className="size-3.5" aria-hidden />
                New goal
              </Button>
            ) : undefined
          }
        />

        {editingGoal && (
          <GoalEditor
            goal={
              editingGoal === "new"
                ? null
                : (data.conversionGoals.find((g) => g.id === editingGoal) ?? null)
            }
            onClose={() => setEditingGoal(null)}
          />
        )}

        {data.conversionGoals.length === 0 && !editingGoal ? (
          <EmptyState
            title="No conversion goals yet"
            description="Without a goal, an agent knows how to find someone but not what to ask them for."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setEditingGoal("new")}>
                  Create a goal
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="mt-4 divide-y divide-line-subtle">
            {data.conversionGoals.map((goal) => (
              <li key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-content">{goal.name}</span>
                    {goal.isDefault && (
                      <Badge tone="accent" dense>
                        default
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-content-muted">
                    {goalLabel(goal.type)}
                    {goal.qualificationRequired ? " · after qualification" : " · straight away"}
                  </p>
                </div>
                {canManage && (
                  <Button size="xs" variant="ghost" onClick={() => setEditingGoal(goal.id)}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------- learnings */}
      {data.learnings.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
          <SectionHeader
            icon={Brain}
            title="What we have learned"
            description="Patterns from your own results. Only findings with enough data to be meaningful appear here."
          />
          <ul className="mt-4 divide-y divide-line-subtle">
            {data.learnings.map((learning) => (
              <li key={learning.id} className="py-2.5">
                <p className="text-[12.5px] font-medium text-content">{learning.title}</p>
                {learning.detail && (
                  <p className="mt-0.5 text-[12px] text-content-muted">{learning.detail}</p>
                )}
                <p className="mt-0.5 text-[11px] text-content-subtle">
                  From {learning.sampleSize.toLocaleString("en-GB")} records ·{" "}
                  {Math.round(learning.confidence * 100)}% confidence
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const INPUT = cn(
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-content",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
  "disabled:opacity-60",
);
