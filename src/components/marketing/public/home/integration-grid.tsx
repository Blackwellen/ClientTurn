"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus, Webhook } from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { COMPANY } from "@/lib/marketing/company";
import {
  AVAILABILITY_LABEL,
  type MarketingAvailability,
  type ShowcaseConnector,
  type ShowcaseProvider,
} from "@/lib/marketing/integration-types";

/**
 * The marketplace preview and the supported-provider strip.
 *
 * Every badge is rendered from a state computed on the server against the
 * deployment's own configuration — never from a hard-coded list — so this
 * grid cannot claim an integration the product cannot make. The three states
 * it can render are: a live native connection, the signed webhook bridge, and
 * not yet available.
 */

const BADGE_TONE: Record<MarketingAvailability, string> = {
  native_live:
    "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]",
  webhook_bridge_live:
    "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]",
  platform_managed:
    "border-[var(--pub-border-strong)] bg-[rgb(255_255_255/0.03)] text-[var(--pub-text-secondary)]",
  coming_soon:
    "border-[var(--pub-border)] bg-transparent text-[var(--pub-text-muted)]",
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

function ConnectorLogo({ connector }: { connector: ShowcaseConnector }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-[rgb(255_255_255/0.05)]">
      {connector.logo ? (
        <Image
          src={connector.logo}
          alt=""
          width={24}
          height={24}
          className="size-6 object-contain"
        />
      ) : (
        <Webhook aria-hidden className="size-5 text-[var(--pub-lime)]" strokeWidth={2.1} />
      )}
    </span>
  );
}

export function IntegrationGrid({
  connectors,
  categories,
  providers,
}: {
  connectors: ShowcaseConnector[];
  categories: string[];
  providers: ShowcaseProvider[];
}) {
  const [category, setCategory] = React.useState("All");

  /* One selection drives both halves of the section, so a chip like
     "Lead sources" — which no marketplace connector carries — still has an
     answer in the supported-provider strip below. */
  const visibleConnectors =
    category === "All"
      ? connectors
      : connectors.filter((connector) => connector.category === category);
  const visibleProviders =
    category === "All"
      ? providers
      : providers.filter((provider) => provider.category === category);

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

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {visibleConnectors.map((connector) => (
          <li key={connector.id} className="pub-card pub-card-interactive flex flex-col p-4">
            {/* The badge sits under the name rather than beside it: at six
                columns there is not room for both on one line, and a
                truncated provider name is worse than a stacked badge. */}
            <div className="flex items-start gap-2.5">
              <ConnectorLogo connector={connector} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[var(--pub-text)]">
                  {connector.name}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="truncate text-[11px] text-[var(--pub-text-muted)]">
                    {connector.category}
                  </span>
                  <Badge availability={connector.availability} />
                </span>
              </span>
            </div>
            <p className="mt-3.5 text-[12.5px] leading-relaxed text-[var(--pub-text-secondary)]">
              {connector.description}
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

      {/* Direction of travel, stated plainly. These connectors are an inbound
          bridge — ClientTurn receives contacts, it does not reach into the
          other system — so the grid above must not imply a two-way sync. */}
      <p className="pub-small mt-6 text-center">
        Connector integrations use ClientTurn&rsquo;s signed inbound endpoint: the other system
        sends contacts to ClientTurn. ClientTurn does not read or write data in it.
      </p>

      <ProviderStrip providers={visibleProviders} />
    </>
  );
}

function ProviderStrip({ providers }: { providers: ShowcaseProvider[] }) {
  const live = providers.filter((provider) => provider.availability !== "coming_soon");
  const soon = providers.filter((provider) => provider.availability === "coming_soon");

  return (
    <div className="mt-14 border-t border-[var(--pub-border)] pt-10">
      {live.length > 0 ? (
        <ProviderRow heading="Also supported" providers={live} />
      ) : null}
      {soon.length > 0 ? (
        <div className={live.length > 0 ? "mt-8" : undefined}>
          <ProviderRow heading="Coming soon" providers={soon} dim />
        </div>
      ) : null}
    </div>
  );
}

function ProviderRow({
  heading,
  providers,
  dim,
}: {
  heading: string;
  providers: ShowcaseProvider[];
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
      <p className="pub-footer-heading shrink-0 lg:w-28">{heading}</p>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-3">
        {providers.map((provider) => (
          <li
            key={provider.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-[var(--pub-border)] px-3 py-2",
              dim && "opacity-60",
            )}
          >
            {provider.logo ? (
              <Image
                src={provider.logo}
                alt=""
                width={18}
                height={18}
                className="size-4.5 shrink-0 object-contain"
              />
            ) : null}
            <span className="text-[12.5px] text-[var(--pub-text-secondary)]">{provider.name}</span>
            {provider.availability === "platform_managed" ? (
              <span className="text-[10.5px] text-[var(--pub-text-muted)]">&middot; built in</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ViewAllIntegrations({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="pub-btn pub-btn-primary pub-btn-lg mt-9"
      onClick={() => trackEngagement("public_nav_click", "integrations_view_all")}
    >
      View all integrations
    </Link>
  );
}
