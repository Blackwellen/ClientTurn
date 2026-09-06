"use client";

import * as React from "react";
import {
  Ban,
  Building2,
  ChevronRight,
  Crosshair,
  Flag,
  Layers,
  MapPin,
  ShieldCheck,
  Target,
  UserCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  CONVERSION_GOAL_LABELS,
  GRADES,
  REVIEW_MODE_LABELS,
  intentFreshnessLabel,
  kmToMiles,
  milesToKm,
  type SearchPlan,
} from "@/lib/find-leads/plan";

/**
 * The structured search plan panel (V4 §10.8).
 *
 * The plan is always visible and always editable. That is the compromise the
 * whole surface is built around: the front door is a conversation, but a
 * conversation that quietly decides who gets contacted, at what cost, is not
 * something a customer can be accountable for. Ten rows, each one editable,
 * each one shown before a penny is spent.
 */

type RowKey =
  | "industries"
  | "locations"
  | "company"
  | "roles"
  | "intent"
  | "exclusions"
  | "grade"
  | "target"
  | "review"
  | "goal";

const ROW_ICONS: Record<RowKey, React.ComponentType<{ className?: string }>> = {
  industries: Building2,
  locations: MapPin,
  company: Layers,
  roles: UserCheck,
  intent: Zap,
  exclusions: Ban,
  grade: ShieldCheck,
  target: Target,
  review: Crosshair,
  goal: Flag,
};

export function StructuredPlanPanel({
  plan,
  onChange,
  disabled,
}: {
  plan: SearchPlan;
  onChange: (next: SearchPlan) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = React.useState<RowKey | null>(null);

  const rows: { key: RowKey; label: string; value: string }[] = [
    {
      key: "industries",
      label: "Industry / category",
      value: plan.industries.join(", ") || "Not set",
    },
    {
      key: "locations",
      label: "Location",
      value:
        plan.locations
          .map((location) => {
            const place = location.city ?? location.region ?? location.country;
            const radius = location.radiusKm
              ? ` + ${kmToMiles(location.radiusKm)} mile radius`
              : "";
            // An unresolved place is flagged here rather than silently
            // treated as a text match — see `locations.ts`.
            return `${place}${radius}${location.resolved ? "" : " (not found)"}`;
          })
          .join(", ") || "Not set",
    },
    {
      key: "company",
      label: "Company",
      value: companyValue(plan),
    },
    {
      key: "roles",
      label: "Decision maker",
      value: plan.decisionMakerRoles.join(", ") || "Not set",
    },
    {
      key: "intent",
      label: "Intent",
      value: plan.intent.categories.length
        ? `${plan.intent.categories.join(", ")}\n${intentFreshnessLabel(plan.intent.freshnessDays)}`
        : "No intent signals",
    },
    {
      key: "exclusions",
      label: "Exclusions",
      value: [
        plan.exclusions.existingCustomers ? "Existing customers" : null,
        plan.exclusions.competitors.length ? "competitors" : null,
        "opt-outs",
        plan.exclusions.priorBadFit ? "prior bad-fit cohorts" : null,
      ]
        .filter(Boolean)
        .join(", "),
    },
    { key: "grade", label: "Minimum grade", value: plan.minimumGrade },
    {
      key: "target",
      label: "Result target",
      value: `${plan.targetVerifiedProspects.toLocaleString("en-GB")} verified prospects`,
    },
    { key: "review", label: "Review mode", value: REVIEW_MODE_LABELS[plan.reviewMode] },
    {
      key: "goal",
      label: "Conversion goal",
      value: CONVERSION_GOAL_LABELS[plan.conversionGoal],
    },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Building2 className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-semibold text-content">
              Structured search plan
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-content-muted">
              Here&rsquo;s how we&rsquo;ll interpret your request. Review and edit before
              sourcing.
            </p>
          </div>
        </div>
      </header>

      <dl>
        {rows.map((row) => {
          const Icon = ROW_ICONS[row.key];
          return (
            <div key={row.key} className="border-t border-line-subtle">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEditing(row.key)}
                aria-label={`Edit ${row.label}`}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  "hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent",
                  "disabled:cursor-not-allowed disabled:hover:bg-transparent",
                )}
              >
                <Icon className="size-4 shrink-0 text-content-subtle" aria-hidden />
                <dt className="w-[104px] shrink-0 text-[12.5px] text-content-muted">
                  {row.label}
                </dt>
                <dd className="min-w-0 flex-1 whitespace-pre-line text-[12.5px] leading-snug text-content">
                  {row.value}
                </dd>
                <ChevronRight
                  className="size-4 shrink-0 text-content-subtle"
                  aria-hidden
                />
              </button>
            </div>
          );
        })}
      </dl>

      <PlanEditDialog
        rowKey={editing}
        plan={plan}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          onChange(next);
          setEditing(null);
        }}
      />
    </section>
  );
}

function companyValue(plan: SearchPlan): string {
  const { minEmployees: min, maxEmployees: max, organizationTypes } = plan.company;
  const size =
    min !== null && max !== null
      ? `${min}–${max} employees`
      : min !== null
        ? `${min}+ employees`
        : max !== null
          ? `Up to ${max} employees`
          : "Any size";
  const types = organizationTypes.length
    ? organizationTypes
        .map((type) => type.charAt(0) + type.slice(1).toLowerCase().replace("_", " "))
        .join(" / ")
    : null;
  return types ? `${size}\n${types}` : size;
}

/* ---------------------------------------------------------- edit dialog */

function PlanEditDialog({
  rowKey,
  plan,
  onClose,
  onSave,
}: {
  rowKey: RowKey | null;
  plan: SearchPlan;
  onClose: () => void;
  onSave: (plan: SearchPlan) => void;
}) {
  const [draft, setDraft] = React.useState<SearchPlan>(plan);

  const [previous, setPrevious] = React.useState({ rowKey, plan });
  if (previous.rowKey !== rowKey || previous.plan !== plan) {
    setPrevious({ rowKey, plan });
    if (rowKey) setDraft(plan);
  }

  if (!rowKey) return null;

  const titles: Record<RowKey, string> = {
    industries: "Industry / category",
    locations: "Location",
    company: "Company",
    roles: "Decision maker",
    intent: "Intent",
    exclusions: "Exclusions",
    grade: "Minimum grade",
    target: "Result target",
    review: "Review mode",
    goal: "Conversion goal",
  };

  return (
    <Modal open onClose={onClose} title={titles[rowKey]}>
      <div className="space-y-4">
        {rowKey === "industries" && (
          <ListField
            label="Industries and categories"
            hint="One per line. Use common industry names so providers recognise them."
            values={draft.industries}
            onChange={(industries) => setDraft({ ...draft, industries })}
          />
        )}

        {rowKey === "roles" && (
          <ListField
            label="Decision-maker roles"
            hint="One per line, for example Property Manager or Operations Director."
            values={draft.decisionMakerRoles}
            onChange={(decisionMakerRoles) => setDraft({ ...draft, decisionMakerRoles })}
          />
        )}

        {rowKey === "locations" && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-content-muted">
              A place and a radius. We resolve the coordinates so the radius is a real
              distance, not a text match.
            </p>
            {draft.locations.map((location, index) => (
              <div key={index} className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`loc-city-${index}`}>Town or city</Label>
                  <Input
                    id={`loc-city-${index}`}
                    value={location.city ?? ""}
                    onChange={(event) => {
                      const locations = [...draft.locations];
                      locations[index] = {
                        ...location,
                        city: event.target.value || null,
                        // Editing a place invalidates its coordinates; the
                        // server re-resolves before the plan can run.
                        resolved: false,
                        lat: null,
                        lon: null,
                      };
                      setDraft({ ...draft, locations });
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor={`loc-radius-${index}`}>Radius (miles)</Label>
                  <Input
                    id={`loc-radius-${index}`}
                    type="number"
                    min={0}
                    max={300}
                    value={location.radiusKm ? kmToMiles(location.radiusKm) : ""}
                    onChange={(event) => {
                      const miles = Number(event.target.value);
                      const locations = [...draft.locations];
                      locations[index] = {
                        ...location,
                        radiusKm: Number.isFinite(miles) && miles > 0 ? milesToKm(miles) : null,
                      };
                      setDraft({ ...draft, locations });
                    }}
                  />
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setDraft({
                  ...draft,
                  locations: [
                    ...draft.locations,
                    {
                      country: "GB",
                      region: null,
                      city: "",
                      radiusKm: 40,
                      lat: null,
                      lon: null,
                      resolved: false,
                    },
                  ],
                })
              }
            >
              Add a location
            </Button>
          </div>
        )}

        {rowKey === "company" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="min-employees">Minimum employees</Label>
              <Input
                id="min-employees"
                type="number"
                min={0}
                value={draft.company.minEmployees ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    company: {
                      ...draft.company,
                      minEmployees: event.target.value ? Number(event.target.value) : null,
                    },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="max-employees">Maximum employees</Label>
              <Input
                id="max-employees"
                type="number"
                min={0}
                value={draft.company.maxEmployees ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    company: {
                      ...draft.company,
                      maxEmployees: event.target.value ? Number(event.target.value) : null,
                    },
                  })
                }
              />
            </div>
            <p className="col-span-2 text-[12px] leading-relaxed text-content-muted">
              Revenue filters are only applied where a licensed provider actually
              supplies revenue for a company, so they are not offered here.
            </p>
          </div>
        )}

        {rowKey === "intent" && (
          <div className="space-y-3">
            <ListField
              label="Buying signals"
              hint="One per line, for example Roof repair or Building works."
              values={draft.intent.categories}
              onChange={(categories) =>
                setDraft({ ...draft, intent: { ...draft.intent, categories } })
              }
            />
            <div>
              <Label htmlFor="intent-freshness">How recent</Label>
              <Select
                id="intent-freshness"
                value={String(draft.intent.freshnessDays)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    intent: { ...draft.intent, freshnessDays: Number(event.target.value) },
                  })
                }
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 180 days</option>
              </Select>
            </div>
          </div>
        )}

        {rowKey === "exclusions" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-surface-sunken px-3 py-2.5 text-[12px] leading-relaxed text-content-secondary">
              Opt-outs and suppressed contacts are always excluded. That is not a
              setting — it is enforced on every run regardless of what is chosen here.
            </p>
            <ListField
              label="Competitors to exclude"
              hint="One company name or domain per line."
              values={draft.exclusions.competitors}
              onChange={(competitors) =>
                setDraft({ ...draft, exclusions: { ...draft.exclusions, competitors } })
              }
            />
          </div>
        )}

        {rowKey === "grade" && (
          <div>
            <Label htmlFor="minimum-grade">Minimum grade</Label>
            <Select
              id="minimum-grade"
              value={draft.minimumGrade}
              onChange={(event) =>
                setDraft({ ...draft, minimumGrade: event.target.value as SearchPlan["minimumGrade"] })
              }
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </Select>
          </div>
        )}

        {rowKey === "target" && (
          <div>
            <Label htmlFor="result-target">Verified prospects to find</Label>
            <Input
              id="result-target"
              type="number"
              min={1}
              max={10000}
              value={draft.targetVerifiedProspects}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  targetVerifiedProspects: Number(event.target.value) || 1,
                })
              }
            />
            <p className="mt-1.5 text-[12px] text-content-muted">
              We may reduce this to what your remaining allowance covers.
            </p>
          </div>
        )}

        {rowKey === "review" && (
          <div>
            <Label htmlFor="review-mode">Review mode</Label>
            <Select
              id="review-mode"
              value={draft.reviewMode}
              onChange={(event) =>
                setDraft({ ...draft, reviewMode: event.target.value as SearchPlan["reviewMode"] })
              }
            >
              <option value="HUMAN_REVIEW">{REVIEW_MODE_LABELS.HUMAN_REVIEW}</option>
              <option value="AUTO_CONTACT">{REVIEW_MODE_LABELS.AUTO_CONTACT}</option>
            </Select>
            <p className="mt-1.5 text-[12px] leading-relaxed text-content-muted">
              Automatic contact needs a verified sender and an active campaign. Without
              both, the run will refuse to start rather than queue messages it cannot
              send.
            </p>
          </div>
        )}

        {rowKey === "goal" && (
          <div>
            <Label htmlFor="conversion-goal">Conversion goal</Label>
            <Select
              id="conversion-goal"
              value={draft.conversionGoal}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  conversionGoal: event.target.value as SearchPlan["conversionGoal"],
                })
              }
            >
              {Object.entries(CONVERSION_GOAL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(draft)}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function ListField({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = React.useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={5}
        value={values.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-content focus:border-accent-400 focus:outline-none"
      />
      <p className="mt-1.5 text-[12px] text-content-muted">{hint}</p>
    </div>
  );
}
