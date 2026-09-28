"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Check, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  AGENT_TYPE_DEFINITIONS,
  AGENT_TYPES,
  SOURCE_DEFINITIONS,
  autonomyDescription,
  autonomyLabel,
  cadenceLabel,
  sourcesForType,
  type AgentType,
  type Autonomy,
  type Cadence,
  type SourceKey,
  type SourceStatus,
} from "@/lib/agents/types";
import { saveAgent } from "@/lib/agents/actions";
import { Select } from "@/components/ui/form";
import { WHOLE_CATALOGUE, type CatalogueOptions, type OfferTarget } from "@/lib/agents/offer-target";
import { OfferTargetPicker } from "./offer-target-picker";

/**
 * The Agent setup wizard.
 *
 * Four steps: what it does, where it looks, how careful it is, and a review.
 * The order is deliberate — sources and limits are chosen before the summary,
 * so the last thing seen before "Create" is exactly what the agent will do.
 *
 * The agent is always created as a draft. Nothing runs, and nothing is
 * contacted, until someone starts it from the agent's own page.
 */

const STEPS = ["Role", "Sources", "Limits", "Review"] as const;

type SourceAvailability = Record<SourceKey, { status: SourceStatus; detail: string | null }>;

export function AgentWizard({
  plans,
  sourceAvailability,
  initialType = "SOURCING",
  catalogue = null,
}: {
  plans: { id: string; name: string }[];
  sourceAvailability: SourceAvailability;
  initialType?: AgentType;
  /** What the agent may sell (0174). Null = the catalogue could not be read. */
  catalogue?: CatalogueOptions | null;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [type, setType] = React.useState<AgentType>(initialType);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [strategyId, setStrategyId] = React.useState("");
  const [sources, setSources] = React.useState<SourceKey[]>([
    "GOOGLE_PLACES",
    "WEBSITE",
  ]);
  const [autonomy, setAutonomy] = React.useState<Autonomy>("REVIEW_ALL");
  const [cadence, setCadence] = React.useState<Cadence>("DAILY");
  const [dailyCap, setDailyCap] = React.useState(25);
  const [monthlyCap, setMonthlyCap] = React.useState(250);
  const [target, setTarget] = React.useState<OfferTarget>(WHOLE_CATALOGUE);

  const definition = AGENT_TYPE_DEFINITIONS[type];
  const availableSources = sourcesForType(type);
  // Only sourcing reads sources. Booking and re-engagement work the leads
  // already in the workspace, whichever way they arrived.
  const usesSources = type === "SOURCING" || type === "COMBINED";

  function toggleSource(key: SourceKey) {
    setSources((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function validate(current: number): string {
    if (current === 1 && usesSources && sources.length === 0) {
      return "Choose at least one source, or the agent has nowhere to look.";
    }
    if (current === 2) {
      if (name.trim().length < 2) return "Give the agent a name.";
      if (dailyCap < 1) return "The daily limit must be at least 1.";
      if (monthlyCap < dailyCap) {
        return "The monthly limit cannot be lower than the daily limit.";
      }
      if (target.scope === "SELECTED" && target.serviceIds.length + target.catalogueItemIds.length === 0) {
        return "Choose at least one product or service, or pick the whole catalogue.";
      }
    }
    return "";
  }

  function next() {
    const problem = validate(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit() {
    startTransition(async () => {
      try {
        const result = await saveAgent({
          name,
          description,
          type,
          strategyId,
          cadence,
          dailyCap,
          monthlyCap,
          sources: usesSources ? sources : [],
          autonomy,
          target,
        });
        if (result.error) setError(result.error);
        // Created, but what it sells was not saved: open its settings to fix it.
        else if (result.warning) router.push(`/app/agents/${result.id}?tab=settings`);
        else router.push(`/app/agents/${result.id}`);
      } catch {
        setError("Could not create the agent. Check your access and try again.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 border-b-2 pb-3 text-[12.5px]",
              step === index
                ? "border-accent-600 font-medium text-content"
                : "border-line text-content-muted",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                step > index
                  ? "bg-success-500 text-white"
                  : step === index
                    ? "bg-accent-500 text-white"
                    : "bg-surface-sunken text-content-muted",
              )}
            >
              {step > index ? <Check className="size-3" aria-hidden /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Choose what this agent does</legend>
          {AGENT_TYPES.map((candidate) => {
            const option = AGENT_TYPE_DEFINITIONS[candidate];
            const selected = type === candidate;
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(candidate)}
                className={cn(
                  "rounded-xl border bg-surface p-5 text-left shadow-xs transition-shadow hover:shadow-sm",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  selected ? "border-accent-500 ring-1 ring-accent-500" : "border-line",
                )}
              >
                <Bot className="mb-3 size-6 text-content-accent" aria-hidden />
                <h2 className="text-[14px] font-semibold text-content">{option.label}</h2>
                <p className="mt-1 text-[12.5px] text-content-secondary">{option.tagline}</p>
                <ul className="mt-3 space-y-1">
                  {option.capabilities.slice(0, 3).map((capability) => (
                    <li key={capability} className="flex gap-1.5 text-[11.5px] text-content-muted">
                      <Check className="mt-0.5 size-3 shrink-0 text-success-600" aria-hidden />
                      {capability}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </fieldset>
      )}

      {step === 1 && (
        <Panel
          title={usesSources ? "Where should it look?" : "What it works on"}
          description={
            usesSources
              ? "The agent runs your approved Find Leads plan using only the sources you switch on here. Public ad libraries and engagement on your own social accounts are used when your plan and connections allow."
              : "This agent works on the leads already in your workspace, however they arrived: lead forms, imports, your CRM or your website. It has no sources to choose."
          }
        >
          {usesSources && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Sources</legend>
            {availableSources.map((source) => {
              const availability = sourceAvailability[source.key];
              const blocked = availability?.status !== "AVAILABLE";
              const checked = sources.includes(source.key);

              return (
                <label
                  key={source.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5",
                    checked ? "border-accent-500 bg-accent-50/40" : "border-line bg-surface",
                    blocked && "opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggleSource(source.key)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent-600)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-content">{source.label}</span>
                      {source.isDiscovery && (
                        <Badge tone="accent" dense>
                          finds new companies
                        </Badge>
                      )}
                      {blocked && (
                        <Badge tone="warning" dense>
                          needs setup
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-content-muted">
                      {source.description}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-content-subtle">
                      {source.mechanism}
                      {blocked && availability?.detail ? ` · ${availability.detail}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          )}

          {usesSources && (
            <div className="mt-5 space-y-3 border-t border-line-subtle pt-4">
              <Field label="Approved search plan" hint="Targeting follows this plan. Leave blank to save a draft.">
                <Select
                  value={strategyId}
                  onChange={(event) => setStrategyId(event.target.value)}
                  
                >
                  <option value="">No plan yet: save as draft</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </Select>
                <Link
                  href="/app/find-leads"
                  className="mt-1.5 inline-block text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                >
                  Build and approve a plan in Find Leads
                </Link>
              </Field>

              <p className="text-[11.5px] text-content-muted">
                The agent finds and verifies a work email address for each prospect. It never
                collects phone numbers.
              </p>
            </div>
          )}
        </Panel>
      )}

      {step === 2 && (
        <Panel
          title="How careful should it be?"
          description="These limits are ceilings the agent can never raise for itself."
        >
          <div className="space-y-4">
            <Field label="Agent name">
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. London design agencies"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Description" hint="Optional. What should this agent achieve?">
              <textarea
                value={description}
                maxLength={500}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
                className={INPUT_CLASS}
              />
            </Field>

            <div className="min-w-0">
              <p className="mb-1.5 block text-[12px] font-medium text-content-secondary">What it sells</p>
              {catalogue ? (
                <OfferTargetPicker value={target} onChange={setTarget} catalogue={catalogue} />
              ) : (
                <p className="text-[12.5px] text-content-muted">
                  Your catalogue could not be loaded, so this agent will sell the whole catalogue. You can narrow it in the
                  agent&rsquo;s settings after creating it.
                </p>
              )}
            </div>

            <Field label="Approval">
              <Select
                value={autonomy}
                onChange={(event) => setAutonomy(event.target.value as Autonomy)}
                
              >
                {(["REVIEW_ALL", "REVIEW_NEW", "AUTO"] as Autonomy[]).map((value) => (
                  <option key={value} value={value}>
                    {autonomyLabel(value)}
                  </option>
                ))}
              </Select>
              <span className="mt-1.5 block text-[11.5px] text-content-muted">
                {autonomyDescription(autonomy)}
              </span>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Schedule">
                <Select
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value as Cadence)}
                  
                >
                  {(["MANUAL", "HOURLY", "DAILY", "WEEKLY"] as Cadence[]).map((value) => (
                    <option key={value} value={value}>
                      {cadenceLabel(value)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Daily limit">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={dailyCap}
                  onChange={(event) => setDailyCap(Number(event.target.value))}
                  className={INPUT_CLASS}
                />
              </Field>

              <Field label="Monthly limit">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={monthlyCap}
                  onChange={(event) => setMonthlyCap(Number(event.target.value))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
          </div>
        </Panel>
      )}

      {step === 3 && (
        <Panel title="Review">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-content-accent"
            >
              <Bot className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-content">{name || "Untitled agent"}</h3>
              <p className="mt-0.5 text-[12.5px] text-content-secondary">
                {description || definition.tagline}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-4 border-y border-line-subtle py-4 sm:grid-cols-2">
            <Summary label="Role" value={definition.label} />
            <Summary label="Schedule" value={cadenceLabel(cadence)} />
            <Summary label="Approval" value={autonomyLabel(autonomy)} />
            <Summary
              label="Limits"
              value={`${dailyCap}/day · ${monthlyCap}/month`}
            />
            <Summary
              label="Sources"
              value={
                !usesSources
                  ? "Leads already in your workspace"
                  : sources.length
                    ? sources.map((key) => SOURCE_DEFINITIONS[key]?.label ?? key).join(", ")
                    : "None"
              }
            />
            {usesSources && <Summary label="Contact details" value="Verified work email only" />}
            <Summary label="Sells" value={describeWizardTarget(target, catalogue)} />
          </dl>

          <p className="mt-4 flex gap-3 rounded-lg border border-line bg-surface-sunken/50 p-3.5 text-[12.5px] text-content-secondary">
            <ShieldCheck className="size-4 shrink-0 text-content-accent" aria-hidden />
            <span>
              The agent is created as a draft and does nothing until you start it. Finding
              someone&rsquo;s details is not permission to contact them: opt-outs, consent and
              channel rules are checked before every message, whatever this agent is set to.
            </span>
          </p>
        </Panel>
      )}

      <FormError message={error} />

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => (step === 0 ? router.push("/app/agents") : setStep(step - 1))}
        >
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={next}>
            Continue
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button loading={pending} onClick={submit}>
            Create agent
          </Button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- shared */

const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent";

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h2 className="text-[15px] font-semibold text-content">{title}</h2>
      {description && <p className="mt-1 text-[12.5px] text-content-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-content-secondary">
        {label}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
      {hint && <p className="mt-1 text-[11.5px] text-content-muted">{hint}</p>}
    </div>
  );
}

function describeWizardTarget(target: OfferTarget, catalogue: CatalogueOptions | null): string {
  if (target.scope === "CATALOGUE" || !catalogue) return "Whole catalogue";
  const names = [
    ...target.serviceIds.map((id) => catalogue.services.find((s) => s.id === id)?.name),
    ...target.catalogueItemIds.map((id) => catalogue.items.find((i) => i.id === id)?.name),
  ].filter((name): name is string => Boolean(name));
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ") || "Nothing chosen";
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-content">{value}</dd>
    </div>
  );
}
