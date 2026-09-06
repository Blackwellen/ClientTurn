"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  CATEGORY_TEMPLATES,
  MAX_SCORE_IMPACT,
  SIGNAL_SOURCES,
  type IntentCategoryRow,
  type SignalSourceKey,
} from "@/lib/intent/types";
import { saveIntentCategory } from "@/lib/intent/actions";

/**
 * Create or edit an intent category (V4 §15.4).
 *
 * The score-impact control is capped at the specification's ceiling in the UI
 * as well as on the server, so the bound is visible rather than only enforced
 * after submitting. A customer should be able to see that intent is bounded.
 */
export function CategoryBuilder({
  category,
  onClose,
}: {
  category: IntentCategoryRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [name, setName] = React.useState(category?.name ?? "");
  const [description, setDescription] = React.useState(category?.description ?? "");
  const [signalTypes, setSignalTypes] = React.useState<SignalSourceKey[]>(
    category?.signalTypes ?? ["NEWS_FEED"],
  );
  const [freshnessDays, setFreshnessDays] = React.useState(category?.freshnessDays ?? 90);
  const [scoreImpact, setScoreImpact] = React.useState(category?.scoreImpact ?? 10);
  const [autoAdd, setAutoAdd] = React.useState(category?.autoAddToSearch ?? false);

  function applyTemplate(template: (typeof CATEGORY_TEMPLATES)[number]) {
    setName(template.name);
    setDescription(template.description);
    setSignalTypes(template.signalTypes);
    setFreshnessDays(template.freshnessDays);
    setScoreImpact(template.scoreImpact);
  }

  function toggleSource(key: SignalSourceKey) {
    setSignalTypes((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function submit() {
    startTransition(async () => {
      const result = await saveIntentCategory({
        id: category?.id ?? "",
        name,
        description,
        signalTypes,
        freshnessDays,
        scoreImpact,
        autoAddToSearch: autoAdd,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-accent-200/60 bg-accent-50/30 p-4">
      <h3 className="text-[13px] font-semibold text-content">
        {category ? "Edit category" : "New intent category"}
      </h3>

      {!category && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11.5px] text-content-muted">Start from a common one:</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-content-secondary hover:bg-surface-hover hover:text-content"
              >
                {template.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <Field label="Name">
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Commercial roofing need"
            className={INPUT}
          />
        </Field>

        <Field label="What does this mean?" hint="Shown to your team, and used to guide the classifier.">
          <textarea
            value={description}
            maxLength={400}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            className={INPUT}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-content-secondary">
            Where to look
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {Object.values(SIGNAL_SOURCES).map((source) => {
              const checked = signalTypes.includes(source.key);
              return (
                <label
                  key={source.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-2.5",
                    checked ? "border-accent-500 bg-surface" : "border-line bg-surface",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSource(source.key)}
                    className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-content">
                      {source.label}
                    </span>
                    <span className="block text-[11px] text-content-muted">
                      {source.description}
                    </span>
                    {source.requiresConnection && (
                      <span className="mt-0.5 block text-[10.5px] text-warning-700">
                        Needs a connection
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Score impact: +${scoreImpact}`}
            hint={`Capped at ${MAX_SCORE_IMPACT}. Intent can lift a good-fit prospect, never carry a poor one.`}
          >
            <input
              type="range"
              min={0}
              max={MAX_SCORE_IMPACT}
              value={scoreImpact}
              onChange={(event) => setScoreImpact(Number(event.target.value))}
              className="w-full accent-[var(--color-accent-600)]"
            />
          </Field>

          <Field label="Freshness window" hint="After this, the signal stops counting.">
            <select
              value={freshnessDays}
              onChange={(event) => setFreshnessDays(Number(event.target.value))}
              className={cn(INPUT, "h-9 py-0")}
            >
              {[7, 14, 30, 60, 90, 180, 365].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={autoAdd}
            onChange={(event) => setAutoAdd(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent-600)]"
          />
          <span className="text-[12.5px] text-content-secondary">
            Let new searches use this category automatically
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" loading={pending} onClick={submit} disabled={!name.trim() || signalTypes.length === 0}>
          {category ? "Save changes" : "Create category"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}
