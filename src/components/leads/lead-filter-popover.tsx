"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox, Select, Switch } from "@/components/ui/form";
import { LEAD_STATUS } from "@/components/ui/badge";
import {
  DATE_RANGES,
  LEAD_STATUSES,
  activeFilterCount,
  type LeadFilters,
} from "@/lib/leads/filters";
import type { FilterOptions } from "@/lib/leads/types";
import { useLeadParams } from "./use-lead-params";

/** Draft state so the popover only touches the URL when Apply is pressed. */
type Draft = {
  status: string[];
  service: string[];
  source: string[];
  form: string;
  campaign: string;
  assignee: string;
  range: string;
  attention: boolean;
};

function toDraft(filters: LeadFilters): Draft {
  return {
    status: filters.status ? [...filters.status] : [],
    service: filters.service ? [...filters.service] : [],
    source: filters.source ? [...filters.source] : [],
    form: filters.form ?? "",
    campaign: filters.campaign ?? "",
    assignee: filters.assignee ?? "",
    range: filters.range,
    attention: Boolean(filters.attention),
  };
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
        {label}
      </p>
      {children}
    </div>
  );
}

function CheckList({
  items,
  selected,
  onToggle,
  emptyLabel,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-content-subtle">{emptyLabel}</p>;
  }
  return (
    <div className="max-h-[132px] space-y-1 overflow-y-auto pr-1">
      {items.map((item) => (
        <label
          key={item.id}
          className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] text-content-secondary hover:bg-surface-hover"
        >
          <Checkbox
            checked={selected.includes(item.id)}
            onChange={() => onToggle(item.id)}
          />
          <span className="truncate">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

export function LeadFilterButton({
  filters,
  options,
}: {
  filters: LeadFilters;
  options: FilterOptions;
}) {
  const { setFilter } = useLeadParams();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(filters));
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const count = activeFilterCount(filters);

  // Re-seed the draft whenever the popover opens so it always reflects what is
  // actually applied, including changes made elsewhere (chips, deep links).
  const openPanel = () => {
    setDraft(toDraft(filters));
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    panelRef.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (key: "status" | "service" | "source", id: string) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));

  const apply = () => {
    setFilter({
      status: draft.status.length ? draft.status.join(",") : null,
      service: draft.service.length ? draft.service.join(",") : null,
      source: draft.source.length ? draft.source.join(",") : null,
      form: draft.form || null,
      campaign: draft.campaign || null,
      assignee: draft.assignee || null,
      range: draft.range === "all" ? null : draft.range,
      attention: draft.attention ? "1" : null,
    });
    setOpen(false);
  };

  const clear = () => {
    setDraft({
      status: [],
      service: [],
      source: [],
      form: "",
      campaign: "",
      assignee: "",
      range: "all",
      attention: false,
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium",
          "transition-colors duration-[var(--lr-duration-fast)]",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
          count > 0 || open
            ? "border-accent-300 bg-accent-50 text-content"
            : "border-line-strong bg-surface text-content-secondary hover:bg-surface-hover",
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filters
        {count > 0 && (
          <span
            aria-label={`${count} active`}
            className="size-1.5 rounded-full bg-accent-500"
          />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter leads"
          className={cn(
            "absolute left-0 top-[calc(100%+6px)] z-40 w-[min(560px,calc(100vw-2rem))]",
            "rounded-xl border border-line bg-surface p-4 shadow-lg",
            "animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]",
          )}
        >
          <p className="mb-3 text-[13px] font-semibold text-content">
            Filter leads
          </p>

          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <Group label="Status">
              <CheckList
                items={LEAD_STATUSES.map((status) => ({
                  id: status,
                  label: LEAD_STATUS[status].label,
                }))}
                selected={draft.status}
                onToggle={(id) => toggle("status", id)}
                emptyLabel="No statuses"
              />
            </Group>

            <Group label="Service">
              <CheckList
                items={options.services.map((service) => ({
                  id: service.id,
                  label: service.name,
                }))}
                selected={draft.service}
                onToggle={(id) => toggle("service", id)}
                emptyLabel="No services configured yet."
              />
            </Group>

            <Group label="Source">
              <CheckList
                items={options.sources}
                selected={draft.source}
                onToggle={(id) => toggle("source", id)}
                emptyLabel="No lead sources yet."
              />
            </Group>

            <div className="space-y-4">
              {options.forms.length > 0 && (
                <Group label="Meta form">
                  <Select
                    aria-label="Meta form"
                    value={draft.form}
                    onChange={(event) =>
                      setDraft((c) => ({ ...c, form: event.target.value }))
                    }
                    className="h-9 text-[13px]"
                  >
                    <option value="">Any form</option>
                    {options.forms.map((form) => (
                      <option key={form.id} value={form.id}>
                        {form.label}
                      </option>
                    ))}
                  </Select>
                </Group>
              )}

              {options.campaigns.length > 0 && (
                <Group label="Campaign">
                  <Select
                    aria-label="Campaign"
                    value={draft.campaign}
                    onChange={(event) =>
                      setDraft((c) => ({ ...c, campaign: event.target.value }))
                    }
                    className="h-9 text-[13px]"
                  >
                    <option value="">Any campaign</option>
                    {options.campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.label}
                      </option>
                    ))}
                  </Select>
                </Group>
              )}

              <Group label="Assigned user">
                <Select
                  aria-label="Assigned user"
                  value={draft.assignee}
                  onChange={(event) =>
                    setDraft((c) => ({ ...c, assignee: event.target.value }))
                  }
                  className="h-9 text-[13px]"
                >
                  <option value="">Anyone</option>
                  <option value="unassigned">Unassigned</option>
                  {options.members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Group>

              <Group label="Date">
                <Select
                  aria-label="Date range"
                  value={draft.range}
                  onChange={(event) =>
                    setDraft((c) => ({ ...c, range: event.target.value }))
                  }
                  className="h-9 text-[13px]"
                >
                  {DATE_RANGES.map((range) => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </Select>
              </Group>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-subtle pt-3">
            <span className="flex items-center gap-2 text-[13px] text-content-secondary">
              <Switch
                checked={draft.attention}
                onCheckedChange={(next) =>
                  setDraft((c) => ({ ...c, attention: next }))
                }
                label="Needs attention only"
              />
              Needs attention only
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
              <Button size="sm" onClick={apply}>
                Apply filters
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
