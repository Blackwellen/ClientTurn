import * as React from "react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import {
  complianceEvidence,
  loadDataControls,
  suppressionSummary,
} from "@/lib/compliance/queries";
import { DataControlsForm } from "@/components/settings/compliance/data-controls-form";
import { Badge } from "@/components/ui/badge";

/**
 * Settings → Data Controls (Programme §14).
 *
 * Three things in one section, in the order they get asked about: what this
 * workspace has declared about itself, who it may no longer contact, and what
 * it can show if someone asks why a particular person was contacted.
 */

const REASON_LABELS: Record<string, string> = {
  OPT_OUT: "Opted out",
  COMPLAINT: "Complained",
  INVALID: "Invalid address",
  BOUNCE: "Bounced",
  LEGAL: "Legal request",
  MANUAL: "Added by hand",
  PROVIDER: "Provider suppression",
};

const RESULT_LABELS: Record<string, string> = {
  ALLOWED: "Allowed",
  BLOCKED: "Blocked",
  REVIEW_REQUIRED: "Needed a person",
  REQUIRE_CONSENT: "Needed consent",
  REQUIRE_PRIVACY_NOTICE: "Needed a privacy notice",
  REQUIRE_TEMPLATE: "Needed an approved template",
  REQUIRE_MANUAL_ACTION: "Needed a manual step",
};

export async function DataControlsSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");

  const [controls, suppression, evidence] = await Promise.all([
    loadDataControls(workspace.businessId),
    suppressionSummary(workspace.businessId),
    complianceEvidence(workspace.businessId),
  ]);

  return (
    <div className="space-y-4">
      <DataControlsForm initial={controls} canManage={canManage} />

      {/* ----------------------------------------------------- suppression */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <h3 className="text-[14px] font-semibold text-content">Suppression</h3>
        <p className="mt-0.5 text-[12.5px] text-content-muted">
          People who must not be contacted again. Every send is checked against
          this list at the moment it is sent, not when it was scheduled.
        </p>

        {suppression.total === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
            Nobody has opted out or been suppressed.
          </p>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-content">
              <span className="font-semibold">
                {suppression.total.toLocaleString("en-GB")}
              </span>{" "}
              suppressed {suppression.total === 1 ? "contact" : "contacts"}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {suppression.byReason.map((entry) => (
                <li key={entry.reason}>
                  <Badge tone="neutral" dense>
                    {REASON_LABELS[entry.reason] ?? entry.reason}: {entry.count}
                  </Badge>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Deliberately no remove button. An entry exists because somebody asked
            not to be contacted; taking one off is a decision that needs an
            audited reason and platform support, not a delete icon in settings. */}
        <p className="mt-3 text-[12px] text-content-subtle">
          Suppressions cannot be removed here. If one is wrong — a bounce from a
          mailbox that has since been fixed, say — contact support, and the
          removal is recorded against whoever authorised it.
        </p>
      </section>

      {/* -------------------------------------------------------- evidence */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
        <h3 className="text-[14px] font-semibold text-content">
          Evidence you can produce
        </h3>
        <p className="mt-0.5 text-[12.5px] text-content-muted">
          Every send records the decision that permitted it, the rules in force
          at the time, and the facts it relied on. This is the last 30 days.
        </p>

        {evidence.decisions.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
            No contact decisions have been recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {evidence.decisions.map((decision) => (
              <li
                key={decision.result}
                className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-[12.5px]"
              >
                <span className="text-content-secondary">
                  {RESULT_LABELS[decision.result] ?? decision.result}
                </span>
                <span className="font-medium text-content">
                  {decision.count.toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        )}

        {evidence.activePolicyVersions.length > 0 && (
          <>
            <p className="mt-3 text-[12.5px] font-medium text-content">
              Rules currently in force
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {evidence.activePolicyVersions.map((pack) => (
                <li key={pack.version}>
                  <Badge tone="neutral" dense>
                    {pack.name} · {pack.version}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-content-subtle">
              A decision is kept with the version that produced it, so a past send
              can be explained against the rules that applied then rather than the
              ones that apply now.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
