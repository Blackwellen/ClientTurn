"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { monitorTypeLabel, type IntentCategoryRow } from "@/lib/intent/types";
import { createIntentMonitor } from "@/lib/intent/actions";
import { Select } from "@/components/ui/form";
import {
  INTENT_SOURCE_LABELS,
  intentType,
  intentTypeAvailability,
  intentTypesForCategory,
} from "@/lib/find-leads/intent-catalogue";
import type { SignalFeed } from "@/lib/find-leads/signals";

/**
 * Create a monitor: a category, somewhere to look, and how often.
 *
 * Cadence is prominent because it is the cost control — a daily monitor over a
 * broad ICP is the most expensive thing on this page, and the copy says so
 * rather than leaving someone to discover it on their bill.
 */
export function MonitorBuilder({
  categories,
  icpProfiles,
  liveFeeds = [],
  onClose,
}: {
  categories: IntentCategoryRow[];
  icpProfiles: { id: string; name: string }[];
  liveFeeds?: SignalFeed[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");

  const [categoryId, setCategoryId] = React.useState(categories[0]?.id ?? "");
  const [monitorType, setMonitorType] =
    React.useState<"ICP" | "NAMED_COMPANIES" | "FIRST_PARTY">("ICP");
  const [cadence, setCadence] = React.useState<"DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY">(
    "WEEKLY",
  );
  const [icpIds, setIcpIds] = React.useState<string[]>([]);
  const [companiesText, setCompaniesText] = React.useState("");

  const liveSet = React.useMemo(() => new Set(liveFeeds), [liveFeeds]);
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const collects = selectedCategory
    ? intentTypesForCategory({ name: selectedCategory.name, keywords: selectedCategory.keywords })
    : [];

  const companies = companiesText
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);

  function submit() {
    startTransition(async () => {
      const result = await createIntentMonitor({
        categoryId,
        name: "",
        monitorType,
        cadence,
        icpProfileIds: monitorType === "ICP" ? icpIds : [],
        companies: monitorType === "NAMED_COMPANIES" ? companies : [],
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
      <h3 className="text-[13px] font-semibold text-content">New monitor</h3>

      <div className="mt-3 space-y-3">
        <Field label="Watch for">
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        {collects.length > 0 && (
          <ul className="-mt-1 space-y-0.5 rounded-md bg-surface px-2.5 py-2 text-[11.5px] text-content-secondary">
            {collects.map((id) => {
              const entry = intentType(id);
              const availability = intentTypeAvailability(id, liveSet);
              return (
                <li key={id} className={availability.available ? undefined : "opacity-70"}>
                  <span className="font-medium text-content">{entry.label}</span>{" "}
                  from {[...new Set(entry.sources.map((source) => INTENT_SOURCE_LABELS[source.source]))].join(", ")}
                  {!availability.available && (
                    <span className="block text-warning-700">{availability.reason}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-content-secondary">
            Across
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {/* FIRST_PARTY stays in the stored vocabulary for existing monitors,
                but is not offered: nothing tracks visitors to a customer's site. */}
            {(["ICP", "NAMED_COMPANIES"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={monitorType === value}
                onClick={() => setMonitorType(value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] font-medium",
                  monitorType === value
                    ? "border-accent-500 bg-accent-50 text-content-accent"
                    : "border-line bg-surface text-content-muted hover:text-content",
                )}
              >
                {monitorTypeLabel(value)}
              </button>
            ))}
          </div>
        </fieldset>

        {monitorType === "ICP" && (
          <Field
            label="Customer profiles"
            hint={
              icpProfiles.length === 0
                ? "You have no ideal customer profiles yet. Create one in Settings → Business Profile."
                : undefined
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {icpProfiles.map((profile) => {
                const checked = icpIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() =>
                      setIcpIds((current) =>
                        checked
                          ? current.filter((id) => id !== profile.id)
                          : [...current, profile.id],
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px]",
                      checked
                        ? "border-accent-500 bg-accent-50 text-content-accent"
                        : "border-line bg-surface text-content-muted hover:text-content",
                    )}
                  >
                    {profile.name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {monitorType === "NAMED_COMPANIES" && (
          <Field
            label="Companies"
            hint={`One per line, or comma-separated. ${companies.length} added.`}
          >
            <textarea
              value={companiesText}
              rows={4}
              onChange={(event) => setCompaniesText(event.target.value)}
              placeholder={"acme.co.uk\nExample Digital Ltd"}
              className={INPUT}
            />
          </Field>
        )}

        {monitorType === "FIRST_PARTY" && (
          <p className="rounded-md border border-line bg-surface p-3 text-[12px] text-content-muted">
            Watching your own website for visitors is not available: ClientTurn does not
            track visitors to your site. Choose profiles or named companies instead.
          </p>
        )}

        <Field
          label="How often"
          hint="Each run costs against your monitor allowance. Weekly is enough for most signals; daily is for tenders and site visits."
        >
          <Select
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as typeof cadence)
            }
            
          >
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
            <option value="FORTNIGHTLY">Every fortnight</option>
            <option value="MONTHLY">Every month</option>
          </Select>
        </Field>
      </div>

      <FormError message={error} className="mt-3" />

      <div className="mt-4 flex gap-2">
        <Button size="sm" loading={pending} onClick={submit} disabled={!categoryId}>
          Create monitor
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
