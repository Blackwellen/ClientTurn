"use client";

import * as React from "react";
import {
  BarChart3,
  Layers,
  Lightbulb,
  Link2,
  Plus,
  QrCode as QrIcon,
  Search,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  CopyButton,
  Panel,
  PanelEmpty,
  Sparkline,
  Table,
  Td,
} from "@/components/affiliates/portal-ui";
import { QrCode } from "./qr-code";
import { createLink } from "@/lib/affiliates/actions";
import { requestPromoCode } from "@/lib/affiliates/link-actions";
import { ALLOWED_DESTINATIONS } from "@/lib/affiliates/types";
import { formatPercent } from "@/lib/affiliates/programme";
import type { LinkMetrics } from "@/lib/affiliates/analytics";
import type { PortalPromoCode, PromoOffer } from "@/lib/affiliates/portal";

/**
 * The links workspace (V4 §31).
 *
 * The generator, the UTM builder and the QR card are all client-side because
 * they are live previews — but none of them decides anything. The referral URL
 * is only real once the server has created the link, validated the destination
 * against the allow-list and issued a slug. What is previewed here is a
 * prediction; what is copied from the table is the real thing.
 */
export function LinksView({
  affiliateCode,
  origin,
  links,
  promoCodes,
  promoOffers,
  clickSeries,
  monthly,
}: {
  affiliateCode: string;
  origin: string;
  links: LinkMetrics[];
  promoCodes: PortalPromoCode[];
  promoOffers: PromoOffer[];
  clickSeries: number[];
  monthly: { clicks: number; signups: number; conversionRate: number | null };
}) {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [campaignFilter, setCampaignFilter] = React.useState("all");
  const [selectedLinkId, setSelectedLinkId] = React.useState(
    links[0]?.linkId ?? "",
  );

  const campaigns = React.useMemo(
    () =>
      [...new Set(links.map((link) => link.campaignName ?? link.utmCampaign).filter(Boolean))] as string[],
    [links],
  );

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return links.filter((link) => {
      if (needle && !link.label.toLowerCase().includes(needle)) return false;
      if (campaignFilter !== "all") {
        const name = link.campaignName ?? link.utmCampaign;
        if (name !== campaignFilter) return false;
      }
      if (statusFilter === "converting" && link.paidCustomers === 0) return false;
      if (statusFilter === "idle" && link.clicks > 0) return false;
      return true;
    });
  }, [links, search, statusFilter, campaignFilter]);

  const selected =
    links.find((link) => link.linkId === selectedLinkId) ?? links[0] ?? null;

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.78fr)]">
        <LinkGenerator affiliateCode={affiliateCode} origin={origin} />
        <UtmBuilder origin={origin} affiliateCode={affiliateCode} />

        <Panel icon={BarChart3} title="Link performance this month">
          <div className="px-4 pb-4">
            <dl className="grid grid-cols-3 gap-2">
              <MiniStat
                label="Clicks"
                value={monthly.clicks.toLocaleString("en-GB")}
              />
              <MiniStat
                label="Signups"
                value={monthly.signups.toLocaleString("en-GB")}
              />
              <MiniStat
                label="Conversion rate"
                value={formatPercent(monthly.conversionRate)}
              />
            </dl>
            {clickSeries.length > 1 && (
              <Sparkline values={clickSeries} className="mt-4 h-20 w-full" />
            )}
            <a
              href="/affiliates/app/performance"
              className="mt-3 inline-block text-[12.5px] font-medium text-content-accent underline underline-offset-4"
            >
              View detailed performance →
            </a>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)_minmax(0,0.8fr)]">
        <PromoCodes codes={promoCodes} offers={promoOffers} />

        <Panel
          icon={QrIcon}
          title="QR Generator"
          description="Create a QR code for any of your referral links."
        >
          <div className="px-4 pb-4">
            {links.length === 0 ? (
              <PanelEmpty title="Create a link first." />
            ) : (
              <>
                <label
                  htmlFor="qr-link"
                  className="text-[12px] font-medium text-content-secondary"
                >
                  Select link
                </label>
                <select
                  id="qr-link"
                  value={selected?.linkId ?? ""}
                  onChange={(event) => setSelectedLinkId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content"
                >
                  {links.map((link) => (
                    <option key={link.linkId} value={link.linkId}>
                      {link.label}
                    </option>
                  ))}
                </select>

                {selected && (
                  <div className="mt-3 flex flex-wrap items-start gap-4">
                    <QrCode
                      value={`${origin}/r/${selected.slug}`}
                      fileName={`${selected.slug}-qr.png`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-content">
                        {selected.label}
                      </p>
                      <p className="mt-0.5 break-all text-[12px] text-content-accent">
                        {origin}/r/{selected.slug}
                      </p>
                      <CopyButton
                        className="mt-2.5"
                        value={`${origin}/r/${selected.slug}`}
                        label="Copy link"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        <Panel icon={Lightbulb} title="Quick tips">
          <ol className="space-y-3 px-4 pb-4">
            {TIPS.map((tip, index) => (
              <li key={tip.title} className="flex gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-accent-50 text-[11.5px] font-bold text-content-accent">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-content">
                    {tip.title}
                  </p>
                  <p className="text-[12px] leading-relaxed text-content-muted">
                    {tip.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel
        className="mt-3"
        icon={Link2}
        title="Campaign Links"
        description="All your affiliate links, campaign URLs and performance data."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-content-subtle"
                aria-hidden
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search links…"
                aria-label="Search links"
                className="h-9 w-[190px] rounded-[9px] border border-line bg-surface pl-8 pr-3 text-[13px] text-content placeholder:text-content-subtle"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
            >
              <option value="all">All status</option>
              <option value="converting">Converting</option>
              <option value="idle">No clicks yet</option>
            </select>
            <select
              value={campaignFilter}
              onChange={(event) => setCampaignFilter(event.target.value)}
              aria-label="Filter by campaign"
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
            >
              <option value="all">All campaigns</option>
              {campaigns.map((campaign) => (
                <option key={campaign} value={campaign}>
                  {campaign}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {filtered.length === 0 ? (
          <PanelEmpty
            title={links.length === 0 ? "No affiliate links yet." : "No links match your filters."}
            description={
              links.length === 0
                ? "Create your first link above and share it to start earning."
                : "Try a different search or clear the filters."
            }
          />
        ) : (
          <>
            <Table
              minWidth={1100}
              headers={[
                { label: "Link name" },
                { label: "Destination" },
                { label: "UTM campaign" },
                { label: "Promo code" },
                { label: "Clicks", numeric: true },
                { label: "Signups", numeric: true },
                { label: "Trials", numeric: true },
                { label: "Paid customers", numeric: true },
                { label: "Conversion rate", numeric: true },
                { label: "Last updated" },
                { label: "Actions", srOnly: true },
              ]}
            >
              {filtered.map((link) => (
                <tr key={link.linkId} className="hover:bg-surface-hover">
                  <Td className="font-medium">{link.label}</Td>
                  <Td>
                    <span className="text-content-accent">
                      clientturn.com
                      {link.destinationPath === "/" ? "" : link.destinationPath}
                    </span>
                  </Td>
                  <Td className="text-content-secondary">
                    {link.utmCampaign ?? "—"}
                  </Td>
                  <Td className="text-content-secondary">
                    {link.promoCode ?? "—"}
                  </Td>
                  <Td numeric>{link.clicks.toLocaleString("en-GB")}</Td>
                  <Td numeric>{link.signups.toLocaleString("en-GB")}</Td>
                  <Td numeric>{link.trials.toLocaleString("en-GB")}</Td>
                  <Td numeric>{link.paidCustomers.toLocaleString("en-GB")}</Td>
                  <Td numeric>{formatPercent(link.conversionRate)}</Td>
                  <Td className="whitespace-nowrap text-content-secondary">
                    {new Date(link.updatedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Td>
                  <Td>
                    <CopyButton value={`${origin}/r/${link.slug}`} label="Copy" />
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="px-4 py-3 text-[12.5px] text-content-muted">
              Showing 1–{filtered.length} of {links.length} links
            </p>
          </>
        )}
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------- generator -- */

function LinkGenerator({
  affiliateCode,
  origin,
}: {
  affiliateCode: string;
  origin: string;
}) {
  const { toast } = useToast();
  // ALLOWED_DESTINATIONS is a const-asserted tuple, so the inferred state
  // type would be the first entry's literal path rather than any allowed one.
  const [destination, setDestination] = React.useState<string>(
    ALLOWED_DESTINATIONS[0].path,
  );
  const [label, setLabel] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  // A preview, not a promise. The real slug is issued by the server on create.
  const preview = `${origin}${destination === "/" ? "/" : destination}?ref=${affiliateCode}`;

  function onCreate() {
    if (label.trim().length < 2) {
      toast({ variant: "error", title: "Give the link a name first" });
      return;
    }

    startTransition(async () => {
      const result = await createLink({
        label: label.trim(),
        destinationPath: destination,
        utmSource: "affiliate",
        utmMedium: "referral",
      });

      if (result.ok) {
        toast({ variant: "success", title: result.message ?? "Link created." });
        setLabel("");
      } else {
        toast({ variant: "error", title: "Link not created", description: result.error });
      }
    });
  }

  return (
    <Panel
      icon={Link2}
      title="Referral Link Generator"
      description="Create a trackable referral link for any page on ClientTurn."
    >
      <div className="space-y-3 px-4 pb-4">
        <Field label="Destination page" htmlFor="destination">
          <select
            id="destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content"
          >
            {ALLOWED_DESTINATIONS.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.label} (clientturn.com{entry.path === "/" ? "" : entry.path})
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Link name"
          hint="(internal only)"
          htmlFor="link-name"
          counter={`${label.length}/100`}
        >
          <input
            id="link-name"
            value={label}
            maxLength={100}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Homepage CTA"
            className="h-10 w-full rounded-[9px] border border-line bg-surface px-3 text-[13.5px] text-content placeholder:text-content-subtle"
          />
        </Field>

        <div>
          <p className="text-[12px] font-medium text-content-secondary">
            Referral link preview
          </p>
          <div className="mt-1 flex items-center gap-2 rounded-[9px] border border-line bg-surface-sunken px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-content-accent">
              {preview}
            </span>
            <CopyButton value={preview} label="Copy" />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-content-muted">
            This link includes your unique affiliate ID and will be tracked
            automatically.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCreate}
            disabled={pending}
            className={cn(
              "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[9px]",
              "bg-accent-500 text-[13.5px] font-semibold text-brand-midnight",
              "transition-colors hover:bg-[#a6e238] disabled:opacity-60",
            )}
          >
            {pending ? "Generating…" : "Generate link"}
            {!pending && <Plus className="size-4" aria-hidden />}
          </button>
          <CopyButton value={preview} label="Copy link" variant="solid" className="h-10 px-4" />
        </div>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- UTM builder -- */

/**
 * Builds a UTM-tagged URL.
 *
 * Purely a formatting aid: UTM parameters are analytics metadata and never
 * affect which affiliate a click is credited to. That is decided by the `ref`
 * code alone, which is why this panel can be freely editable.
 */
function UtmBuilder({
  origin,
  affiliateCode,
}: {
  origin: string;
  affiliateCode: string;
}) {
  const [source, setSource] = React.useState("affiliate");
  const [medium, setMedium] = React.useState("social");
  const [campaign, setCampaign] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [content, setContent] = React.useState("");

  const url = React.useMemo(() => {
    const params = new URLSearchParams({ ref: affiliateCode });
    // Sanitised the same way the server sanitises them on save, so the preview
    // cannot show a value that would not survive being stored.
    const clean = (value: string) => value.replace(/[^A-Za-z0-9._~-]/g, "");
    for (const [key, value] of [
      ["utm_source", source],
      ["utm_medium", medium],
      ["utm_campaign", campaign],
      ["utm_term", term],
      ["utm_content", content],
    ] as const) {
      const safe = clean(value);
      if (safe) params.set(key, safe);
    }
    return `${origin}/?${params.toString()}`;
  }, [origin, affiliateCode, source, medium, campaign, term, content]);

  return (
    <Panel
      icon={Layers}
      title="UTM Builder"
      description="Add UTM parameters to track performance in more detail."
    >
      <div className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Source" htmlFor="utm-source">
            <input
              id="utm-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="h-9 w-full rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
            />
          </Field>
          <Field label="Medium" htmlFor="utm-medium">
            <select
              id="utm-medium"
              value={medium}
              onChange={(event) => setMedium(event.target.value)}
              className="h-9 w-full rounded-[9px] border border-line bg-surface px-2 text-[13px] text-content"
            >
              {["social", "email", "referral", "cpc", "content", "video"].map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Campaign" htmlFor="utm-campaign">
            <input
              id="utm-campaign"
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              placeholder="spring2026"
              className="h-9 w-full rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content placeholder:text-content-subtle"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Term" hint="(optional)" htmlFor="utm-term">
            <input
              id="utm-term"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="roofing"
              className="h-9 w-full rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content placeholder:text-content-subtle"
            />
          </Field>
          <Field label="Content" hint="(optional)" htmlFor="utm-content">
            <input
              id="utm-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="image1"
              className="h-9 w-full rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content placeholder:text-content-subtle"
            />
          </Field>
        </div>

        <div>
          <p className="text-[12px] font-medium text-content-secondary">
            Generated URL
          </p>
          <div className="mt-1 flex items-start gap-2 rounded-[9px] border border-line bg-surface-sunken px-3 py-2">
            <span className="min-w-0 flex-1 break-all text-[12px] leading-relaxed text-content-accent">
              {url}
            </span>
            <CopyButton value={url} label="Copy" />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-content-muted">
            UTM parameters help you track which channels and campaigns are
            driving the best results. They do not change who a referral is
            credited to.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- promo codes -- */

function PromoCodes({
  codes,
  offers,
}: {
  codes: PortalPromoCode[];
  offers: PromoOffer[];
}) {
  const { toast } = useToast();
  const [creating, setCreating] = React.useState(false);
  const [offerId, setOfferId] = React.useState(offers[0]?.id ?? "");
  const [pending, startTransition] = React.useTransition();

  function onCreate() {
    if (!offerId) return;
    startTransition(async () => {
      const result = await requestPromoCode({ offerId, suffix: "" });
      if (result.ok) {
        toast({ variant: "success", title: `Code ${result.code} created.` });
        setCreating(false);
      } else {
        toast({ variant: "error", title: "Code not created", description: result.error });
      }
    });
  }

  return (
    <Panel
      icon={Tag}
      title="Promo Codes"
      description="Create and manage promo codes for your audience."
      action={
        offers.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            aria-expanded={creating}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
          >
            Create promo code
            <Plus className="size-3.5" aria-hidden />
          </button>
        )
      }
    >
      {creating && (
        <div className="mx-4 mb-3 rounded-[10px] border border-line bg-surface-sunken p-3">
          <label
            htmlFor="promo-offer"
            className="text-[12px] font-medium text-content-secondary"
          >
            Choose an approved offer
          </label>
          <select
            id="promo-offer"
            value={offerId}
            onChange={(event) => setOfferId(event.target.value)}
            className="mt-1 h-9 w-full rounded-[9px] border border-line bg-surface px-2.5 text-[13px] text-content"
          >
            {offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.name} — {offer.description}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11.5px] leading-relaxed text-content-muted">
            The discount comes from the offer. Your code is issued with your own
            prefix so it is always attributable to you.
          </p>
          <button
            type="button"
            onClick={onCreate}
            disabled={pending}
            className="mt-2.5 inline-flex h-9 items-center rounded-[9px] bg-accent-500 px-3.5 text-[13px] font-semibold text-brand-midnight disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create code"}
          </button>
        </div>
      )}

      {codes.length === 0 ? (
        <PanelEmpty
          title="No promo codes yet."
          description={
            offers.length === 0
              ? "There are no offers available to you right now."
              : "Create one from an approved offer to give your audience a reason to sign up."
          }
        />
      ) : (
        <Table
          minWidth={600}
          headers={[
            { label: "Code" },
            { label: "Offer" },
            { label: "Status" },
            { label: "Uses", numeric: true },
            { label: "Expiry date" },
            { label: "Actions", srOnly: true },
          ]}
        >
          {codes.map((code) => (
            <tr key={code.id} className="hover:bg-surface-hover">
              <Td className="font-semibold">{code.code}</Td>
              <Td className="text-content-secondary">{code.offer}</Td>
              <Td>
                <Badge tone={PROMO_TONE[code.status]} dot dense>
                  {PROMO_LABEL[code.status]}
                </Badge>
              </Td>
              <Td numeric>{code.redemptionCount.toLocaleString("en-GB")}</Td>
              <Td className="whitespace-nowrap text-content-secondary">
                {code.expiresAt
                  ? new Date(code.expiresAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "No expiry"}
              </Td>
              <Td>
                <CopyButton value={code.code} label="Copy" />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

const PROMO_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  EXPIRED: "Expired",
  SCHEDULED: "Scheduled",
};

const PROMO_TONE: Record<string, "success" | "warning" | "neutral" | "info"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  EXPIRED: "neutral",
  SCHEDULED: "info",
};

/* ------------------------------------------------------------- fragments -- */

function Field({
  label,
  hint,
  htmlFor,
  counter,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium text-content-secondary"
        >
          {label}
          {hint && <span className="ml-1 text-content-subtle">{hint}</span>}
        </label>
        {counter && (
          <span className="text-[11px] tabular-nums text-content-subtle">
            {counter}
          </span>
        )}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-[20px] font-bold leading-none tabular-nums text-content">
        {value}
      </dd>
      <dt className="mt-1 text-[11.5px] text-content-muted">{label}</dt>
    </div>
  );
}

const TIPS = [
  {
    title: "Use UTM parameters",
    body: "Track your best performing channels, campaigns and content.",
  },
  {
    title: "Share promo codes",
    body: "Give your audience a reason to sign up with your link.",
  },
  {
    title: "Monitor performance",
    body: "Check your link stats regularly to see what's working.",
  },
  {
    title: "Try different content",
    body: "Experiment with landing pages, message and creatives.",
  },
];
