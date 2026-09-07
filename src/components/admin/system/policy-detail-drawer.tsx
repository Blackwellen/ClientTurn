"use client";

import * as React from "react";
import { Archive, CheckCircle2, Globe2, ShieldCheck, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { IconTile } from "@/components/admin/ui";
import { formatDate, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  POLICY_CHANNEL_LABEL,
  POLICY_STANCE_LABEL,
  POLICY_STANCE_TONE,
  POLICY_STATUS_LABEL,
  POLICY_STATUS_TONE,
  type PolicyDetail,
} from "@/lib/admin/compliance-types";

const TABS = ["Overview", "Rules", "Applicability", "History"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] break-words text-content">
        {children}
      </dd>
    </div>
  );
}

/**
 * The policy drawer. It is read-mostly by design: the two write actions are
 * Publish (a draft becomes live) and Archive (a live pack is retired). There is
 * deliberately no "edit" — a rule change is a new version, so the pack that
 * governed a past send is always still readable exactly as it was applied.
 */
export function PolicyDetailDrawer({
  policy,
  pending,
  onClose,
  onPublish,
  onArchive,
}: {
  policy: PolicyDetail;
  pending: string | null;
  onClose: () => void;
  onPublish: (policyId: string) => void;
  onArchive: (policyId: string) => void;
}) {
  // Mounted under `key={policy.id}` — selecting another version remounts the
  // drawer, so it opens on Overview without a reset effect.
  const [tab, setTab] = React.useState<Tab>("Overview");

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={`${policy.name} (${policy.version})`}
      header={
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[16px] font-semibold text-content">
              {policy.name} ({policy.version})
            </h2>
            <Badge tone={POLICY_STATUS_TONE[policy.status]} dot>
              {POLICY_STATUS_LABEL[policy.status]}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-content-muted">{policy.scope}</p>
        </div>
      }
      footer={
        <DrawerFooter className="gap-2">
          <Button
            onClick={() => onPublish(policy.id)}
            disabled={!policy.canPublish || pending === `publish:${policy.id}`}
            className="gap-1.5"
          >
            <Upload className="size-3.5" aria-hidden />
            Publish version
          </Button>
          <Button
            variant="secondary"
            onClick={() => onArchive(policy.id)}
            disabled={policy.status === "RETIRED" || pending === `archive:${policy.id}`}
            className="gap-1.5"
          >
            <Archive className="size-3.5" aria-hidden />
            Archive version
          </Button>
        </DrawerFooter>
      }
    >
      <div className="border-b border-line px-5">
        <div role="tablist" aria-label="Policy detail" className="flex gap-1 overflow-x-auto">
          {TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                tab === option
                  ? "border-accent-500 text-content-accent"
                  : "border-transparent text-content-muted hover:text-content",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <DrawerBody className="space-y-4">
        {tab === "Overview" && (
          <>
            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-1 text-[13px] font-semibold text-content">
                Policy details
              </h3>
              <dl className="divide-y divide-line-subtle">
                <Row label="Version">
                  <span className="lr-tabular">{policy.version}</span>
                </Row>
                <Row label="Name">{policy.name}</Row>
                <Row label="Scope">{policy.scope}</Row>
                <Row label="Status">{POLICY_STATUS_LABEL[policy.status]}</Row>
                <Row label="Effective from">
                  {policy.effectiveFrom ? formatDate(policy.effectiveFrom) : "Not published"}
                </Row>
                <Row label="Created">{formatDate(policy.createdAt)}</Row>
                {policy.retiredAt && (
                  <Row label="Archived">{formatDate(policy.retiredAt)}</Row>
                )}
                <Row label="Decisions taken">
                  <span className="lr-tabular">{formatNumber(policy.decisionCount)}</span>
                </Row>
                <Row label="Channels">
                  {policy.channels.length > 0
                    ? policy.channels
                        .map((channel) => POLICY_CHANNEL_LABEL[channel] ?? channel)
                        .join(", ")
                    : "All configured channels"}
                </Row>
              </dl>
            </section>

            {policy.publishBlockedReason && (
              <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-[12.5px] text-content-secondary">
                {policy.publishBlockedReason}
              </p>
            )}

            <section className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start gap-2.5">
                <IconTile icon={ShieldCheck} tone="success" />
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-content">
                    Key requirements
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {policy.keyRequirements.map((requirement) => (
                      <li
                        key={requirement}
                        className="flex items-start gap-2 text-[12.5px] text-content-secondary"
                      >
                        <CheckCircle2
                          className="mt-0.5 size-3.5 shrink-0 text-success-500"
                          aria-hidden
                        />
                        {requirement}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {policy.keyChanges.length > 0 && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-content">
                  Key changes in this version
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-content-secondary">
                  {policy.keyChanges.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === "Rules" && (
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-content">
              Channel stances under this pack
            </h3>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-sunken/60">
                  {["Channel", "Stance", "Requirements"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {policy.channelRows.map((row) => (
                  <tr key={row.channel}>
                    <td className="px-4 py-2 text-[12.5px] font-medium whitespace-nowrap text-content">
                      {POLICY_CHANNEL_LABEL[row.channel]}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={POLICY_STANCE_TONE[row.stance]} className="px-2">
                        {POLICY_STANCE_LABEL[row.stance]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-[12px] text-content-secondary">
                      {row.requirements.slice(0, 3).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "Applicability" && (
          <>
            <section className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start gap-2.5">
                <IconTile icon={Globe2} tone="info" />
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-content">
                    Countries in scope
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {policy.countryCodes.length === 0 ? (
                      <Badge tone="neutral" className="px-2">
                        All countries (default pack)
                      </Badge>
                    ) : (
                      policy.countryCodes.map((code) => (
                        <Badge key={code} tone="neutral" className="px-2">
                          {code.toUpperCase()}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            {policy.linkedProviders.length > 0 && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-content">
                  Linked providers
                </h3>
                <ul className="space-y-1.5">
                  {policy.linkedProviders.map((provider) => (
                    <li
                      key={provider.provider}
                      className="flex items-center justify-between gap-3 text-[12.5px]"
                    >
                      <span className="text-content-secondary">{provider.label}</span>
                      <Badge tone={provider.healthy ? "success" : "warning"} dot>
                        {provider.healthy ? "Active" : "Degraded"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === "History" && (
          <ol className="space-y-3">
            {policy.recentChanges.length === 0 ? (
              <li className="text-[12.5px] text-content-muted">
                No changes have been recorded against this version.
              </li>
            ) : (
              policy.recentChanges.map((change, index) => (
                <li key={index} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-content-subtle"
                  />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-content">{change.summary}</p>
                    <p className="text-[11.5px] text-content-subtle">
                      {formatRelative(change.at)}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ol>
        )}
      </DrawerBody>
    </Drawer>
  );
}
