"use client";

import * as React from "react";
import {
  Building2,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SegmentedControl } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  approveProspectAction,
  promoteProspectToLeadAction,
} from "@/lib/find-leads/actions";
import { eligibilityLabel, eligibilityTone, relationshipLabel } from "@/lib/policy/types";
import {
  gradeTone,
  intentFreshness,
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  prospectStatusTone,
  roleLabel,
  scoreFactorLabel,
  verificationLabel,
  verificationTone,
} from "@/lib/prospects/types";
import type { ProspectDetail } from "@/lib/prospects/queries";
import { useFindLeadsParams } from "./use-find-leads-params";

/**
 * The Prospect Drawer (V4 §13).
 *
 * Four views rather than the Lead Drawer's three: Research is a genuinely
 * sourcing-specific concept — where did this record come from, and why do we
 * believe it — and §13.1 permits the extra view here and only here.
 */
const VIEWS = [
  { value: "summary", label: "Summary" },
  { value: "research", label: "Research" },
  { value: "conversation", label: "Conversation" },
  { value: "activity", label: "Activity" },
];

export function ProspectDrawer({
  detail,
  canManage,
}: {
  detail: ProspectDetail;
  canManage: boolean;
}) {
  const params = useFindLeadsParams();
  const [view, setView] = React.useState("summary");

  const { prospect } = detail;
  const name = prospectDisplayName(prospect);

  return (
    <Drawer
      open
      onClose={() => params.openProspect(null)}
      title={name}
      size="lg"
      anchor="content"
      header={
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold text-content">{name}</h2>
            {prospect.grade && (
              <Badge tone={gradeTone(prospect.grade)} className="font-semibold tabular-nums">
                {prospect.grade}
                {prospect.score !== null && (
                  <span className="ml-1 font-normal opacity-70">
                    {Math.round(prospect.score)}
                  </span>
                )}
              </Badge>
            )}
            <Badge tone={prospectStatusTone(prospect.status)} dot>
              {prospectStatusLabel(prospect.status)}
            </Badge>
          </div>
          <p className="mt-1 truncate text-[13px] text-content-muted">
            {prospect.role_title ?? roleLabel(prospect.role_classification)}
            {prospect.company ? ` · ${prospect.company.name}` : ""}
          </p>
          <div className="mt-3">
            <SegmentedControl items={VIEWS} value={view} onChange={setView} size="sm" />
          </div>
        </div>
      }
      footer={
        canManage ? (
          <ProspectActions detail={detail} />
        ) : (
          <p className="text-[12.5px] text-content-muted">
            You have view-only access to this workspace.
          </p>
        )
      }
    >
      {view === "summary" && <SummaryView detail={detail} />}
      {view === "research" && <ResearchView detail={detail} />}
      {view === "conversation" && <ConversationView detail={detail} />}
      {view === "activity" && <ActivityView detail={detail} />}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ summary */

function SummaryView({ detail }: { detail: ProspectDetail }) {
  const { prospect, score, permission } = detail;
  const location = locationLabel(prospect.company?.location_json);

  return (
    <div className="space-y-5">
      <Section title="Contact">
        <dl className="grid gap-2 sm:grid-cols-2">
          <Field icon={Mail} label="Email" value={prospect.email}>
            <Badge tone={verificationTone(prospect.verification_status)} dense>
              {verificationLabel(prospect.verification_status)}
            </Badge>
          </Field>
          <Field icon={Phone} label="Phone" value={prospect.phone_e164} />
          <Field icon={Building2} label="Company" value={prospect.company?.name ?? null} />
          <Field icon={Globe} label="Domain" value={prospect.company?.domain ?? null} />
          <Field icon={MapPin} label="Location" value={location} />
          <Field
            icon={Building2}
            label="Industry"
            value={prospect.company?.industry ?? null}
          />
        </dl>
      </Section>

      <Section title="Why this score">
        {score ? (
          <ScoreBreakdown score={score} />
        ) : (
          <p className="text-[13px] text-content-muted">
            This prospect has not been scored yet.
          </p>
        )}
      </Section>

      <Section title="Contactability">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={eligibilityTone(prospect.outreach_eligibility)} dot>
              {eligibilityLabel(prospect.outreach_eligibility)}
            </Badge>
            {permission && (
              <span className="text-[12.5px] text-content-muted">
                {relationshipLabel(permission.relationshipType as never)}
              </span>
            )}
          </div>

          {prospect.eligibility_reason && (
            <p className="text-[12.5px] text-content-secondary">
              {prospect.eligibility_reason}
            </p>
          )}

          {detail.eligibilityByChannel.length > 0 && (
            <ul className="divide-y divide-line-subtle rounded-lg border border-line">
              {detail.eligibilityByChannel.map((row) => (
                <li
                  key={`${row.channel}-${row.policyVersion}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-[12.5px] font-medium text-content">
                    {titleCase(row.channel)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      tone={row.result === "ALLOWED" ? "success" : row.result.startsWith("REQUIRE") ? "warning" : "danger"}
                      dense
                    >
                      {humanResult(row.result)}
                    </Badge>
                    {/* The policy version is what makes a past decision
                        auditable, so it is shown rather than hidden. */}
                    <span className="text-[11px] tabular-nums text-content-subtle">
                      {row.policyVersion}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {detail.intentEvents.length > 0 && (
        <Section title="Intent signals">
          <ul className="space-y-2">
            {detail.intentEvents.slice(0, 6).map((event) => (
              <li
                key={event.id}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  event.expired ? "border-line bg-surface-sunken/40" : "border-purple-100 bg-purple-50",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-content">
                    {event.categoryName}
                  </span>
                  <span className="text-[11.5px] text-content-muted">
                    {intentFreshness(event.observedAt)}
                    {event.expired && " · expired"}
                  </span>
                </div>
                {event.evidenceSummary && (
                  <p className="mt-1 text-[12px] text-content-secondary">
                    {event.evidenceSummary}
                  </p>
                )}
                {event.sourceUrl && (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                  >
                    Source <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/**
 * The score, decomposed. §14.3 is explicit that "AI says 91" is not enough, so
 * every factor shows its weight, its contribution and the evidence behind it.
 */
function ScoreBreakdown({ score }: { score: NonNullable<ProspectDetail["score"]> }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[26px] font-semibold tabular-nums text-content">
          {Math.round(score.totalScore)}
        </span>
        <Badge tone={gradeTone(score.grade)} className="font-semibold">
          {score.grade}
        </Badge>
        <span className="ml-auto text-[11px] text-content-subtle">{score.scoreVersion}</span>
      </div>

      {score.explanation && (
        <p className="text-[12.5px] text-content-secondary">{score.explanation}</p>
      )}

      <ul className="space-y-2">
        {score.factors.map((factor) => (
          <li key={factor.factor}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-content">
                {scoreFactorLabel(factor.factor)}
              </span>
              <span className="text-[12px] tabular-nums text-content-muted">
                {factor.contribution.toFixed(1)}
                <span className="text-content-subtle">
                  {" "}
                  / {(factor.weight * 100).toFixed(0)}
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={cn(
                  "h-full rounded-full",
                  factor.direction === "POSITIVE"
                    ? "bg-success-500"
                    : factor.direction === "NEGATIVE"
                      ? "bg-danger-500"
                      : "bg-warning-500",
                )}
                style={{ width: `${Math.min(100, factor.rawValue * 100)}%` }}
              />
            </div>
            {factor.evidenceSummary && (
              <p className="mt-1 text-[11.5px] text-content-muted">
                {factor.evidenceSummary}
                {factor.evidenceSource && (
                  <span className="text-content-subtle"> · {factor.evidenceSource}</span>
                )}
                {factor.confidence < 1 && (
                  <span className="text-content-subtle">
                    {" "}
                    · {Math.round(factor.confidence * 100)}% confidence
                  </span>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- research */

function ResearchView({ detail }: { detail: ProspectDetail }) {
  return (
    <div className="space-y-5">
      <Section title="Where this data came from">
        {detail.provenance.length === 0 ? (
          <p className="text-[13px] text-content-muted">
            No provenance has been recorded for this prospect yet.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {detail.provenance.map((row) => (
              <li key={row.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-content">
                    {humanField(row.fieldName)}
                  </span>
                  <span className="text-[11.5px] text-content-subtle">
                    {row.provider} · {intentFreshness(row.obtainedAt).toLowerCase()}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-content-secondary">
                  {formatValue(row.value)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral" dense>
                    {row.sourceType.replace(/_/g, " ").toLowerCase()}
                  </Badge>
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
                      className="inline-flex items-center gap-1 text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                    >
                      Source <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {detail.research.length > 0 && (
        <Section title="Enrichment history">
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {detail.research.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-content">
                    {humanField(row.type)}
                  </p>
                  {row.summary && (
                    <p className="mt-0.5 text-[12px] text-content-muted">{row.summary}</p>
                  )}
                </div>
                <Badge tone={row.status === "SUCCESS" ? "success" : row.status.startsWith("SKIPPED") ? "neutral" : "warning"} dense>
                  {row.status.replace(/_/g, " ").toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail.verification.length > 0 && (
        <Section title="Verification">
          <ul className="divide-y divide-line-subtle rounded-lg border border-line">
            {detail.verification.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[12.5px] text-content">
                  {titleCase(row.channel)} · {row.provider}
                </span>
                <Badge tone={verificationTone(row.result as never)} dense>
                  {verificationLabel(row.result as never)}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- conversation */

function ConversationView({ detail }: { detail: ProspectDetail }) {
  if (detail.messages.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-content-muted">
        No messages yet. Cold email history appears here, and stays attached if this
        prospect is promoted to a lead.
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
              "rounded-lg border px-3 py-2.5",
              inbound ? "border-line bg-surface-sunken/50" : "border-accent-200/60 bg-accent-50/40",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-content-muted">
                {inbound ? "Reply" : "Sent"} · {message.channel}
              </span>
              <span className="text-[11.5px] text-content-subtle">
                {intentFreshness(message.sentAt ?? message.createdAt)}
              </span>
            </div>
            {message.subject && (
              <p className="mt-1 text-[12.5px] font-semibold text-content">{message.subject}</p>
            )}
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-content-secondary">
              {message.body}
            </p>
            {message.replyClassification && (
              <Badge tone="info" dense className="mt-2">
                {message.replyClassification.replace(/_/g, " ").toLowerCase()}
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------------- activity */

function ActivityView({ detail }: { detail: ProspectDetail }) {
  const events = [
    { at: detail.prospect.created_at, label: "Prospect discovered" },
    ...(detail.score ? [{ at: detail.score.createdAt, label: `Scored ${detail.score.grade}` }] : []),
    ...detail.verification.map((v) => ({
      at: v.verifiedAt,
      label: `Email verification: ${verificationLabel(v.result as never)}`,
    })),
    ...detail.intentEvents.map((e) => ({
      at: e.observedAt,
      label: `Intent signal: ${e.categoryName}`,
    })),
    ...(detail.prospect.last_activity_at
      ? [{ at: detail.prospect.last_activity_at, label: "Last activity" }]
      : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="space-y-3">
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="flex gap-3">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12.5px] text-content">{event.label}</p>
            <p className="text-[11.5px] text-content-subtle">{intentFreshness(event.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ actions */

function ProspectActions({ detail }: { detail: ProspectDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const prospect = detail.prospect;
  const eligible = prospect.outreach_eligibility === "ELIGIBLE";
  const promoted = Boolean(prospect.promoted_to_lead_id);
  const approved = prospect.status === "APPROVED" || prospect.status === "OUTREACH_ACTIVE";

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

  // Why a control is unavailable is always visible. "Not eligible" and
  // "already a lead" are different answers, and a customer deciding what to do
  // next needs to know which one applies.
  const approveReason = approved
    ? "This prospect has already been approved"
    : !eligible
      ? "Contactability has not been confirmed for this prospect"
      : undefined;

  const promoteReason = promoted
    ? "This prospect is already a lead"
    : !eligible
      ? "This prospect is not eligible for contact"
      : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        disabled={approved || !eligible || pending}
        title={approveReason}
        onClick={() => run(() => approveProspectAction(prospect.id), "Approved for outreach.")}
      >
        {approved ? "Approved" : "Approve for outreach"}
      </Button>
      <Button
        size="sm"
        loading={pending}
        disabled={promoted || !eligible || pending}
        title={promoteReason}
        onClick={() =>
          run(
            () => promoteProspectToLeadAction(prospect.id),
            "Promoted to a lead. Its sourcing history travels with it.",
          )
        }
      >
        {promoted ? "Already a lead" : "Promote to lead"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11.5px] text-content-muted">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 flex items-center gap-2 truncate text-[13px] text-content">
        {value ?? <span className="text-content-subtle">—</span>}
        {value && children}
      </dd>
    </div>
  );
}

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
