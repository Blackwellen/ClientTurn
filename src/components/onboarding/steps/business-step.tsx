"use client";

import * as React from "react";
import { ChevronDown, Lightbulb, MoreVertical, Plus, Trash2 } from "lucide-react";
import { OField, OInput, OSelect, OToggle, OButton, OPanel, OSectionTitle } from "../ui";
import type { StepActions } from "../step-types";
import { INDUSTRIES, TIMEZONES, DAYS, type BusinessHours, type DayKey } from "@/lib/settings/types";
import { suggestedServicesFor } from "@/lib/onboarding/steps";
import type { BusinessStepInput } from "@/lib/onboarding/actions";

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
  onRegisterActions,
}: {
  initial: BusinessInitial;
  onContinue: (payload: BusinessStepInput) => void;
  onSaveExit: (payload: BusinessStepInput) => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [business, setBusiness] = React.useState(initial.business);
  const [hours, setHours] = React.useState<BusinessHours>(initial.hours);
  const [serviceArea, setServiceArea] = React.useState(initial.serviceAreaDescription);
  const [services, setServices] = React.useState<ServiceRow[]>(
    initial.services.length > 0
      ? initial.services
      : [{ name: "", description: "", averageValue: "", active: true }],
  );
  const [deletedIds, setDeletedIds] = React.useState<string[]>([]);

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

  const disabledReason =
    !business.name.trim()
      ? "Add your business name before continuing."
      : services.filter((s) => s.name.trim().length > 1).length === 0
        ? "Add at least one service before continuing."
        : undefined;

  React.useEffect(() => {
    onRegisterActions({
      continue: () => onContinue(buildPayload()),
      saveExit: () => onSaveExit(buildPayload()),
      disabledReason,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, hours, serviceArea, services, deletedIds, disabledReason]);

  function addService(name = "") {
    setServices((prev) => [...prev, { name, description: "", averageValue: "", active: true }]);
  }

  function removeService(index: number) {
    setServices((prev) => {
      const target = prev[index];
      if (target.id) setDeletedIds((ids) => [...ids, target.id!]);
      return prev.filter((_, i) => i !== index);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1.25fr_0.85fr]">
      <div className="space-y-5">
        <div>
          <OSectionTitle>Business details</OSectionTitle>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <OField label="Business name" htmlFor="ob-name" required>
              <OInput
                id="ob-name"
                value={business.name}
                onChange={(e) => setBusiness({ ...business, name: e.target.value })}
              />
            </OField>
            <OField label="Industry" htmlFor="ob-industry">
              <OSelect
                id="ob-industry"
                value={business.industry}
                onChange={(e) => setBusiness({ ...business, industry: e.target.value })}
              >
                <option value="">Choose an industry</option>
                {INDUSTRIES.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </OSelect>
            </OField>
            <OField label="Website" htmlFor="ob-website" hint="Optional.">
              <OInput
                id="ob-website"
                type="url"
                placeholder="https://"
                value={business.website}
                onChange={(e) => setBusiness({ ...business, website: e.target.value })}
              />
            </OField>
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <OField label="Phone" htmlFor="ob-phone">
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

        <div>
          <OSectionTitle hint="Set when you're available to take calls and book appointments.">
            Business hours
          </OSectionTitle>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
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
          <OSectionTitle hint="Where do you serve customers? Add your city, regions or postcode areas.">
            Service area
          </OSectionTitle>
          <OInput
            value={serviceArea}
            placeholder="Bristol, Bath, South Gloucestershire, North Somerset"
            onChange={(e) => setServiceArea(e.target.value)}
            aria-label="Service area"
          />
          <p className="mt-1.5 text-[12px] text-[#697488]">
            e.g. Bristol, Bath, South Gloucestershire or BS1, BS2, BS3
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
              onChange={(next) => setServices((prev) => prev.map((s, j) => (j === i ? next : s)))}
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
          hint={`Popular services for ${business.industry ? business.industry.toLowerCase() : "home service"} businesses. Add the ones you offer.`}
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
