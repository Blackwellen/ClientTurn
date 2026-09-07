"use client";

import * as React from "react";
import Image from "next/image";
import { Plus, Webhook } from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { COMPANY } from "@/lib/marketing/company";
import {
  AVAILABILITY_LABEL,
  type MarketingAvailability,
  type ShowcaseIntegration,
} from "@/lib/marketing/integration-types";

/**
 * The integration marketplace.
 *
 * One grid, one category row. Ad, messaging, booking and CRM providers sit
 * alongside the inbound connectors rather than in a separate strip: someone
 * checking whether their stack is covered should find the answer in one
 * place, and the state badge on each tile carries the distinction that used
 * to be carried by which list a logo was in.
 *
 * Every badge is rendered from a state computed on the server against the
 * deployment's own configuration — never from a hard-coded list — so this
 * grid cannot claim a connection the product cannot make.
 */

const BADGE_TONE: Record<MarketingAvailability, string> = {
  native_live:
    "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]",
  webhook_bridge_live:
    "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]",
  platform_managed:
    "border-[var(--pub-border-strong)] bg-[rgb(255_255_255/0.03)] text-[var(--pub-text-secondary)]",
  coming_soon: "border-[var(--pub-border)] bg-transparent text-[var(--pub-text-muted)]",
};

function Badge({ availability }: { availability: MarketingAvailability }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[9px] font-semibold",
        BADGE_TONE[availability],
      )}
    >
      {AVAILABILITY_LABEL[availability]}
    </span>
  );
}

function TileLogo({ item }: { item: ShowcaseIntegration }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[rgb(255_255_255/0.05)]">
      {item.logo ? (
        <Image src={item.logo} alt="" width={24} height={24} className="size-5 object-contain" />
      ) : (
        <Webhook aria-hidden className="size-5 text-[var(--pub-lime)]" strokeWidth={2.1} />
      )}
    </span>
  );
}

export function IntegrationGrid({
  items,
  categories,
}: {
  items: ShowcaseIntegration[];
  categories: string[];
}) {
  const [category, setCategory] = React.useState("All");

  const visible =
    category === "All" ? items : items.filter((item) => item.category === category);

  return (
    <>
      <div className="mt-14 flex flex-wrap justify-center gap-2">
        {categories.map((item) => {
          const active = item === category;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCategory(item);
                trackEngagement("integration_category_change", item);
              }}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-5 text-[13.5px] font-medium transition-colors",
                active
                  ? "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)] shadow-[0_0_26px_-10px_rgb(183_243_74/0.6)]"
                  : "border-[var(--pub-border)] text-[var(--pub-text-secondary)] hover:border-[var(--pub-border-strong)] hover:text-[var(--pub-text)]",
              )}
            >
              {item === "All" ? "All integrations" : item}
            </button>
          );
        })}
      </div>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {visible.map((item) => (
          <li
            key={item.id}
            className="pub-card pub-card-interactive flex h-full min-w-0 flex-col p-4"
          >
            {/* The badge shares a row with the name rather than being pinned
                over it: reserving a fixed gutter guessed wrong for the longer
                provider names, and "Google Calendar" ran under its badge. */}
            <div className="flex items-start gap-2.5">
              <TileLogo item={item} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="text-[14px] font-semibold leading-tight text-[var(--pub-text)]">
                    {item.name}
                  </span>
                  <Badge availability={item.availability} />
                </span>
                <span className="mt-1 block text-[11px] text-[var(--pub-text-muted)]">
                  {item.category}
                </span>
              </span>
            </div>
            <p className="mt-3.5 text-[12.5px] leading-relaxed text-[var(--pub-text-secondary)]">
              {item.description}
            </p>
          </li>
        ))}

        <li className="pub-card pub-card-interactive col-span-full flex flex-col items-center justify-center p-4 text-center sm:col-span-1">
          <span className="pub-tile" style={{ width: 40, height: 40, borderRadius: 999 }}>
            <Plus aria-hidden className="size-5" strokeWidth={2.2} />
          </span>
          <p className="mt-3 text-[13.5px] font-semibold text-[var(--pub-text)]">
            Need another integration?
          </p>
          <a href={`mailto:${COMPANY.supportEmail}`} className="pub-link mt-2 !text-[13px]">
            Contact support
          </a>
        </li>
      </ul>

      {/* The four states, said once in plain words rather than repeated on
          every tile. "Connector" in particular has to be explained: those are
          an inbound bridge, not a two-way sync. */}
      <dl className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[12.5px]">
        {(
          [
            ["native_live", "Connect it from Settings."],
            [
              "webhook_bridge_live",
              "The other system sends contacts to ClientTurn's signed endpoint.",
            ],
            ["platform_managed", "Run by ClientTurn on your behalf."],
            ["coming_soon", "Being set up for launch."],
          ] as [MarketingAvailability, string][]
        ).map(([state, meaning]) => (
          <div key={state} className="flex items-center gap-2">
            <dt>
              <Badge availability={state} />
            </dt>
            <dd className="text-[var(--pub-text-muted)]">{meaning}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
