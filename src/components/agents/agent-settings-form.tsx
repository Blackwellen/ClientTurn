"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  autonomyDescription,
  autonomyOptionsFor,
  autonomyLabel,
  cadenceLabel,
  sourcesForType,
  type AgentType,
  type Autonomy,
  type Cadence,
  type SourceKey,
} from "@/lib/agents/types";
import { updateAgent } from "@/lib/agents/actions";

/**
 * Edits an agent's setup through `agent.configure` — the same operation
 * Copilot, MCP and the API use. A running agent picks the changes up on its
 * next run.
 */
export function AgentSettingsForm({
  agent,
  plans,
  unavailableSources = [],
}: {
  agent: {
    id: string;
    name: string;
    description: string | null;
    agentType: AgentType;
    autonomy: Autonomy;
    cadence: Cadence;
    dailyProspectCap: number;
    monthlyProspectCap: number;
    enabledSources: SourceKey[];
    searchStrategyId: string | null;
  };
  plans: { id: string; name: string }[];
  /** Switched off platform-wide (e.g. paid enrichment); never offered. */
  unavailableSources?: SourceKey[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const usesSources = agent.agentType === "SOURCING" || agent.agentType === "COMBINED";
  const selectable = sourcesForType(agent.agentType).filter(
    (source) => !unavailableSources.includes(source.key),
  );

  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [autonomy, setAutonomy] = React.useState<Autonomy>(agent.autonomy);
  const [cadence, setCadence] = React.useState<Cadence>(agent.cadence);
  const [dailyCap, setDailyCap] = React.useState(agent.dailyProspectCap);
  const [monthlyCap, setMonthlyCap] = React.useState(agent.monthlyProspectCap);
  const [strategyId, setStrategyId] = React.useState(agent.searchStrategyId ?? "");
  const [sources, setSources] = React.useState<SourceKey[]>(
    agent.enabledSources.filter((key) => selectable.some((s) => s.key === key)),
  );

  function toggle(key: SourceKey) {
    setSources((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function save() {
    setError("");
    setNotice("");
    if (name.trim().length < 2) return setError("Give the agent a name.");
    if (monthlyCap < dailyCap) {
      return setError("The monthly limit cannot be lower than the daily limit.");
    }
    startTransition(async () => {
      try {
        const result = await updateAgent({
          id: agent.id,
          name,
          description,
          autonomy,
          cadence,
          dailyCap,
          monthlyCap,
          // Only a change is sent: an unchanged plan is not re-validated.
          strategyId: strategyId !== (agent.searchStrategyId ?? "") ? strategyId : "",
          ...(usesSources ? { sources } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(result.warnings[0] ?? "Saved.");
        router.refresh();
      } catch {
        setError("The agent could not be saved. Check your access and try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent name">
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Schedule">
          <Select value={cadence} onChange={(event) => setCadence(event.target.value as Cadence)}>
            {(["MANUAL", "HOURLY", "DAILY", "WEEKLY"] as Cadence[]).map((value) => (
              <option key={value} value={value}>
                {cadenceLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Description" hint="Optional. What should this agent achieve?">
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Approval" hint={autonomyDescription(autonomy, agent.agentType)}>
        <Select value={autonomy} onChange={(event) => setAutonomy(event.target.value as Autonomy)}>
          {[...new Set<Autonomy>([...autonomyOptionsFor(agent.agentType), autonomy])].map((value) => (
            <option key={value} value={value}>
              {autonomyLabel(value)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
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

      {usesSources && (
        <>
          <Field
            label="Approved search plan"
            hint="Targeting, minimum grade and the number of prospects per run come from this plan."
          >
            <Select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
              {!agent.searchStrategyId && <option value="">No plan yet</option>}
              {agent.searchStrategyId && !plans.some((plan) => plan.id === agent.searchStrategyId) && (
                <option value={agent.searchStrategyId}>Current plan (no longer approved)</option>
              )}
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[12px] font-medium text-content-secondary">
              Sources
            </legend>
            {selectable.map((source) => {
              const checked = sources.includes(source.key);
              return (
                <label
                  key={source.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    checked ? "border-accent-500 bg-accent-50/40" : "border-line bg-surface",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(source.key)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent-600)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-content">
                      {source.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-content-muted">
                      {source.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </>
      )}

      <FormError message={error} />
      {notice && (
        <p role="status" className="text-[12.5px] text-content-muted">
          {notice}
        </p>
      )}

      <Button loading={pending} onClick={save}>
        Save changes
      </Button>
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent";

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
