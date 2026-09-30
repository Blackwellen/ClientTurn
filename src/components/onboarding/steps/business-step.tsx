"use client";

import * as React from "react";
import { ChevronDown, Globe, Lightbulb, MoreVertical, Plus, Trash2 } from "lucide-react";
import { OField, OInput, OSelect, OToggle, OButton, OPanel, OSectionTitle } from "../ui";
import type { StepActions } from "../step-types";
import { industryOptionsFor, TIMEZONES, DAYS, type BusinessHours, type DayKey } from "@/lib/settings/types";
import { defaultServicesFor, suggestedServicesFor } from "@/lib/onboarding/steps";
import { prefillFromWebsite, type BusinessStepInput } from "@/lib/onboarding/actions";
import { validateWorkspaceName } from "@/lib/auth/workspace-name";

export type BusinessInitial = {
  business: {
    name: string;
    industry: string;
    website: string;
    phone: string;
    timezone: string;
  };
  hours: BusinessHours;
  serviceAreaDescription: string;
  /** Grey placeholder for the empty name field, e.g. "e.g. Acme Digital". Never a value. */
  namePlaceholder: string;
  /** True for a brand-new workspace: start with `defaultServices` pre-selected. */
  suggestedDefaults: boolean;
  defaultServices: string[];
  services: {
    id?: string;
    name: string;
    description: string;
    averageValue: string;
    active: boolean;
  }[];
};

type ServiceRow = BusinessInitial["services"][number];

function currency(value: string) {
  if (!value) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `£${n.toLocaleString("en-GB")}`;
}

function TimeField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative">
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-7 w-full rounded-[5px] border border-[rgba(150,170,190,0.28)] bg-[#0d1720] px-1.5 pr-5 text-[11.5px] text-[#dbe1ea] outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-[#7a8698]"
        aria-hidden
      />
    </div>
  );
}

function ServiceCard({
  service,
  onChange,
  onRemove,
}: {
  service: ServiceRow;
  onChange: (next: ServiceRow) => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <OPanel className="relative bg-[#0c151d] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <OInput
            value={service.name}
            onChange={(e) => onChange({ ...service, name: e.target.value })}
            placeholder="Service name"
            aria-label="Service name"
            className="h-6 border-none bg-transparent px-0 text-[14px] font-semibold focus:ring-0"
          />
          <p className="truncate px-0 text-[12px] leading-tight text-[#8c98ab]">
            {service.description || "No description yet"}
          </p>
        </div>
        <div className="relative flex shrink-0 items-center gap-2 pt-0.5">
          <OToggle
            checked={service.active}
            onChange={(checked) => onChange({ ...service, active: checked })}
            label={`${service.name || "Service"} active`}
          />
          <button
            type="button"
            aria-label={`Options for ${service.name || "service"}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="text-[#7a8698] transition-colors hover:text-[#eef2f7]"
          >
            <MoreVertical className="size-3.5" aria-hidden />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-6 right-0 z-20 min-w-[140px] overflow-hidden rounded-[8px] border border-[rgba(150,170,190,0.3)] bg-[#0d1720] shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-[#ff6b70] hover:bg-[rgba(255,107,112,0.08)]"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Remove service
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-[104px_1fr] gap-2">
        <div className="min-w-0">
          <label className="mb-1 block text-[11.5px] font-medium text-[#96a1b3]">Average value</label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[12.5px] text-[#8c98ab]">
              £
            </span>
            <OInput
              type="number"
              min={0}
              value={service.averageValue}
              placeholder="0"
              onChange={(e) => onChange({ ...service, averageValue: e.target.value })}
              aria-label={`${service.name || "Service"} average value`}
              className="h-8 pl-5 text-[13px]"
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-[11.5px] font-medium text-[#96a1b3]">
            Internal description (optional)
          </label>
          <OInput
            value={service.description}
            onChange={(e) => onChange({ ...service, description: e.target.value })}
            placeholder="Notes for your team"
            aria-label={`${service.name || "Service"} description`}
            className="h-8 text-[13px]"
          />
        </div>
      </div>
      {service.averageValue && (
        <p className="mt-1 text-[11px] text-[#697488]">
          Shown internally as {currency(service.averageValue)}. Never quoted to a lead.
        </p>
      )}
    </OPanel>
  );
}

export function BusinessStep({
  initial,
  onContinue,
  onSaveExit,
  onSkipToGoLive,
  onRegisterActions,
}: {
  initial: BusinessInitial;
  onContinue: (payload: BusinessStepInput) => void;
  onSaveExit: (payload: BusinessStepInput) => void;
  /** Saves this step, applies the recommended setup for the rest, and goes to the last step. */
  onSkipToGoLive?: (payload: BusinessStepInput) => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [business, setBusiness] = React.useState(initial.business);
  const [hours, setHours] = React.useState<BusinessHours>(initial.hours);
  const [serviceArea, setServiceArea] = React.useState(initial.serviceAreaDescription);
  const [services, setServices] = React.useState<ServiceRow[]>(
    initial.services.length > 0
      ? initial.services
      : initial.suggestedDefaults && initial.defaultServices.length > 0
        ? initial.defaultServices.map((name) => ({ name, description: "", averageValue: "", active: true }))
        : [{ name: "", description: "", averageValue: "", active: true }],
  );
  // While the pre-selected services are untouched, choosing an industry swaps
  // them for that industry's; once edited, they are the owner's and stay.
  const [servicesUntouched, setServicesUntouched] = React.useState(
    initial.services.length === 0 && initial.suggestedDefaults,
  );
  const [deletedIds, setDeletedIds] = React.useState<string[]>([]);
  const [prefilling, setPrefilling] = React.useState(false);
  const [prefillNote, setPrefillNote] = React.useState<{
    tone: "ok" | "error";
    text: string;
    suggestedName?: string;
  } | null>(null);

  function editServices(update: (prev: ServiceRow[]) => ServiceRow[]) {
    setServicesUntouched(false);
    setServices(update);
  }

  function chooseIndustry(industry: string) {
    setBusiness((current) => ({ ...current, industry }));
    if (servicesUntouched) {
      setServices(defaultServicesFor(industry).map((name) => ({ name, description: "", averageValue: "", active: true })));
    }
  }

  async function prefill() {
    if (prefilling) return;
    setPrefilling(true);
    setPrefillNote(null);
    try {
      const result = await prefillFromWebsite(business.website);
      if (!result.ok) {
        setPrefillNote({ tone: "error", text: result.error });
        return;
      }
      const found: string[] = [];
      setBusiness((current) => ({
        ...current,
        website: result.website,
        phone: current.phone || result.prefill.phone || "",
      }));
      if (result.prefill.phone) found.push("phone");
      if (result.prefill.industry && !business.industry) {
        chooseIndustry(result.prefill.industry);
        found.push("industry");
      }
      const suggestedName = result.registry?.registeredName ?? result.prefill.siteName ?? undefined;
      setPrefillNote({
        tone: "ok",
        text:
          found.length > 0
            ? `Filled in your ${found.join(" and ")} from your website. Check them below.`
            : "We read your website but found nothing we could fill in with confidence.",
        suggestedName: suggestedName && !business.name.trim() ? suggestedName : undefined,
      });
    } finally {
      setPrefilling(false);
    }
  }

  const suggestions = suggestedServicesFor(business.industry).filter(
    (name) => !services.some((s) => s.name.trim().toLowerCase() === name.toLowerCase()),
  );

  function buildPayload(): BusinessStepInput {
    return {
      name: business.name,
      industry: business.industry,
      website: business.website,
      phone: business.phone,
      timezone: business.timezone,
      serviceAreaDescription: serviceArea,
      hours,
      services: services
        .filter((s) => s.name.trim().length > 1)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          averageValue: s.averageValue,
          active: s.active,
        })),
      deletedServiceIds: deletedIds,
    };
  }

  const naming = validateWorkspaceName(business.name);
  const disabledReason =
    !naming.ok
      ? naming.error
      : services.filter((s) => s.name.trim().length > 1).length === 0
        ? "Add at least one service before continuing."
        : undefined;

  React.useEffect(() => {
    onRegisterActions({
      continue: () => onContinue(buildPayload()),
      saveExit: () => onSaveExit(buildPayload()),
      skipToGoLive: onSkipToGoLive ? () => onSkipToGoLive(buildPayload()) : undefined,
      disabledReason,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, hours, serviceArea, services, deletedIds, disabledReason]);

  function addService(name = "") {
    editServices((prev) => [...prev, { name, description: "", averageValue: "", active: true }]);
  }

  function removeService(index: number) {
    editServices((prev) => {
      const target = prev[index];
      if (target.id) setDeletedIds((ids) => [...ids, target.id!]);
      return prev.filter((_, i) => i !== index);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1.25fr_0.85fr]">
      <div className="space-y-5">
        <div>
          <OSectionTitle hint="Start with your website and we will fill in what we can. Everything stays editable.">
            Business details
          </OSectionTitle>
          <OField label="Website" htmlFor="ob-website" hint="Optional. We read your home page once to suggest your industry and phone.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <OInput
                id="ob-website"
                type="url"
                inputMode="url"
                placeholder="acme.co.uk"
                value={business.website}
                onChange={(e) => setBusiness({ ...business, website: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void prefill();
                  }
                }}
              />
              <OButton
                variant="secondary"
                className="shrink-0"
                loading={prefilling}
                disabled={!business.website.trim() || prefilling}
                onClick={() => void prefill()}
              >
                <Globe className="size-3.5" aria-hidden />
                Fill in from website
              </OButton>
            </div>
          </OField>
          {prefillNote && (
            <div
              role="status"
              className={
                prefillNote.tone === "ok"
                  ? "mt-2 rounded-[8px] border border-[rgba(168,255,31,0.22)] bg-[rgba(168,255,31,0.05)] p-2.5 text-[12.5px] text-[#c8ffa0]"
                  : "mt-2 rounded-[8px] border border-[rgba(255,176,32,0.3)] bg-[rgba(255,176,32,0.06)] p-2.5 text-[12.5px] text-[#ffcf7a]"
              }
            >
              {prefillNote.text}
              {prefillNote.suggestedName && (
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[#c7d0dc]">Your website calls you {prefillNote.suggestedName}.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setBusiness((current) => ({ ...current, name: prefillNote.suggestedName ?? current.name }));
                      setPrefillNote((note) => (note ? { ...note, suggestedName: undefined } : note));
                    }}
                    className="font-semibold text-[var(--auth-lime)] underline-offset-4 hover:underline"
                  >
                    Use this name
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <OField
              label="Workspace name"
              htmlFor="ob-name"
              required
              hint="Usually your company name. Your team sees it; you can change it later in Settings."
            >
              <OInput
                id="ob-name"
                value={business.name}
                placeholder={initial.namePlaceholder}
                autoComplete="organization"
                maxLength={120}
                aria-required="true"
                onChange={(e) => setBusiness({ ...business, name: e.target.value })}
              />
            </OField>
            <OField label="Industry" htmlFor="ob-industry" hint="Picks the starting services on the right.">
              <OSelect
                id="ob-industry"
                value={business.industry}
                onChange={(e) => chooseIndustry(e.target.value)}
              >
                <option value="">Choose an industry</option>
                {industryOptionsFor(business.industry).map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </OSelect>
            </OField>
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <OField label="Phone" htmlFor="ob-phone" hint="Optional.">
              <OInput
                id="ob-phone"
                value={business.phone}
                onChange={(e) => setBusiness({ ...business, phone: e.target.value })}
              />
            </OField>
            <OField
              label="Timezone"
              htmlFor="ob-tz"
              hint="Quiet hours and every timestamp use this."
            >
              <OSelect
                id="ob-tz"
                value={business.timezone}
                onChange={(e) => setBusiness({ ...business, timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </OSelect>
            </OField>
          </div>
        </div>

        {/* Seven day cards only when the column is wide enough for a time
            field to show "08:00" whole; the business column is narrow beside
            the services panels, so it wraps to four there (8.7). */}
        <div className="@container/hours">
          <OSectionTitle hint="Optional. When you take calls and meetings; change it only if these are wrong.">
            Business hours
          </OSectionTitle>
          <div className="grid grid-cols-2 gap-2 @sm/hours:grid-cols-4 @2xl/hours:grid-cols-7">
            {DAYS.map((day) => {
              const entry = hours[day.key as DayKey];
              return (
                <div
                  key={day.key}
                  className="rounded-[8px] border border-[rgba(150,170,190,0.25)] bg-[#0b141d] p-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[12px] font-medium text-[#c3cbd8]">
                      {day.label.slice(0, 3)}
                    </span>
                    <OToggle
                      checked={entry.open}
                      onChange={(open) =>
                        setHours({ ...hours, [day.key]: { ...entry, open } })
                      }
                      label={`${day.label} open`}
                    />
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {entry.open ? (
                      <>
                        <TimeField
                          value={entry.start}
                          onChange={(v) => setHours({ ...hours, [day.key]: { ...entry, start: v } })}
                          label={`${day.label} opens`}
                        />
                        <TimeField
                          value={entry.end}
                          onChange={(v) => setHours({ ...hours, [day.key]: { ...entry, end: v } })}
                          label={`${day.label} closes`}
                        />
                      </>
                    ) : (
                      <>
                        <span className="flex h-7 w-full items-center rounded-[5px] border border-[rgba(150,170,190,0.18)] bg-[#0d1720] px-1.5 text-[11.5px] text-[#5c6981]">
                          Closed
                        </span>
                        <span className="flex h-7 w-full items-center rounded-[5px] border border-[rgba(150,170,190,0.18)] bg-[#0d1720] px-1.5 text-[11.5px] text-[#5c6981]">
                          Closed
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <OSectionTitle hint="Optional. Where you work with clients, if it matters.">
            Service area
          </OSectionTitle>
          <OInput
            value={serviceArea}
            placeholder="UK-wide, or London and the South East"
            onChange={(e) => setServiceArea(e.target.value)}
            aria-label="Service area"
          />
          <p className="mt-1.5 text-[12px] text-[#697488]">
            e.g. UK-wide, Manchester and the North West, or EMEA
          </p>
        </div>
      </div>

      <div className="rounded-[14px] border border-[rgba(130,155,180,0.2)] bg-[rgba(255,255,255,0.012)] p-4">
        <OSectionTitle hint="Add the services you offer. These will be used to qualify leads and tailor follow-ups.">
          Your services
        </OSectionTitle>
        <div className="space-y-2">
          {services.map((service, i) => (
            <ServiceCard
              key={i}
              service={service}
              onChange={(next) => editServices((prev) => prev.map((s, j) => (j === i ? next : s)))}
              onRemove={() => removeService(i)}
            />
          ))}
        </div>
        <OButton
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => addService()}
        >
          <Plus className="size-3.5" aria-hidden />
          Add another service
        </OButton>
      </div>

      <div className="rounded-[14px] border border-[rgba(130,155,180,0.2)] bg-[rgba(255,255,255,0.012)] p-4">
        <OSectionTitle
          hint={`Popular services for ${business.industry ? industryPhrase(business.industry) : "B2B"} businesses. Add the ones you offer.`}
        >
          Suggested services
        </OSectionTitle>
        <ul className="space-y-1.5">
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => addService(name)}
                className="flex w-full items-center gap-2 rounded-[7px] border border-[rgba(150,170,190,0.22)] bg-[#0b141d] px-2.5 py-2 text-left text-[13px] text-[#dbe1ea] transition-colors hover:border-[rgba(168,255,31,0.45)] hover:text-[var(--auth-lime)]"
              >
                <Plus className="size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
                {name}
              </button>
            </li>
          ))}
          {suggestions.length === 0 && (
            <li className="text-[13px] text-[#697488]">
              You&rsquo;ve added every suggested service.
            </li>
          )}
        </ul>
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-[rgba(168,255,31,0.22)] bg-[rgba(168,255,31,0.05)] p-2.5">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-[var(--auth-lime)]" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-[#c8ffa0]">
            Add at least 3 services to get the best results from ClientTurn.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Lower-cases an industry label for use mid-sentence, but keeps acronyms such
 * as "B2B" and "SaaS" as written ("b2b saas businesses" read as a typo).
 */
function industryPhrase(industry: string): string {
  return industry
    .split(/\s+/)
    .map((word) => (/[A-Z].*[A-Z0-9]/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}
