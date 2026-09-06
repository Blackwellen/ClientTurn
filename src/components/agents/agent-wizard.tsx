"use client";

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
}: {
  plans: { id: string; name: string }[];
  sourceAvailability: SourceAvailability;
  initialType?: AgentType;
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
  const [enrichEmail, setEnrichEmail] = React.useState(true);
  const [enrichPhone, setEnrichPhone] = React.useState(false);
  const [autonomy, setAutonomy] = React.useState<Autonomy>("REVIEW_ALL");
  const [cadence, setCadence] = React.useState<Cadence>("DAILY");
  const [dailyCap, setDailyCap] = React.useState(25);
  const [monthlyCap, setMonthlyCap] = React.useState(250);

  const definition = AGENT_TYPE_DEFINITIONS[type];
  const availableSources = sourcesForType(type);

  function toggleSource(key: SourceKey) {
    setSources((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function validate(current: number): string {
    if (current === 1 && sources.length === 0) {
      return "Choose at least one source, or the agent has nowhere to look.";
    }
    if (current === 2) {
      if (name.trim().length < 2) return "Give the agent a name.";
      if (dailyCap < 1) return "The daily limit must be at least 1.";
      if (monthlyCap < dailyCap) {
        return "The monthly limit cannot be lower than the daily limit.";
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
          sources,
          enrichEmail,
          enrichPhone,
          autonomy,
        });
        if (result.error) setError(result.error);
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
          title="Where should it look?"
          description="ClientTurn only uses official APIs, licensed data and accounts you own. A source that needs connecting is marked below."
        >
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

          {(type === "SOURCING" || type === "COMBINED") && (
            <div className="mt-5 space-y-3 border-t border-line-subtle pt-4">
              <Field label="Approved search plan" hint="Targeting follows this plan. Leave blank to save a draft.">
                <select
                  value={strategyId}
                  onChange={(event) => setStrategyId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">No plan yet — save as draft</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
                <Link
                  href="/app/find-leads"
                  className="mt-1.5 inline-block text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                >
                  Build and approve a plan in Find Leads
                </Link>
              </Field>

              <Toggle
                label="Find a work email address"
                hint="Discovered addresses are verified before they are used."
                checked={enrichEmail}
                onChange={setEnrichEmail}
              />
              <Toggle
                label="Find a business phone number"
                hint="Finding a number does not grant permission to call or text it. Every message is still checked against consent and channel rules."
                checked={enrichPhone}
                onChange={setEnrichPhone}
              />
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
                placeholder="e.g. South coast roofing prospects"
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

            <Field label="Approval">
              <select
                value={autonomy}
                onChange={(event) => setAutonomy(event.target.value as Autonomy)}
                className={SELECT_CLASS}
              >
                {(["REVIEW_ALL", "REVIEW_NEW", "AUTO"] as Autonomy[]).map((value) => (
                  <option key={value} value={value}>
                    {autonomyLabel(value)}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11.5px] text-content-muted">
                {autonomyDescription(autonomy)}
              </span>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Schedule">
                <select
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value as Cadence)}
                  className={SELECT_CLASS}
                >
                  {(["MANUAL", "HOURLY", "DAILY", "WEEKLY"] as Cadence[]).map((value) => (
                    <option key={value} value={value}>
                      {cadenceLabel(value)}
                    </option>
                  ))}
                </select>
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
                sources.length
                  ? sources.map((key) => SOURCE_DEFINITIONS[key]?.label ?? key).join(", ")
                  : "None"
              }
            />
            <Summary
              label="Enrichment"
              value={
                [enrichEmail && "email", enrichPhone && "phone"]
                  .filter(Boolean)
                  .join(" + ") || "None"
              }
            />
          </dl>

          <p className="mt-4 flex gap-3 rounded-lg border border-line bg-surface-sunken/50 p-3.5 text-[12.5px] text-content-secondary">
            <ShieldCheck className="size-4 shrink-0 text-content-accent" aria-hidden />
            <span>
              The agent is created as a draft and does nothing until you start it. Finding
              someone&rsquo;s details is not permission to contact them — opt-outs, consent and
              channel rules are checked before every message, whatever this agent is set to.
            </span>
          </p>
        </Panel>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

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
const SELECT_CLASS = `${INPUT_CLASS} h-9 py-0`;

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

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent-600)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-content">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-content-muted">{hint}</span>
      </span>
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-content">{value}</dd>
    </div>
  );
}
