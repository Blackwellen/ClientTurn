"use client";

import * as React from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CircleSlash,
  Database,
  Info,
  Users,
} from "lucide-react";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import {
  PROSPECT_SOURCES,
  formatCount,
  type CampaignDraft,
  type FieldErrors,
  type ProspectSource,
} from "@/lib/outreach/campaign-draft";
import type { AudienceEstimate, CampaignWizardOptions } from "@/lib/outreach/campaigns/audience";
import { CheckRow, Field, RadioRow, RailCard, SectionCard, SummaryRow } from "./pieces";
import { TokenSelect } from "./token-select";

const RADIUS_OPTIONS = [0, 5, 10, 25, 50, 100];

/**
 * Step 2 — Audience.
 *
 * Selecting a saved search or ICP *offers* to apply its criteria rather than
 * overwriting silently: someone who has already edited the fields should not
 * lose that work to a dropdown. The suppression exclusion is rendered as a
 * locked checkbox rather than hidden, so its presence is visible and its
 * immovability is explained.
 */
export function AudienceStep({
  draft,
  errors,
  options,
  estimate,
  estimating,
  onChange,
}: {
  draft: CampaignDraft;
  errors: FieldErrors;
  options: CampaignWizardOptions;
  estimate: AudienceEstimate | null;
  estimating: boolean;
  onChange: (update: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const { audience } = draft;
  const [showDetails, setShowDetails] = React.useState(false);

  const icp = options.icpProfiles.find((profile) => profile.id === audience.icpProfileId);
  const search = options.savedSearches.find((row) => row.id === audience.savedSearchId);

  const setAudience = (patch: Partial<CampaignDraft["audience"]>) =>
    onChange((current) => ({ ...current, audience: { ...current.audience, ...patch } }));

  const hasManualCriteria =
    audience.locations.length > 0 ||
    audience.industries.length > 0 ||
    audience.roles.length > 0 ||
    audience.companySizes.length > 0;

  /** Applies an ICP's criteria over the current ones. */
  const applyIcp = (profileId: string) => {
    const profile = options.icpProfiles.find((row) => row.id === profileId);
    if (!profile) return;
    setAudience({
      icpProfileId: profileId,
      locations: profile.locations.slice(0, 20),
      industries: profile.industries.slice(0, 20),
      roles: profile.roles.slice(0, 20),
      companySizes: profile.companySizes.slice(0, 10),
    });
  };

  const selectedKey = audience.savedSearchId
    ? `search:${audience.savedSearchId}`
    : audience.icpProfileId
      ? `icp:${audience.icpProfileId}`
      : "";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div className="space-y-5">
        <SectionCard
          icon={Users}
          title="Target audience"
          description="Choose who you want to reach with this campaign."
          bodyClassName="space-y-5"
        >
          <div className="flex items-end gap-2">
            <Field
              label="Select saved search / ICP"
              htmlFor="saved-search"
              required
              hint="Use a saved search or ICP to quickly apply your ideal customer profile and targeting criteria."
              error={errors.basis}
              className="flex-1"
            >
              <Select
                id="saved-search"
                value={selectedKey}
                aria-invalid={Boolean(errors.basis)}
                onChange={(event) => {
                  const [kind, id] = event.target.value.split(":");
                  if (kind === "icp") {
                    // Only seed the criteria when nothing has been typed yet.
                    // Overwriting someone's edits from a dropdown is the kind
                    // of loss a wizard never recovers from.
                    if (hasManualCriteria) setAudience({ icpProfileId: id, savedSearchId: null });
                    else applyIcp(id);
                  } else if (kind === "search") {
                    const row = options.savedSearches.find((item) => item.id === id);
                    setAudience({ savedSearchId: id, icpProfileId: row?.icpProfileId ?? null });
                    if (!hasManualCriteria && row?.icpProfileId) applyIcp(row.icpProfileId);
                  } else {
                    setAudience({ savedSearchId: null, icpProfileId: null });
                  }
                }}
              >
                <option value="">No saved search or ICP</option>
                {options.icpProfiles.length > 0 && (
                  <optgroup label="Ideal customer profiles">
                    {options.icpProfiles.map((profile) => (
                      <option key={profile.id} value={`icp:${profile.id}`}>
                        {profile.name} (ICP)
                      </option>
                    ))}
                  </optgroup>
                )}
                {options.savedSearches.length > 0 && (
                  <optgroup label="Saved searches">
                    {options.savedSearches.map((row) => (
                      <option key={row.id} value={`search:${row.id}`}>
                        {row.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
            <Button
              variant="secondary"
              size="md"
              className="mb-[26px] shrink-0"
              disabled={!icp && !search}
              onClick={() => setShowDetails((open) => !open)}
              aria-expanded={showDetails}
            >
              View details
            </Button>
          </div>

          {showDetails && (icp || search) && (
            <div className="rounded-lg border border-line bg-surface-sunken/50 px-4 py-3">
              <p className="text-[12.5px] font-medium text-content">
                {search?.title ?? icp?.name}
              </p>
              <dl className="mt-2 space-y-0">
                <SummaryRow label="Locations" value={icp?.locations.join(", ") || "—"} />
                <SummaryRow label="Industries" value={icp?.industries.join(", ") || "—"} />
                <SummaryRow label="Roles" value={icp?.roles.join(", ") || "—"} />
              </dl>
              {hasManualCriteria && icp && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => applyIcp(icp.id)}
                >
                  Replace my criteria with this profile
                </Button>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-[13px] font-semibold text-content">
                Geography, company and role constraints
              </h3>
              <Info className="size-3.5 text-content-subtle" aria-hidden />
            </div>

            <div className="mt-3 grid gap-4 lg:grid-cols-3">
              <Field label="Locations" htmlFor="locations" error={errors.locations}>
                <TokenSelect
                  id="locations"
                  label="locations"
                  values={audience.locations}
                  options={options.locations}
                  allowCustom
                  customPlaceholder="Add a town or city"
                  emptyHint="Anywhere"
                  onChange={(locations) => setAudience({ locations })}
                />
              </Field>

              <Field label="Company size" htmlFor="company-size">
                <TokenSelect
                  id="company-size"
                  label="company sizes"
                  values={audience.companySizes}
                  options={options.companySizes}
                  max={10}
                  emptyHint="Any size"
                  onChange={(companySizes) => setAudience({ companySizes })}
                />
              </Field>

              <Field label="Industry" htmlFor="industry">
                <TokenSelect
                  id="industry"
                  label="industries"
                  values={audience.industries}
                  options={options.industries}
                  allowCustom
                  customPlaceholder="Add an industry"
                  emptyHint="Any industry"
                  onChange={(industries) => setAudience({ industries })}
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Role / title" htmlFor="roles">
                <TokenSelect
                  id="roles"
                  label="roles"
                  values={audience.roles}
                  options={options.roles}
                  allowCustom
                  customPlaceholder="Add more role titles"
                  emptyHint="Any role"
                  onChange={(roles) => setAudience({ roles })}
                />
              </Field>

              <Field
                label="Search radius"
                htmlFor="radius"
                hint="Measured from your first location."
              >
                <Select
                  id="radius"
                  value={String(audience.radiusMiles ?? 0)}
                  disabled={audience.locations.length === 0}
                  onChange={(event) =>
                    setAudience({
                      radiusMiles: Number(event.target.value) || null,
                    })
                  }
                >
                  {RADIUS_OPTIONS.map((miles) => (
                    <option key={miles} value={miles}>
                      {miles === 0 ? "Exact location only" : `+ ${miles} miles`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </SectionCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <SectionCard
              icon={Database}
              title="Prospect source"
              description="Choose whether to use existing prospects, source new ones, or both."
              bodyClassName="space-y-3.5"
            >
              {PROSPECT_SOURCES.map((source) => (
                <RadioRow
                  key={source.value}
                  name="prospect-source"
                  value={source.value}
                  checked={audience.source === source.value}
                  onChange={(value) => setAudience({ source: value as ProspectSource })}
                  title={source.label}
                  description={source.description}
                />
              ))}
            </SectionCard>

            <SectionCard
              icon={Building2}
              title="Named company list (optional)"
              description="Add specific companies you want to include or prioritise in this campaign."
              bodyClassName="space-y-2"
            >
              <TokenSelect
                id="named-companies"
                label="companies"
                values={audience.namedCompanies}
                options={[]}
                allowCustom
                max={500}
                customPlaceholder="Company name or domain"
                emptyHint="No named companies"
                onChange={(namedCompanies) => setAudience({ namedCompanies })}
              />
              {/* Naming a company is a targeting preference, not a bypass. */}
              <p className="text-[12px] leading-snug text-content-muted">
                Named companies still go through deduplication, suppression, scoring and
                verification like everyone else.
              </p>
            </SectionCard>
          </div>

          <SectionCard
            icon={CircleSlash}
            title="Exclusions"
            description="Prevent specific companies or contacts from being included."
            tone="danger"
            bodyClassName="space-y-3.5"
          >
            <CheckRow
              id="exclude-customers"
              checked={audience.exclusions.existingCustomers}
              onChange={(checked) =>
                setAudience({
                  exclusions: { ...audience.exclusions, existingCustomers: checked },
                })
              }
              title="Exclude existing customers"
              description="Don't contact current customers."
            />
            <CheckRow
              id="exclude-leads"
              checked={audience.exclusions.existingLeads}
              onChange={(checked) =>
                setAudience({ exclusions: { ...audience.exclusions, existingLeads: checked } })
              }
              title="Exclude existing leads"
              description="Don't contact active or closed leads."
            />
            <CheckRow
              id="exclude-suppression"
              checked
              locked
              onChange={() => undefined}
              title="Use global suppression list"
              description="Respect unsubscribes and suppressed contacts."
              lockedReason="Always on. Anyone who has opted out is never contacted."
            />

            <div className="pt-1">
              <p className="text-[13px] font-medium text-content">
                Exclude specific companies or domains
              </p>
              <p className="mt-0.5 text-[12px] text-content-muted">
                Add custom exclusions (e.g. competitors).
              </p>
              <div className="mt-2">
                <TokenSelect
                  id="excluded-companies"
                  label="exclusions"
                  values={audience.exclusions.companies}
                  options={[]}
                  allowCustom
                  max={500}
                  customPlaceholder="Company name or domain"
                  emptyHint="No custom exclusions"
                  onChange={(companies) =>
                    setAudience({ exclusions: { ...audience.exclusions, companies } })
                  }
                />
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <aside className="space-y-4">
        <RailCard
          icon={BarChart3}
          title="Audience preview"
          description="Estimated size based on your current criteria."
        >
          {estimating ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : estimate?.available ? (
            <div className="rounded-lg border border-success-100 bg-success-50/70 px-4 py-3.5">
              <p className="text-[28px] font-bold leading-none tabular-nums text-content">
                {formatCount(estimate.total)}
              </p>
              <p className="mt-1.5 text-[12.5px] text-content-secondary">
                Estimated prospects
              </p>
              {estimate.sourcingTarget > 0 && (
                <p className="mt-1 text-[11.5px] text-content-muted">
                  {formatCount(estimate.existing)} already held ·{" "}
                  {formatCount(estimate.sourcingTarget)} to source
                </p>
              )}
              <p className="mt-2.5 flex gap-1.5 text-[11.5px] leading-snug text-content-muted">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  This is an estimate and may vary based on data availability and provider
                  results.
                </span>
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-surface-sunken/50 px-4 py-4 text-[12.5px] text-content-muted">
              Unable to estimate audience right now. You can still continue — the campaign
              re-checks who it can reach before it sends.
            </div>
          )}
        </RailCard>

        <RailCard icon={Users} title="Targeting summary">
          <dl className="space-y-0">
            <SummaryRow
              label="Saved search / ICP"
              value={search?.title ?? icp?.name ?? "None"}
            />
            <SummaryRow
              label="Locations"
              value={
                audience.locations.length > 0
                  ? `${audience.locations.join(", ")}${
                      audience.radiusMiles ? ` + ${audience.radiusMiles} miles` : ""
                    }`
                  : "Anywhere"
              }
            />
            <SummaryRow
              label="Company size"
              value={audience.companySizes.join(", ") || "Any"}
            />
            <SummaryRow label="Industry" value={audience.industries.join(", ") || "Any"} />
            <SummaryRow label="Roles" value={audience.roles.join(", ") || "Any"} />
            <SummaryRow
              label="Source"
              value={
                PROSPECT_SOURCES.find((source) => source.value === audience.source)?.label ===
                "Both existing prospects and new sourcing"
                  ? "Existing + New sourcing"
                  : (PROSPECT_SOURCES.find((s) => s.value === audience.source)?.label ?? "—")
              }
            />
            <SummaryRow
              label="Exclusions"
              value={
                [
                  audience.exclusions.existingCustomers ? "Customers" : null,
                  audience.exclusions.existingLeads ? "Leads" : null,
                  "Global suppression",
                  audience.exclusions.companies.length > 0
                    ? `${audience.exclusions.companies.length} custom`
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "None"
              }
            />
          </dl>
        </RailCard>

        <div
          className={cn(
            "rounded-xl border border-info-100 bg-info-50 p-4",
            "flex items-start gap-2.5",
          )}
        >
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-info-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-content">Next: Intent &amp; Score</p>
            <p className="mt-0.5 text-[12px] leading-snug text-content-secondary">
              In the next step you&rsquo;ll refine your audience using intent signals and
              scoring criteria to prioritise the best prospects.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
