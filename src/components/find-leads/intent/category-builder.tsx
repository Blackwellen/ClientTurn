"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  CATEGORY_TEMPLATES,
  FRESHNESS_WINDOW_OPTIONS,
  MONITOR_CADENCES,
  SCORE_IMPACT_OPTIONS,
  SIGNAL_SOURCES,
  cadenceAvailable,
  cadenceLabel,
  signalSourceLabel,
  type IntentCategoryRow,
  type MonitorCadence,
  type SignalSourceKey,
} from "@/lib/intent/types";
import { saveIntentCategory } from "@/lib/intent/actions";

/**
 * Create or edit an intent category (V4 §15.4).
 *
 * Two bounds are visible rather than merely enforced. Score impact is a set of
 * bands topping out at the specification's ceiling, so nobody types 100 and
 * discovers later that it was silently clamped; and a cadence the plan does not
 * include is shown disabled with the reason, rather than accepted and then
 * refused by the server.
 *
 * Signal types are a fixed catalogue. There is deliberately no "add your own
 * source" — §15.5 requires sources whose terms permit the use and whose
 * provenance can be recorded, which a free-text URL cannot satisfy.
 */
export function CategoryBuilder({
  category,
  icpProfiles,
  monitorLimit,
  onClose,
}: {
  category: IntentCategoryRow | null;
  icpProfiles: { id: string; name: string }[];
  monitorLimit: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [name, setName] = React.useState(category?.name ?? "");
  const [description, setDescription] = React.useState(category?.description ?? "");
  const [signalTypes, setSignalTypes] = React.useState<SignalSourceKey[]>(
    category?.signalTypes ?? ["COMPANY_WEBSITE"],
  );
  const [keywords, setKeywords] = React.useState<string[]>(category?.keywords ?? []);
  const [keywordDraft, setKeywordDraft] = React.useState("");
  const [freshnessDays, setFreshnessDays] = React.useState(category?.freshnessDays ?? 90);
  const [scoreImpact, setScoreImpact] = React.useState(category?.scoreImpact ?? 15);
  const [icpProfileIds, setIcpProfileIds] = React.useState<string[]>(
    category?.icpProfileIds ?? [],
  );
  const [autoAdd, setAutoAdd] = React.useState(category?.autoAddToSearch ?? true);
  const [cadence, setCadence] = React.useState<MonitorCadence>(
    category?.defaultCadence ?? "WEEKLY",
  );

  function applyTemplate(template: (typeof CATEGORY_TEMPLATES)[number]) {
    setName(template.name);
    setDescription(template.description);
    setSignalTypes(template.signalTypes);
    setFreshnessDays(template.freshnessDays);
    setScoreImpact(template.scoreImpact);
  }

  function addKeyword() {
    const term = keywordDraft.trim();
    if (!term || keywords.includes(term) || keywords.length >= 40) {
      setKeywordDraft("");
      return;
    }
    setKeywords((current) => [...current, term]);
    setKeywordDraft("");
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await saveIntentCategory({
        id: category?.id ?? "",
        name,
        description,
        signalTypes,
        keywords,
        freshnessDays,
        scoreImpact,
        icpProfileIds,
        autoAddToSearch: autoAdd,
        cadence,
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
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
        <CircleCheck className="size-4 text-content-accent" aria-hidden />
        {category ? "Edit intent category" : "Create intent category"}
      </h2>

      {!category && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11.5px] text-content-muted">Start from a common one:</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-content-secondary transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
              >
                {template.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3.5">
        <div>
          <Label htmlFor="intent-name">Name</Label>
          <Input
            id="intent-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Commercial roofing need"
          />
        </div>

        <div>
          <Label htmlFor="intent-description">Description</Label>
          <Textarea
            id="intent-description"
            rows={3}
            value={description}
            maxLength={400}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What business need does this category represent?"
          />
        </div>

        <TokenField
          label="Signal types"
          hint="Only sources whose terms permit this use. There is no general web crawl."
          tokens={signalTypes.map((key) => ({ value: key, label: signalSourceLabel(key) }))}
          onRemove={(value) =>
            setSignalTypes((current) => current.filter((key) => key !== value))
          }
          picker={(close) => (
            <div className="max-h-64 min-w-[16rem] overflow-y-auto py-1">
              {Object.values(SIGNAL_SOURCES).map((source) => {
                const checked = signalTypes.includes(source.key);
                return (
                  <button
                    key={source.key}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => {
                      setSignalTypes((current) =>
                        checked
                          ? current.filter((key) => key !== source.key)
                          : [...current, source.key],
                      );
                      close();
                    }}
                    className={cn(
                      "block w-full px-3 py-2 text-left transition-colors hover:bg-surface-hover",
                      checked && "bg-accent-50/60",
                    )}
                  >
                    <span className="block text-[12.5px] font-medium text-content">
                      {source.label}
                    </span>
                    <span className="block text-[11px] text-content-muted">
                      {source.mechanism}
                    </span>
                    {source.requiresConnection && (
                      <span className="mt-0.5 block text-[10.5px] text-warning-700">
                        Needs a connection
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        />

        <div>
          <Label htmlFor="intent-keyword">Keywords / entities</Label>
          <div className="flex flex-wrap gap-1.5 rounded-md border border-line-strong bg-surface p-1.5">
            {keywords.map((term) => (
              <span
                key={term}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-sunken px-2 py-0.5 text-[12px] text-content-secondary"
              >
                {term}
                <button
                  type="button"
                  aria-label={`Remove ${term}`}
                  onClick={() => setKeywords((current) => current.filter((k) => k !== term))}
                  className="text-content-subtle transition-colors hover:text-danger-600"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            <input
              id="intent-keyword"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== ",") return;
                event.preventDefault();
                addKeyword();
              }}
              onBlur={addKeyword}
              placeholder={keywords.length === 0 ? "roof repair, flat roof…" : "Add a term"}
              className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-[12.5px] text-content outline-none placeholder:text-content-subtle"
            />
          </div>
          <p className="mt-1 text-[11px] text-content-muted">
            Used to narrow what counts as this category. They are classifier features, not a
            search query.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="intent-freshness">Freshness window</Label>
            <Select
              id="intent-freshness"
              value={freshnessDays}
              onChange={(event) => setFreshnessDays(Number(event.target.value))}
            >
              {FRESHNESS_WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="intent-impact">Score impact</Label>
            <Select
              id="intent-impact"
              value={scoreImpact}
              onChange={(event) => setScoreImpact(Number(event.target.value))}
            >
              {SCORE_IMPACT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="intent-scope">ICP scope</Label>
            <Select
              id="intent-scope"
              value={icpProfileIds[0] ?? ""}
              onChange={(event) =>
                setIcpProfileIds(event.target.value ? [event.target.value] : [])
              }
            >
              <option value="">All ICPs</option>
              {icpProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="intent-auto-add">Auto-add to search</Label>
            <div className="flex items-center gap-2.5 pt-1.5">
              <Switch
                checked={autoAdd}
                onCheckedChange={setAutoAdd}
                label="Allow active searches to use this category"
              />
              <span className="text-[11.5px] text-content-muted">
                Applies to new and recurring searches, never one already running.
              </span>
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="intent-cadence">Monitoring cadence</Label>
          <Select
            id="intent-cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as MonitorCadence)}
          >
            {MONITOR_CADENCES.map((option) => {
              const available = cadenceAvailable(option, monitorLimit);
              return (
                <option key={option} value={option} disabled={!available}>
                  {cadenceLabel(option)}
                  {available ? "" : " — not on your plan"}
                </option>
              );
            })}
          </Select>
          {!cadenceAvailable("DAILY", monitorLimit) && (
            <p className="mt-1 text-[11px] text-content-muted">
              Daily monitoring is available on plans with a larger monitoring allowance.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          loading={pending}
          onClick={submit}
          disabled={!name.trim() || signalTypes.length === 0 || pending}
        >
          Save category
        </Button>
      </div>
    </section>
  );
}

/** A chip list with a picker, for a fixed catalogue of values. */
function TokenField({
  label,
  hint,
  tokens,
  onRemove,
  picker,
}: {
  label: string;
  hint?: string;
  tokens: { value: string; label: string }[];
  onRemove: (value: string) => void;
  picker: (close: () => void) => React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-content-secondary">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface p-1.5">
        {tokens.map((token) => (
          <span
            key={token.value}
            className="inline-flex items-center gap-1 rounded-md border border-accent-200/60 bg-accent-50 px-2 py-0.5 text-[12px] text-content-accent"
          >
            {token.label}
            <button
              type="button"
              aria-label={`Remove ${token.label}`}
              onClick={() => onRemove(token.value)}
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}

        <Popover
          label={label}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-content-muted transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </button>
          }
        >
          {(close) => picker(close)}
        </Popover>
      </div>
      {hint && <p className="mt-1 text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}
