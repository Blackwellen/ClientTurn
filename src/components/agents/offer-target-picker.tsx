"use client";

import * as React from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { Checkbox } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  OFFER_SCOPE_LABEL,
  type CatalogueOptions,
  type OfferScope,
  type OfferTarget,
} from "@/lib/agents/offer-target";

/**
 * What an agent sells (0174): the whole catalogue, or chosen offers and the
 * priced items under them. Controlled; the wizard and the agent's Settings tab
 * each own the value and save it through `agent.set_offer_target`.
 *
 * Choosing an offer covers every item under it, so its items are shown ticked
 * and locked; untick the offer to choose items one by one.
 */
export function OfferTargetPicker({
  value,
  onChange,
  catalogue,
  disabled,
}: {
  value: OfferTarget;
  onChange: (next: OfferTarget) => void;
  catalogue: CatalogueOptions;
  disabled?: boolean;
}) {
  const groupId = React.useId();
  const setScope = (scope: OfferScope) =>
    onChange(scope === "CATALOGUE" ? { scope, serviceIds: [], catalogueItemIds: [] } : { ...value, scope });

  const toggleService = (id: string) => {
    const on = value.serviceIds.includes(id);
    const itemIds = catalogue.items.filter((item) => item.serviceId === id).map((item) => item.id);
    onChange({
      scope: "SELECTED",
      serviceIds: on ? value.serviceIds.filter((s) => s !== id) : [...value.serviceIds, id],
      // Choosing the whole offer makes its single-item choices redundant.
      catalogueItemIds: on ? value.catalogueItemIds : value.catalogueItemIds.filter((i) => !itemIds.includes(i)),
    });
  };
  const toggleItem = (id: string) => {
    const on = value.catalogueItemIds.includes(id);
    onChange({
      scope: "SELECTED",
      serviceIds: value.serviceIds,
      catalogueItemIds: on ? value.catalogueItemIds.filter((i) => i !== id) : [...value.catalogueItemIds, id],
    });
  };

  const standalone = catalogue.items.filter((item) => !item.serviceId);
  const empty = catalogue.services.length === 0 && catalogue.items.length === 0;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="What this agent sells" className="grid gap-2 sm:grid-cols-2">
        {(["CATALOGUE", "SELECTED"] as OfferScope[]).map((scope) => (
          <label
            key={scope}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
              value.scope === scope ? "border-accent-600 bg-accent-50" : "border-line bg-surface",
              (disabled || (scope === "SELECTED" && empty)) && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={groupId}
              checked={value.scope === scope}
              disabled={disabled || (scope === "SELECTED" && empty)}
              onChange={() => setScope(scope)}
              className="mt-0.5 accent-[var(--lr-accent-600)]"
            />
            <span>
              <span className="block font-medium text-content">{OFFER_SCOPE_LABEL[scope]}</span>
              <span className="block text-[12px] text-content-muted">
                {scope === "CATALOGUE"
                  ? "Pitches anything you sell, and recommends the best fit for each lead."
                  : "Pitches only what you tick. Never offers anything else."}
              </span>
            </span>
          </label>
        ))}
      </div>

      {empty ? (
        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] text-content-secondary">
          <Package className="mt-0.5 size-4 shrink-0 text-content-muted" aria-hidden />
          <span>
            Your catalogue is empty, so this agent sells whatever the conversation is about. Add products and services in{" "}
            <Link href="/app/settings?section=quotes" className="font-medium text-content-accent underline-offset-4 hover:underline">
              Settings, Quotes &amp; invoices
            </Link>{" "}
            to choose.
          </span>
        </p>
      ) : value.scope === "SELECTED" ? (
        <ul className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-line p-3" aria-label="Products and services">
          {catalogue.services.map((service) => {
            const whole = value.serviceIds.includes(service.id);
            const items = catalogue.items.filter((item) => item.serviceId === service.id);
            return (
              <li key={service.id}>
                <label className="flex items-center gap-2 text-[13px] font-medium text-content">
                  <Checkbox checked={whole} disabled={disabled} onChange={() => toggleService(service.id)} />
                  {service.name}
                  {items.length > 0 && <span className="text-[11.5px] font-normal text-content-muted">all {items.length} items</span>}
                </label>
                {items.length > 0 && (
                  <ul className="ml-6 mt-1.5 space-y-1">
                    {items.map((item) => (
                      <li key={item.id}>
                        <label className="flex items-center gap-2 text-[12.5px] text-content-secondary">
                          <Checkbox
                            checked={whole || value.catalogueItemIds.includes(item.id)}
                            disabled={disabled || whole}
                            onChange={() => toggleItem(item.id)}
                          />
                          {item.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {standalone.map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-2 text-[13px] text-content">
                <Checkbox checked={value.catalogueItemIds.includes(item.id)} disabled={disabled} onChange={() => toggleItem(item.id)} />
                {item.name}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
