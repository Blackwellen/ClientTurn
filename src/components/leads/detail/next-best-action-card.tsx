import "server-only";
import * as React from "react";
import Link from "next/link";
import { CircleHelp, Compass, Lock, Minus, Plus } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PlanLimitState, Skeleton } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/dates";
import { getEntitlements } from "@/lib/billing/entitlements";
import { loadQualificationIntel } from "@/lib/leads/detail-queries";
import { leadPageHref } from "@/lib/leads/detail-page";
import {
  ENGINE_MODE_COPY,
  NBA_ACTION_COPY,
  NBA_RULE_COPY,
  dimensionLabel,
  goalLabel,
} from "@/lib/qualification-intelligence/explain";
import { QUALIFICATION_CATALOGUE } from "@/lib/sales-library/qualification-dimensions";
import { NbaOverrideDialog, RequalifyButton } from "./qualification-override-dialogs";

/**
 * The right rail's Next best action card (§B.17): what the engine would do
 * next and why, "Why this question?" in words from the question-value terms,
 * the alternatives it weighed, its confidence and engine version, and the
 * controls a person uses to disagree (override, re-run).
 *
 * All six route states: a skeleton while it loads (NextBestActionSkeleton), an
 * empty state before the first assessment, an error card when the read fails,
 * read-only for a viewer, the subscription notice when the assistant cannot act
 * (plan limit), and the connect-a-calendar prompt when the action is a booking
 * and none is connected (integration required).
 */

function Shell({ children, title = "Next best action", aside }: { children: React.ReactNode; title?: string; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby="nba-title" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <h2 id="nba-title" className="flex items-center gap-1.5 text-[14px] font-semibold text-content">
          <Compass className="size-4 text-content-muted" aria-hidden />
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function NextBestActionSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the next best action" className="rounded-xl border border-line bg-surface shadow-xs">
      <div className="border-b border-line-subtle px-4 py-3">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="space-y-2.5 px-4 py-4">
        <Skeleton className="h-6 w-32 rounded-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}

/**
 * Engine codes are for the audit trail, not the owner (8.7): "USE_CASE" in the
 * reason becomes "main use case", "TEAM_SIZE.USERS" in an alternative becomes
 * "team size", and a workspace question's "custom:<id>" becomes "one of your
 * questions". Labels come from the one dimension catalogue.
 */
function readableCodes(text: string): string {
  return text
    .replace(/\bcustom:[0-9a-f-]{8,}/gi, "one of your questions")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?\b|\b[A-Z]{4,}\b/g, (code) => {
      // Only dimension codes the catalogue knows are rewritten, so ordinary
      // capitals in the engine's sentence are left alone.
      const dimension = code.split(".")[0];
      if (!(dimension in QUALIFICATION_CATALOGUE)) return code;
      return dimensionLabel(dimension).toLowerCase();
    });
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export async function NextBestActionCard({
  businessId,
  leadId,
  role,
  canWrite,
  bookingConfigured,
}: {
  businessId: string;
  leadId: string;
  role: string;
  canWrite: boolean;
  bookingConfigured: boolean;
}) {
  let intel;
  let subscriptionActive = true;
  try {
    const [loaded, entitlements] = await Promise.all([
      loadQualificationIntel(businessId, leadId, role),
      getEntitlements(businessId).catch(() => null),
    ]);
    intel = loaded;
    subscriptionActive = entitlements?.active ?? true;
  } catch (error) {
    console.error("[lead page] next best action failed to load", error);
    return (
      <Shell>
        <div className="px-4 py-4">
          <p className="text-[13px] text-content">The next best action could not be loaded.</p>
          <p className="mt-0.5 text-[12.5px] text-content-muted">This is usually temporary, and nothing about the lead has changed.</p>
          <Link
            href={leadPageHref(leadId, "qualification")}
            className="mt-2 inline-block text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Try again
          </Link>
        </div>
      </Shell>
    );
  }

  const { assessment, why, engineMode, status } = intel;
  const modeBadge = engineMode ? <StatusBadge kind="engine_mode" value={engineMode.mode} dense /> : null;

  if (!assessment || !assessment.nba) {
    return (
      <Shell aside={modeBadge}>
        <div className="space-y-3 px-4 py-4">
          <p className="text-[13px] text-content">
            {assessment ? "The stored next action could not be read." : "This lead has not been assessed yet."}
          </p>
          <p className="text-[12.5px] text-content-muted">
            {engineMode?.mode === "OFF"
              ? "The qualification engine is off for this workspace. An owner or admin can switch it on in Settings, AI & selling."
              : "An assessment runs when the lead arrives, replies or books. You can run one now."}
          </p>
          {canWrite ? (
            <RequalifyButton leadId={leadId} />
          ) : (
            <p className="flex items-center gap-1.5 text-[12px] text-content-muted">
              <Lock className="size-3.5" aria-hidden /> Your role can view this but not re-run it.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  const nba = assessment.nba;
  const copy = NBA_ACTION_COPY[nba.next_action];
  const needsCalendar = nba.next_action === "CTA_BOOK" && !bookingConfigured;

  return (
    <Shell aside={modeBadge}>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" dense>
            {copy.family}
          </Badge>
          <StatusBadge kind="nba_action" value={nba.next_action} />
          {assessment.manualOverride === "NBA" && (
            <Badge tone="purple" dense>
              Set by a person
            </Badge>
          )}
        </div>
        <p className="text-[13px] text-content">{readableCodes(nba.reason)}</p>
        {nba.question_intent && (
          <blockquote className="rounded-lg border border-line-subtle bg-surface-sunken/60 px-3 py-2 text-[13px] text-content-secondary">
            &ldquo;{nba.question_intent.rendering}&rdquo;
          </blockquote>
        )}
        {nba.resume_at && (
          <p className="text-[12.5px] text-content-muted">
            Resumes <time dateTime={nba.resume_at}>{formatDateTime(nba.resume_at)}</time>
          </p>
        )}

        {why ? (
          <details className="rounded-lg border border-line-subtle">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium text-content-accent">
              <CircleHelp className="size-3.5" aria-hidden />
              Why this question?
            </summary>
            <div className="space-y-2 border-t border-line-subtle px-3 py-2.5">
              <p className="text-[12.5px] text-content-secondary">{why.summary}</p>
              <ul className="space-y-1.5">
                {why.terms.map((term) => (
                  <li key={term.term} className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                    {term.direction === "+" ? (
                      <Plus className="size-3 text-success-600" aria-label="raises the value" />
                    ) : (
                      <Minus className="size-3 text-danger-600" aria-label="lowers the value" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-content">{term.label}</span>
                      <Progress
                        className="mt-0.5 h-1"
                        value={Math.min(1, Math.abs(term.value))}
                        max={1}
                        tone={term.direction === "+" ? "success" : "warning"}
                        label={term.sentence}
                      />
                    </span>
                    <span className="text-right text-[11.5px] tabular-nums text-content-muted">{term.value.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11.5px] text-content-subtle">
                Value {why.total.toFixed(2)}; a question is asked only at {why.askFloor} or above.
              </p>
            </div>
          </details>
        ) : (
          (nba.next_action === "CTA_BOOK" || nba.next_action === "CTA_CHECKOUT" || nba.next_action === "CTA_SIGNUP") && (
            <p className="text-[12px] text-content-muted">No question is asked first: it would only slow the lead down.</p>
          )
        )}

        {needsCalendar && (
          <p className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
            No calendar or booking page is connected, so the assistant cannot offer times.{" "}
            <Link href="/app/settings?section=connections" className="font-medium underline underline-offset-2">
              Connect one
            </Link>
            .
          </p>
        )}
        {!subscriptionActive && (
          <PlanLimitState
            title="Subscription inactive"
            description="The assistant is not acting on this lead while the subscription is inactive. Corrections are still recorded."
            action={
              <Link href="/app/settings?section=billing" className="text-[13px] font-medium text-content-accent">
                Review billing
              </Link>
            }
          />
        )}
        {engineMode?.mode === "SHADOW" && assessment.engineMode === "SHADOW" && (
          <p className="text-[12px] text-content-muted">{ENGINE_MODE_COPY.SHADOW.description}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-line-subtle bg-line-subtle text-[12px]">
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-content-subtle">Goal</dt>
          <dd className="mt-0.5 text-content">{goalLabel(assessment.goal)}</dd>
        </div>
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-content-subtle">Qualification score</dt>
          <dd className="mt-0.5 tabular-nums text-content">{Math.round(nba.qualification_score)} / 100</dd>
        </div>
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-content-subtle">Known</dt>
          <dd className="mt-0.5 tabular-nums text-content">{pct(assessment.completeness)} of what is required</dd>
        </div>
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-content-subtle">Confidence</dt>
          <dd className="mt-0.5 tabular-nums text-content">{pct(nba.confidence)}</dd>
        </div>
      </dl>

      {nba.alternatives.length > 0 && (
        <div className="border-t border-line-subtle px-4 py-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-content-subtle">Also considered</p>
          <ul className="mt-1.5 space-y-1">
            {nba.alternatives.map((alt, index) => (
              <li key={`${alt.action}-${alt.intent ?? "none"}-${index}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate text-content-secondary">
                  {NBA_ACTION_COPY[alt.action].label}
                  {alt.intent && <span className="text-content-subtle"> · {readableCodes(alt.intent)}</span>}
                </span>
                <span className="tabular-nums text-content-muted">{alt.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line-subtle px-4 py-3">
        <p className="text-[11.5px] text-content-subtle" title={NBA_RULE_COPY[nba.rule]}>
          {NBA_RULE_COPY[nba.rule]} Verdict by your rules: {status.verdict.toLowerCase().replace(/_/g, " ")}. Engine{" "}
          {assessment.engineVersion}.
        </p>
        {canWrite ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <NbaOverrideDialog leadId={leadId} intentState={assessment.intentState} />
            <RequalifyButton leadId={leadId} />
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-content-muted">
            <Lock className="size-3.5" aria-hidden /> Your role can view this but not change it.
          </p>
        )}
      </div>
    </Shell>
  );
}
