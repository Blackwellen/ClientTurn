"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  ExternalLink,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  approveProspectAction,
  promoteProspectToLeadAction,
} from "@/lib/find-leads/actions";
import { suppressProspectAction } from "@/lib/find-leads/prospect-actions";
import { eligibilityLabel, eligibilityTone, relationshipLabel } from "@/lib/policy/types";
import { shortAgo } from "@/lib/prospects/activity";
import {
  SUPPRESSION_REASON_OPTIONS,
  gradeTone,
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  prospectStatusTone,
  roleLabel,
  scoreFactorLabel,
  verificationLabel,
  verificationTone,
} from "@/lib/prospects/types";
import { confidenceBand, confidenceLabel, confidenceTone } from "@/lib/prospects/scoring-explain";
import type { ProspectDetail } from "@/lib/prospects/queries";
import { useFindLeadsParams } from "./use-find-leads-params";

/**
 * The Prospect Drawer (V4 §13).
 *
 * Four views rather than the Lead Drawer's three: Research is a genuinely
 * sourcing-specific concept — where did this record come from, and why do we
 * believe it — and §13.1 permits the extra view here and only here. The Lead
 * Drawer stays at three.
 *
 * The drawer is anchored to the content area rather than the viewport, so the
 * table it opened from stays visible and lit behind it. Reviewing a prospect is
 * a comparison against its neighbours, not a separate page.
 */
const VIEWS = ["summary", "research", "conversation", "activity"] as const;
type DrawerView = (typeof VIEWS)[number];

const VIEW_LABELS: Record<DrawerView, string> = {
  summary: "Summary",
  research: "Research",
  conversation: "Conversation",
  activity: "Activity",
};

export function ProspectDrawer({
  detail,
  canManage,
}: {
  detail: ProspectDetail;
  canManage: boolean;
}) {
  const params = useFindLeadsParams();
  const [view, setView] = React.useState<DrawerView>("summary");

  const { prospect } = detail;
  const name = prospectDisplayName(prospect);
  const location = locationLabel(prospect.company?.location_json);

  return (
    <Drawer
      open
      onClose={() => params.openProspect(null)}
      title={name}
      size="panel"
      anchor="content"
      bodyClassName="bg-surface-sunken/40"
      header={
        <div className="w-full border-b border-line px-5 pb-0 pt-4">
          <div className="flex items-start gap-3">
            <Avatar name={name} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[19px] font-semibold text-content">{name}</h2>
                <Badge tone={prospectStatusTone(prospect.status)}>
                  {prospectStatusLabel(prospect.status)}
                </Badge>
              </div>

              {prospect.company && (
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-content-secondary">
                  <Building2 className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
                  <span className="truncate">{prospect.company.name}</span>
                </p>
              )}

              <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
                <IdentityFact icon={Mail} label="Email" value={prospect.email} />
                <IdentityFact icon={Phone} label="Phone" value={prospect.phone_e164} />
                <IdentityFact
                  icon={UserRound}
                  label="Role"
                  value={prospect.role_title ?? roleLabel(prospect.role_classification)}
                />
                <IdentityFact icon={MapPin} label="Location" value={location} />
              </dl>

              <ProspectTags detail={detail} />
            </div>

            <IconButton
              size="sm"
              label="Close panel"
              onClick={() => params.openProspect(null)}
            >
              <X className="size-4" />
            </IconButton>
          </div>

          <DrawerTabs value={view} onChange={setView} />
        </div>
      }
      footer={
        canManage ? (
          <ProspectActionBar detail={detail} />
        ) : (
          <p className="text-[12.5px] text-content-muted">
            You have view-only access to this workspace.
          </p>
        )
      }
    >
      <div
        role="tabpanel"
        id={`prospect-panel-${view}`}
        aria-labelledby={`prospect-tab-${view}`}
      >
        {view === "summary" && <SummaryView detail={detail} />}
        {view === "research" && <ResearchView detail={detail} />}
        {view === "conversation" && <ConversationView detail={detail} />}
        {view === "activity" && <ActivityView detail={detail} />}
      </div>
    </Drawer>
  );
}

function DrawerTabs({
  value,
  onChange,
}: {
  value: DrawerView;
  onChange: (view: DrawerView) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = VIEWS.indexOf(value);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : (index - 1 + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next]);
  };

  return (
    <div role="tablist" aria-label="Prospect views" onKeyDown={onKeyDown} className="mt-4 flex">
      {VIEWS.map((item) => {
        const active = item === value;
        return (
          <button
            key={item}
            id={`prospect-tab-${item}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`prospect-panel-${item}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item)}
            className={cn(
              "relative flex-1 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-accent",
              active ? "text-content" : "text-content-muted hover:text-content-secondary",
            )}
          >
            {VIEW_LABELS[item]}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-accent-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function IdentityFact({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="truncate text-[12.5px] text-content-secondary">{value}</dd>
    </div>
  );
}

/**
 * Tags built from recorded company and role attributes only.
 *
 * Never a generated characterisation: a chip that reads like a fact but was
 * invented is worse than no chip, because it is indistinguishable from the ones
 * that came from a provider.
 */
function ProspectTags({ detail }: { detail: ProspectDetail }) {
  const company = detail.prospect.company;
  const tags = [
    company?.industry,
    company?.company_size,
    company?.employee_count ? `${company.employee_count} employees` : null,
    detail.prospect.role_classification !== "UNKNOWN"
      ? roleLabel(detail.prospect.role_classification)
      : null,
  ].filter((v): v is string => Boolean(v && v.trim()));

  if (tags.length === 0) return null;

  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge tone="neutral" dense>
            {tag}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ summary */

function SummaryView({ detail }: { detail: ProspectDetail }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <CompanySummaryCard detail={detail} />
      <ProspectGradeCard detail={detail} />
      <IntentSummaryCard detail={detail} />
      <ContactabilityCard detail={detail} />
      <VerificationCard detail={detail} />
      <CampaignAssignmentCard detail={detail} />
      <RetentionNote />
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-line bg-surface p-4 shadow-xs", className)}
    >
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-content">
        <Icon className="size-4 shrink-0 text-content-accent" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function CompanySummaryCard({ detail }: { detail: ProspectDetail }) {
  const company = detail.prospect.company;

  if (!company) {
    return (
      <Card icon={Building2} title="Company summary">
        <p className="text-[12.5px] text-content-muted">
          No company has been resolved for this prospect yet.
        </p>
      </Card>
    );
  }

  const location = locationLabel(company.location_json);

  return (
    <Card icon={Building2} title="Company summary">
      <p className="text-[13px] font-semibold text-content">{company.name}</p>

      <dl className="mt-2.5 space-y-1.5">
        {company.company_size && (
          <Fact icon={UserRound} value={`${company.company_size} employees`} />
        )}
        {company.industry && <Fact icon={Building2} value={company.industry} />}
        {location && <Fact icon={MapPin} value={location} />}
      </dl>

      {(company.website_url || company.domain) && (
        <a
          href={company.website_url ?? `https://${company.domain}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          {company.domain ?? "Visit website"}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </Card>
  );
}

function Fact({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
      <dd className="truncate text-[12.5px] text-content-secondary">{value}</dd>
    </div>
  );
}

/**
 * The grade, its number, and the factors carrying it — with a route into the
 * full breakdown. §14.3 forbids an opaque score, so a grade that cannot be
 * opened is not an acceptable rendering of one.
 */
function ProspectGradeCard({ detail }: { detail: ProspectDetail }) {
  const { score, prospect } = detail;

  if (!score) {
    return (
      <Card icon={Sparkles} title="Prospect grade">
        <p className="text-[12.5px] text-content-muted">
          This prospect has not been scored yet. Scoring runs after enrichment.
        </p>
      </Card>
    );
  }

  const strengths = [...score.factors]
    .filter((factor) => factor.direction === "POSITIVE")
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4);

  return (
    <Card icon={Sparkles} title="Prospect grade">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg text-[20px] font-semibold",
            score.grade === "A+" || score.grade === "A"
              ? "bg-success-50 text-success-700"
              : score.grade === "B"
                ? "bg-accent-50 text-content-accent"
                : score.grade === "C"
                  ? "bg-warning-50 text-warning-700"
                  : "bg-surface-sunken text-content-secondary",
          )}
        >
          {score.grade}
        </span>
        <div className="min-w-0">
          <p className="text-[19px] font-semibold leading-none tabular-nums text-content">
            {Math.round(score.totalScore)}
            <span className="ml-1 text-[13px] font-normal text-content-muted">/ 100</span>
          </p>
          <p className="mt-1 text-[12px] text-content-muted">
            {score.grade === "A+" || score.grade === "A"
              ? "Strong fit for your ICP"
              : score.grade === "B"
                ? "Good fit for your ICP"
                : "Review before spending outreach budget"}
          </p>
        </div>
      </div>

      {strengths.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {strengths.map((factor) => (
            <li key={factor.factor} className="flex items-start gap-1.5">
              <CheckCircle2
                className="mt-[1px] size-3.5 shrink-0 text-success-600"
                aria-hidden
              />
              <span className="text-[12px] text-content-secondary">
                {scoreFactorLabel(factor.factor)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={`/app/find-leads/scoring/${prospect.id}`}
        className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        View full scoring breakdown
        <ArrowRight className="size-3.5" aria-hidden />
      </a>
    </Card>
  );
}

function IntentSummaryCard({ detail }: { detail: ProspectDetail }) {
  const live = detail.intentEvents.filter((event) => !event.expired);
  const badge = detail.prospect.intent;

  if (!badge || live.length === 0) {
    return (
      <Card icon={Sparkles} title="Intent summary">
        <p className="text-[12.5px] text-content-muted">
          No live buying signals. Signals stop counting once their freshness window
          closes.
        </p>
      </Card>
    );
  }

  const first = live[live.length - 1];

  return (
    <Card icon={Sparkles} title="Intent summary">
      <Badge tone="purple">{badge.categoryName}</Badge>

      <p className="mt-2 text-[12.5px] font-medium text-content">
        {live.length > 1 ? "High buying intent" : "Buying signal detected"}
      </p>
      <p className="mt-0.5 text-[12px] text-content-muted">
        First seen {shortAgo(first.observedAt)}
      </p>

      {live[0].evidenceSummary && (
        <p className="mt-2 text-[12px] text-content-secondary">{live[0].evidenceSummary}</p>
      )}

      <a
        href="/app/find-leads?view=intent"
        className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        View intent signals
        <ArrowRight className="size-3.5" aria-hidden />
      </a>
    </Card>
  );
}

/**
 * Contactability, per channel.
 *
 * Deliberately independent of the score: §112 requires the two never be
 * conflated, and an A+ prospect that is suppressed must read as unreachable
 * rather than as a strong candidate with a caveat.
 */
function ContactabilityCard({ detail }: { detail: ProspectDetail }) {
  const { prospect, permission } = detail;

  return (
    <Card icon={Send} title="Contactability">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={eligibilityTone(prospect.outreach_eligibility)}>
          {eligibilityLabel(prospect.outreach_eligibility)}
        </Badge>
        {permission && (
          <span className="text-[12px] text-content-muted">
            {relationshipLabel(permission.relationshipType as never)}
          </span>
        )}
      </div>

      {prospect.eligibility_reason && (
        <p className="mt-2 text-[12px] text-content-secondary">
          {prospect.eligibility_reason}
        </p>
      )}

      {detail.eligibilityByChannel.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {detail.eligibilityByChannel.map((row) => (
            <li
              key={`${row.channel}-${row.policyVersion}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-1.5 text-[12.5px] text-content-secondary">
                {row.channel === "EMAIL" ? (
                  <Mail className="size-3.5 text-content-subtle" aria-hidden />
                ) : (
                  <Phone className="size-3.5 text-content-subtle" aria-hidden />
                )}
                {titleCase(row.channel)}
              </span>
              <Badge
                tone={
                  row.result === "ALLOWED"
                    ? "success"
                    : row.result.startsWith("REQUIRE")
                      ? "warning"
                      : "danger"
                }
                dense
                dot
              >
                {row.result === "ALLOWED" ? "Available" : humanResult(row.result)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-content-muted">
          No channel has been evaluated yet. Nothing can be sent until one has.
        </p>
      )}
    </Card>
  );
}

function VerificationCard({ detail }: { detail: ProspectDetail }) {
  const { prospect } = detail;
  const latest = detail.verification[0] ?? null;

  return (
    <Card icon={ShieldCheck} title="Verification">
      <Badge tone={verificationTone(prospect.verification_status)} dot>
        {verificationLabel(prospect.verification_status)}
      </Badge>

      <p className="mt-2 text-[12.5px] text-content-secondary">
        {prospect.verification_status === "VALID"
          ? "Email address verified"
          : prospect.verification_status === "UNKNOWN"
            ? "This address has not been verified"
            : `Verification returned ${verificationLabel(prospect.verification_status).toLowerCase()}`}
      </p>

      {prospect.email && (
        <p className="mt-1 truncate text-[12px] text-content-muted">{prospect.email}</p>
      )}

      {latest && (
        <p className="mt-2 text-[11.5px] text-content-subtle">
          Last verified {shortAgo(latest.verifiedAt)} · {latest.provider}
        </p>
      )}
    </Card>
  );
}

function CampaignAssignmentCard({ detail }: { detail: ProspectDetail }) {
  const { prospect } = detail;

  if (!prospect.campaignId || !prospect.campaignName) {
    return (
      <Card icon={Send} title="Campaign assignment">
        <p className="text-[12.5px] text-content-muted">
          Not in a campaign. Approve this prospect first, then add it to one.
        </p>
      </Card>
    );
  }

  return (
    <Card icon={Send} title="Campaign assignment">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-content">{prospect.campaignName}</span>
        <Badge tone={prospect.status === "OUTREACH_ACTIVE" ? "success" : "accent"} dense>
          {prospectStatusLabel(prospect.status)}
        </Badge>
      </div>

      {prospect.source_provider && (
        <p className="mt-1.5 text-[12px] text-content-muted">
          Sourced via {prospect.source_provider}
        </p>
      )}

      <a
        href={`/app/find-leads?view=campaigns`}
        className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
      >
        View campaign
        <ArrowRight className="size-3.5" aria-hidden />
      </a>
    </Card>
  );
}

/**
 * The retention promise, stated where someone would otherwise wonder what
 * happens to a cold thread on promotion. The behaviour it describes is real:
 * `promote_reviewed_prospect` keeps the same `conversation_id`.
 */
function RetentionNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-sunken/60 px-4 py-3 text-[12px] text-content-muted lg:col-span-2">
      <Mail className="mt-0.5 size-4 shrink-0 text-content-accent" aria-hidden />
      <span>
        Cold email and any later replies stay attached to this prospect. Promoting it to a
        lead keeps the same conversation, so no history is lost or duplicated.
      </span>
    </p>
  );
}

/* ----------------------------------------------------------------- research */

function ResearchView({ detail }: { detail: ProspectDetail }) {
  const hasAnything =
    detail.provenance.length > 0 ||
    detail.research.length > 0 ||
    detail.verification.length > 0;

  if (!hasAnything) {
    return (
      <p className="py-10 text-center text-[13px] text-content-muted">
        No verified research evidence yet. Evidence appears here as enrichment runs.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {detail.provenance.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="text-[13px] font-semibold text-content">Evidence and provenance</h3>
          <p className="mb-3 mt-0.5 text-[12px] text-content-muted">
            Every field, the source it came from and how confident that source is.
          </p>

          <ul className="divide-y divide-line-subtle">
            {detail.provenance.map((row) => {
              const band = confidenceBand(row.confidence);
              return (
                <li key={row.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-content">
                      {humanField(row.fieldName)}
                    </span>
                    <Badge tone={confidenceTone(band)} dense>
                      {confidenceLabel(band)}
                    </Badge>
                  </div>

                  <p className="mt-0.5 truncate text-[12px] text-content-secondary">
                    {formatValue(row.value)}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-content-subtle">
                    <span>{row.provider}</span>
                    <span aria-hidden>·</span>
                    <span>{row.sourceType.replace(/_/g, " ").toLowerCase()}</span>
                    <span aria-hidden>·</span>
                    <span>{shortAgo(row.obtainedAt)}</span>
                    {row.verifiedAt && (
                      <Badge tone="success" dense>
                        <ShieldCheck className="size-3" aria-hidden /> verified
                      </Badge>
                    )}
                    {row.policyTags.map((tag) => (
                      <Badge key={tag} tone="warning" dense>
                        {tag}
                      </Badge>
                    ))}
                    {row.sourceUrl && (
                      <a
                        href={row.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-content-accent underline-offset-4 hover:underline"
                      >
                        Source <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {detail.research.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="mb-2.5 text-[13px] font-semibold text-content">
            Enrichment history
          </h3>
          <ul className="divide-y divide-line-subtle">
            {detail.research.map((row) => (
              <li
                key={row.id}
                className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-content">
                    {humanField(row.type)}
                  </p>
                  {row.summary && (
                    <p className="mt-0.5 text-[12px] text-content-muted">{row.summary}</p>
                  )}
                  <p className="mt-0.5 text-[11.5px] text-content-subtle">{row.provider}</p>
                </div>
                <Badge
                  tone={
                    row.status === "SUCCESS"
                      ? "success"
                      : row.status.startsWith("SKIPPED")
                        ? "neutral"
                        : "warning"
                  }
                  dense
                >
                  {row.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.intentEvents.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="mb-2.5 text-[13px] font-semibold text-content">Intent evidence</h3>
          <ul className="space-y-2">
            {detail.intentEvents.slice(0, 8).map((event) => (
              <li
                key={event.id}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  event.expired
                    ? "border-line bg-surface-sunken/40"
                    : "border-purple-100 bg-purple-50",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-content">
                    {event.categoryName}
                  </span>
                  <span className="text-[11.5px] text-content-muted">
                    {shortAgo(event.observedAt)}
                    {event.expired && " · expired"}
                  </span>
                </div>
                {event.evidenceSummary && (
                  <p className="mt-1 text-[12px] text-content-secondary">
                    {event.evidenceSummary}
                  </p>
                )}
                <p className="mt-1 flex items-center gap-2 text-[11.5px] text-content-subtle">
                  {event.source}
                  {event.sourceUrl && (
                    <a
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-content-accent underline-offset-4 hover:underline"
                    >
                      Source <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- conversation */

function ConversationView({ detail }: { detail: ProspectDetail }) {
  if (detail.messages.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-content-muted">
        No outreach or replies yet. Cold email history appears here, and stays attached if
        this prospect is promoted to a lead.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {detail.messages.map((message) => {
        const inbound = message.direction === "inbound";
        return (
          <li
            key={message.id}
            className={cn(
              "rounded-xl border px-3.5 py-3",
              inbound
                ? "border-line bg-surface"
                : "border-accent-200/60 bg-accent-50/40",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-content-muted">
                {inbound ? "Reply" : "Sent"} · {message.channel}
              </span>
              <span className="text-[11.5px] text-content-subtle">
                {shortAgo(message.sentAt ?? message.createdAt)}
              </span>
            </div>
            {message.subject && (
              <p className="mt-1 text-[12.5px] font-semibold text-content">
                {message.subject}
              </p>
            )}
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-content-secondary">
              {message.body}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" dense>
                {message.status.toLowerCase()}
              </Badge>
              {message.replyClassification && (
                <Badge tone="info" dense>
                  {message.replyClassification.replace(/_/g, " ").toLowerCase()}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------------- activity */

function ActivityView({ detail }: { detail: ProspectDetail }) {
  const { prospect } = detail;

  const events: { at: string; label: string; actor: string }[] = [
    {
      at: prospect.created_at,
      label: prospect.source_provider
        ? `Sourced from ${prospect.source_provider}`
        : "Sourced",
      actor: "System",
    },
    ...(detail.score
      ? [
          {
            at: detail.score.createdAt,
            label: `Scored ${detail.score.grade} (${Math.round(detail.score.totalScore)}/100) · ${detail.score.scoreVersion}`,
            actor: "System",
          },
        ]
      : []),
    ...detail.research.map((row) => ({
      at: row.completedAt ?? prospect.created_at,
      label: `Enriched: ${humanField(row.type)} (${row.provider})`,
      actor: "System",
    })),
    ...detail.verification.map((row) => ({
      at: row.verifiedAt,
      label: `Verified ${row.channel.toLowerCase()}: ${verificationLabel(row.result as never)}`,
      actor: row.provider,
    })),
    ...detail.intentEvents.map((event) => ({
      at: event.observedAt,
      label: `Intent detected: ${event.categoryName}`,
      actor: event.source,
    })),
    ...detail.messages.map((message) => ({
      at: message.sentAt ?? message.createdAt,
      label:
        message.direction === "inbound"
          ? `Reply received on ${message.channel.toLowerCase()}`
          : `${message.channel} sent`,
      actor: message.direction === "inbound" ? "Prospect" : "Campaign",
    })),
    ...(prospect.campaignName
      ? [{ at: prospect.created_at, label: `Added to ${prospect.campaignName}`, actor: "Workspace" }]
      : []),
    ...(prospect.promoted_to_lead_id
      ? [
          {
            at: prospect.last_activity_at ?? prospect.created_at,
            label: "Promoted to lead",
            actor: "Workspace",
          },
        ]
      : []),
  ]
    .filter((event) => Boolean(event.at))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="relative space-y-4 pl-4">
      <span
        aria-hidden
        className="absolute bottom-2 left-[3px] top-2 w-px bg-line"
      />
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="relative">
          <span
            aria-hidden
            className="absolute -left-4 top-1.5 size-[7px] rounded-full border-2 border-surface bg-accent-500"
          />
          <p className="text-[12.5px] text-content">{event.label}</p>
          <p className="text-[11.5px] text-content-subtle">
            {shortAgo(event.at)} · {event.actor}
          </p>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ actions */

function ProspectActionBar({ detail }: { detail: ProspectDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [suppressOpen, setSuppressOpen] = React.useState(false);

  const prospect = detail.prospect;
  const eligible = prospect.outreach_eligibility === "ELIGIBLE";
  const promoted = Boolean(prospect.promoted_to_lead_id);
  const approved = prospect.status === "APPROVED" || prospect.status === "OUTREACH_ACTIVE";
  const suppressed = prospect.outreach_eligibility === "SUPPRESSED";

  // Promotion is a statement that the relationship changed, not a reward for a
  // high score. §11.19: an engaged prospect, or an operator's explicit
  // qualification — never "grade A, therefore a lead".
  const engaged = prospect.status === "REPLIED" || detail.messages.some((m) => m.direction === "inbound");

  const run = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: success });
      router.refresh();
    });
  };

  // Why a control is unavailable is always visible. "Not eligible", "already a
  // lead" and "no reply yet" are different answers, and someone deciding what
  // to do next needs to know which one applies.
  const approveReason = suppressed
    ? "This prospect is suppressed and cannot be contacted"
    : approved
      ? "This prospect has already been approved"
      : !eligible
        ? "Contactability has not been confirmed for this prospect"
        : undefined;

  const promoteReason = promoted
    ? "This prospect is already a lead"
    : suppressed
      ? "A suppressed prospect cannot be promoted"
      : !engaged
        ? "Promote once the prospect has replied or you have qualified them yourself"
        : undefined;

  return (
    <>
      <div className="flex w-full flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={pending}
          disabled={approved || !eligible || pending}
          title={approveReason}
          onClick={() => run(() => approveProspectAction(prospect.id), "Approved for outreach.")}
        >
          <Send className="size-3.5" aria-hidden />
          {approved ? "Approved" : "Approve for outreach"}
        </Button>

        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={promoted || suppressed || pending}
          title={promoteReason}
          onClick={() =>
            run(
              () => promoteProspectToLeadAction(prospect.id),
              "Promoted to a lead. Its conversation and sourcing history travel with it.",
            )
          }
        >
          {promoted ? "Already a lead" : "Promote to lead"}
        </Button>

        <Button
          size="sm"
          variant="danger"
          disabled={suppressed || pending}
          title={suppressed ? "This prospect is already suppressed" : undefined}
          onClick={() => setSuppressOpen(true)}
        >
          <Ban className="size-3.5" aria-hidden />
          {suppressed ? "Suppressed" : "Suppress"}
        </Button>

        <DropdownMenu
          trigger={
            <IconButton size="sm" variant="secondary" label="More prospect actions">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          <DropdownItem
            onSelect={() => router.push(`/app/find-leads/scoring/${prospect.id}`)}
          >
            View scoring breakdown
          </DropdownItem>
          {prospect.company?.domain && (
            <DropdownItem
              onSelect={() =>
                window.open(`https://${prospect.company?.domain}`, "_blank", "noopener")
              }
            >
              Open company website
            </DropdownItem>
          )}
        </DropdownMenu>

        <p className="w-full text-[11.5px] text-content-subtle">
          {prospect.source_provider ? `Provider: ${prospect.source_provider} · ` : ""}
          Created {new Date(prospect.created_at).toLocaleDateString("en-GB")}
        </p>
      </div>

      <SuppressDialog
        open={suppressOpen}
        onClose={() => setSuppressOpen(false)}
        prospectId={prospect.id}
        name={prospectDisplayName(prospect)}
      />
    </>
  );
}

/**
 * Suppression needs a reason, not just a confirmation.
 *
 * The reason is what makes the decision auditable and what decides whether it
 * can ever be lifted: an opt-out is the recipient's and is permanent, while a
 * "wrong person" is the workspace's own correction. A yes/no dialog would throw
 * that distinction away.
 */
function SuppressDialog({
  open,
  onClose,
  prospectId,
  name,
}: {
  open: boolean;
  onClose: () => void;
  prospectId: string;
  name: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = React.useState<string>(SUPPRESSION_REASON_OPTIONS[0].value);
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await suppressProspectAction({ prospectId, reason, note: note || undefined });
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: `${name} will not be contacted again.` });
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title="Suppress this prospect"
      description="They will be excluded from every campaign, on every channel, from now on."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={pending} onClick={submit}>
            Suppress
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="suppress-reason">Reason</Label>
          <Select
            id="suppress-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {SUPPRESSION_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="suppress-note">Note (optional)</Label>
          <Textarea
            id="suppress-note"
            rows={3}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything a colleague would need to know later."
          />
        </div>

        <p className="text-[12px] text-content-muted">
          The record is kept, not deleted — deleting it would let the next search find and
          contact them again.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ helpers */

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function humanField(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function humanResult(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).value);
  }
  return JSON.stringify(value);
}
