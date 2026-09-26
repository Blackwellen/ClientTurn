"use client";

import * as React from "react";
import { Search, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Select } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import { ARCHETYPES, archetypeFor } from "@/lib/sales-library/archetypes";
import { resolveArchetype } from "@/lib/sales-library/classify";
import { METHOD_EVIDENCE } from "@/lib/sales-library/method-router";
import { MOTIONS } from "@/lib/sales-library/motions";
import {
  SALES_METHODS,
  SALES_METHOD_LABEL,
  SALES_MOTIONS,
  type SalesMethod,
  type SalesMotion,
} from "@/lib/sales-library/types";
import {
  QUALIFICATION_DEPTHS,
  QUALIFICATION_DEPTH_COPY,
  type QualificationDepth,
  type SalesSettingsView,
} from "@/lib/settings/ai-selling";
import {
  saveSalesSettingsAction,
  searchIndustryCodesAction,
  type IndustryCodeOption,
} from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

const GRADE_LABEL: Record<string, string> = {
  OPERATIONAL_DEFAULT: "Operational default",
  SALES_CONVENTION_OBSERVATIONAL: "Sales convention (observational)",
  SALES_CONVENTION: "Sales convention",
};

/**
 * Sales behaviour: what kind of business this is (a UK SIC 2026 code and a
 * library archetype), how it sells (motions), how deep it qualifies, and which
 * question-planning methods it prefers.
 *
 * Archetype suggestions come from the deterministic resolver (SIC code first,
 * then what was typed); a person always makes the choice. Methods are shown
 * with their evidence grade and labelled as internal heuristics, because none
 * of them is peer-reviewed science and none is ever presented to a buyer.
 */
export function SalesBehaviourCard({ settings, canManage }: { settings: SalesSettingsView; canManage: boolean }) {
  const [code, setCode] = React.useState<{ code: string; title: string | null } | null>(
    settings.primaryIndustry ? { code: settings.primaryIndustry.code, title: settings.primaryIndustry.title } : null,
  );
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<IndustryCodeOption[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [archetype, setArchetype] = React.useState(settings.archetypeKey ?? "");
  const [motions, setMotions] = React.useState<SalesMotion[]>(settings.salesMotions);
  const [depth, setDepth] = React.useState<QualificationDepth>(settings.preferences.qualificationDepth);
  const [methods, setMethods] = React.useState<SalesMethod[]>(settings.preferences.preferredMethods);
  const { save, saving } = useSettingsSave();

  // Debounced search; a stale response never overwrites a newer one.
  const latest = React.useRef(0);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  function onQuery(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    const term = value.trim();
    const ticket = ++latest.current;
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const found = await searchIndustryCodesAction(term).catch((): IndustryCodeOption[] => []);
      if (ticket === latest.current) {
        setResults(found);
        setSearching(false);
      }
    }, 250);
  }

  const suggestions = React.useMemo(() => {
    const result = resolveArchetype({
      sic2026Codes: code ? [code.code] : [],
      aliasText: query.trim() || undefined,
    });
    return result.candidates.slice(0, 3);
  }, [code, query]);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  async function onSave() {
    await save(() =>
      saveSalesSettingsAction({
        classification: { primaryIndustryCode: code?.code ?? null, archetypeKey: archetype || null },
        salesMotions: motions,
        preferences: { qualificationDepth: depth, preferredMethods: methods },
      }),
    );
  }

  const locked = !canManage;

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Target}
          title="Sales behaviour"
          description="What kind of business this is and how it sells. Scoring, qualification and the opportunity stages follow it."
        />
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ----------------------------------------------------- industry */}
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-content">Primary industry (UK SIC 2026)</p>
          <p className="text-[12.5px] text-content-secondary">
            {code ? (
              <>
                <span className="font-mono">{code.code}</span> {code.title ?? ""}
              </>
            ) : (
              <span className="text-content-muted">Not set.</span>
            )}
            {code && canManage && (
              <button
                type="button"
                className="ml-2 text-[12px] font-medium text-content-accent hover:underline"
                onClick={() => setCode(null)}
              >
                Clear
              </button>
            )}
          </p>
          {canManage && (
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-content-subtle" />
              <Input
                aria-label="Search industries"
                placeholder="Search by code or activity, e.g. 73.11 or web design"
                className="pl-8"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
              />
            </div>
          )}
          {results !== null && (
            <ul className="max-h-56 max-w-md overflow-y-auto rounded-lg border border-line" aria-busy={searching}>
              {results.length === 0 ? (
                <li className="px-3 py-2.5 text-[12.5px] text-content-muted">
                  {searching ? "Searching…" : "No matching industries."}
                </li>
              ) : (
                results.map((option) => (
                  <li key={option.code}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent"
                      onClick={() => {
                        setCode({ code: option.code, title: option.title });
                        setResults(null);
                      }}
                    >
                      <span className="font-mono text-content-muted">{option.code}</span>
                      <span className="text-content">{option.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {/* ---------------------------------------------------- archetype */}
        <div className="space-y-2">
          <FormField
            label="Business type"
            htmlFor="archetype"
            hint="The library profile used for scoring weights and qualification questions."
          >
            <Select
              id="archetype"
              className="max-w-md"
              disabled={locked}
              value={archetype}
              onChange={(event) => setArchetype(event.target.value)}
            >
              <option value="">Not set</option>
              {ARCHETYPES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </FormField>
          {canManage && suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-content-muted">
              Suggested:
              {suggestions.map((candidate) => (
                <button
                  key={candidate.archetypeKey}
                  type="button"
                  onClick={() => setArchetype(candidate.archetypeKey)}
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                  title={candidate.evidence.map((item) => item.detail).join("; ")}
                >
                  <Badge tone={archetype === candidate.archetypeKey ? "accent" : "neutral"} dense>
                    {archetypeFor(candidate.archetypeKey)?.name ?? candidate.archetypeKey} ·{" "}
                    {Math.round(candidate.confidence * 100)}%
                  </Badge>
                </button>
              ))}
            </div>
          )}
          {settings.classificationSource && (
            <p className="text-[11.5px] text-content-subtle">
              Current classification source: {settings.classificationSource.replace(/_/g, " ").toLowerCase()}.
            </p>
          )}
        </div>

        {/* ------------------------------------------------------ motions */}
        <fieldset disabled={locked}>
          <legend className="mb-1 text-[13px] font-medium text-content">How you sell</legend>
          <p className="mb-2 text-[12px] text-content-muted">
            The first one chosen is the primary motion; it decides the opportunity stages and what the assistant closes
            towards.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SALES_MOTIONS.map((motion) => (
              <label key={motion} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                <Checkbox
                  className="mt-0.5"
                  checked={motions.includes(motion)}
                  onChange={() => setMotions((current) => toggle(current, motion))}
                />
                <span>
                  <span className="block text-[13px] text-content">
                    {MOTIONS[motion].name}
                    {motions[0] === motion && (
                      <Badge tone="accent" dense className="ml-1.5">
                        Primary
                      </Badge>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-content-muted">{MOTIONS[motion].closeTargetDescription}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ------------------------------------------ qualification depth */}
        <FormField
          label="Qualification depth"
          htmlFor="qualification-depth"
          hint={QUALIFICATION_DEPTH_COPY[depth].description}
        >
          <Select
            id="qualification-depth"
            className="max-w-xs"
            disabled={locked}
            value={depth}
            onChange={(event) => setDepth(event.target.value as QualificationDepth)}
          >
            {QUALIFICATION_DEPTHS.map((value) => (
              <option key={value} value={value}>
                {QUALIFICATION_DEPTH_COPY[value].label}
              </option>
            ))}
          </Select>
        </FormField>

        {/* ------------------------------------------------------ methods */}
        <fieldset disabled={locked}>
          <legend className="mb-1 text-[13px] font-medium text-content">Preferred methods</legend>
          <p className="mb-2 text-[12px] text-content-muted">
            Internal heuristics for planning which question to ask next. A ticked method is used where it fits your
            sales motion; the rules still apply (the enterprise checklist only on the enterprise motion, insight-led
            openers only with an approved proof point). They are never named to a buyer, and none is validated
            science: each shows the evidence behind it.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SALES_METHODS.map((method) => (
              <label key={method} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                <Checkbox
                  className="mt-0.5"
                  checked={methods.includes(method)}
                  onChange={() => setMethods((current) => toggle(current, method))}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-content">
                    {SALES_METHOD_LABEL[method]}
                    <Badge tone="neutral" dense>
                      {GRADE_LABEL[METHOD_EVIDENCE[method].grade] ?? METHOD_EVIDENCE[method].grade}
                    </Badge>
                    <Badge tone="neutral" dense>
                      Internal heuristic
                    </Badge>
                  </span>
                  <span className="block text-[11.5px] text-content-muted">{METHOD_EVIDENCE[method].note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button size="sm" loading={saving} onClick={onSave}>
            Save sales behaviour
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
