"use client";

import * as React from "react";
import { CheckCircle2, KeyRound, ShieldAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { Input, Select, Switch } from "@/components/ui/form";
import { IconTile, ProviderMark } from "@/components/admin/ui";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  PROVIDER_HEALTH_LABEL,
  PROVIDER_HEALTH_TONE,
  PROVIDER_TYPE_LABEL,
  UNIT_BASES,
  UNIT_BASIS_LABEL,
  type ProviderDetail,
  type UnitBasis,
} from "@/lib/admin/platform-settings-types";

const TABS = ["Overview", "Configuration", "Capabilities", "Monitoring", "Credentials"] as const;
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

export type ProviderSaveInput = {
  provider: string;
  enabled?: boolean;
  priority?: number;
  failoverOrder?: number | null;
  countryCodes?: string[];
  unitCostEstimate?: number | null;
  unitBasis?: UnitBasis | null;
  hardCostCeiling?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
  maxConcurrency?: number | null;
  credentialRef?: string | null;
};

/**
 * The provider drawer. Credentials appear here only as a *reference* — the name
 * of the environment variable or vault key — plus whether it currently
 * resolves. There is no field anywhere in this component that would accept a
 * secret value, which is the point.
 */
export function ProviderDrawer({
  provider,
  pending,
  onClose,
  onSave,
}: {
  provider: ProviderDetail;
  pending: string | null;
  onClose: () => void;
  onSave: (input: ProviderSaveInput) => void;
}) {
  // Mounted under `key={provider.provider}`. The form below seeds every field
  // from props in a `useState` initialiser, which does not re-run — the remount
  // is what stops one provider's unsaved rate limit appearing under another's.
  const [tab, setTab] = React.useState<Tab>("Overview");
  const [form, setForm] = React.useState({
    enabled: provider.enabled,
    priority: String(provider.priority),
    failoverOrder: provider.failoverOrder === null ? "" : String(provider.failoverOrder),
    countryCodes: provider.countryCodes.join(", "),
    unitCostEstimate:
      provider.unitCostEstimate === null ? "" : String(provider.unitCostEstimate),
    unitBasis: provider.unitBasis ?? "REQUEST",
    hardCostCeiling:
      provider.hardCostCeiling === null ? "" : String(provider.hardCostCeiling),
    rateLimitPerMinute:
      provider.rateLimitPerMinute === null ? "" : String(provider.rateLimitPerMinute),
    rateLimitPerHour:
      provider.rateLimitPerHour === null ? "" : String(provider.rateLimitPerHour),
    maxConcurrency:
      provider.maxConcurrency === null ? "" : String(provider.maxConcurrency),
    credentialRef: provider.credentialRef ?? "",
  });

  const numberOrNull = (value: string) =>
    value.trim() === "" ? null : Number(value);

  const ceilingBelowCost =
    form.hardCostCeiling.trim() !== "" &&
    form.unitCostEstimate.trim() !== "" &&
    Number(form.hardCostCeiling) < Number(form.unitCostEstimate);

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={provider.label}
      header={
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <ProviderMark provider={provider.provider} />
            <h2 className="truncate text-[16px] font-semibold text-content">
              {provider.label}
            </h2>
            <Badge tone={PROVIDER_HEALTH_TONE[provider.status]} dot>
              {PROVIDER_HEALTH_LABEL[provider.status]}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] text-content-muted">
            {PROVIDER_TYPE_LABEL[provider.type]}
            {provider.lastCheckedAt
              ? ` · last checked ${formatRelative(provider.lastCheckedAt)}`
              : ""}
          </p>
        </div>
      }
      footer={
        <DrawerFooter className="gap-2">
          <Button
            disabled={ceilingBelowCost || pending === `provider:${provider.provider}`}
            onClick={() =>
              onSave({
                provider: provider.provider,
                enabled: form.enabled,
                priority: Number(form.priority) || 1,
                failoverOrder: numberOrNull(form.failoverOrder),
                countryCodes: form.countryCodes
                  .split(",")
                  .map((code) => code.trim().toUpperCase())
                  .filter((code) => code.length === 2),
                unitCostEstimate: numberOrNull(form.unitCostEstimate),
                unitBasis: form.unitBasis as UnitBasis,
                hardCostCeiling: numberOrNull(form.hardCostCeiling),
                rateLimitPerMinute: numberOrNull(form.rateLimitPerMinute),
                rateLimitPerHour: numberOrNull(form.rateLimitPerHour),
                maxConcurrency: numberOrNull(form.maxConcurrency),
                credentialRef: form.credentialRef.trim() || null,
              })
            }
          >
            Save provider
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DrawerFooter>
      }
    >
      <div className="border-b border-line px-5">
        <div role="tablist" aria-label="Provider detail" className="flex gap-1 overflow-x-auto">
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
            {!provider.credentialConfigured && (
              <div className="flex items-start gap-2.5 rounded-xl border border-danger-100 bg-danger-50 p-4">
                <IconTile icon={ShieldAlert} tone="danger" />
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-danger-700">
                    Credential not set on this deployment
                  </h3>
                  <p className="mt-1 text-[12.5px] text-danger-700/90">
                    <span className="lr-tabular">{provider.credentialRef}</span> is not
                    present, so this provider cannot be called. Settings saved here take
                    effect as soon as it is.
                  </p>
                </div>
              </div>
            )}

            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="mb-1 text-[13px] font-semibold text-content">
                Provider details
              </h3>
              <dl className="divide-y divide-line-subtle">
                <Row label="Provider type">{PROVIDER_TYPE_LABEL[provider.type]}</Row>
                <Row label="Enabled">{provider.enabled ? "Yes" : "No"}</Row>
                <Row label="Priority">{provider.priority}</Row>
                <Row label="Failover order">{provider.failoverOrder ?? "Not set"}</Row>
                <Row label="Countries">
                  {provider.countryCodes.length === 0
                    ? "Global"
                    : provider.countryCodes.join(", ")}
                </Row>
                <Row label="Estimated unit cost">
                  {provider.unitCostEstimate === null
                    ? "Not set"
                    : `${provider.currency} ${provider.unitCostEstimate.toFixed(4)} ${
                        provider.unitBasis ? UNIT_BASIS_LABEL[provider.unitBasis] : ""
                      }`}
                </Row>
                <Row label="Hard cost ceiling">
                  {provider.hardCostCeiling === null ? (
                    <span className="text-warning-700">No ceiling configured</span>
                  ) : (
                    `${provider.currency} ${provider.hardCostCeiling.toFixed(4)}`
                  )}
                </Row>
                <Row label="Rate limit">
                  {provider.rateLimitPerMinute
                    ? `${formatNumber(provider.rateLimitPerMinute)}/min`
                    : "Not set"}
                </Row>
                <Row label="Last checked">
                  {provider.lastCheckedAt
                    ? formatDateTime(provider.lastCheckedAt)
                    : "Not monitored"}
                </Row>
              </dl>
            </section>

            {provider.failoverChain.length > 0 && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-content">
                  Failover chain
                </h3>
                <p className="mb-2 text-[12px] text-content-muted">
                  If {provider.label} is unavailable, the waterfall tries these in order.
                </p>
                <ol className="space-y-1.5">
                  {provider.failoverChain.map((step) => (
                    <li
                      key={step.provider}
                      className="flex items-center gap-2.5 text-[12.5px] text-content-secondary"
                    >
                      <span className="lr-tabular flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[11px] font-semibold text-content-muted">
                        {step.order}
                      </span>
                      {step.label}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        {tab === "Configuration" && (
          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-content">Enabled</p>
                <p className="text-[11.5px] text-content-muted">
                  A disabled provider is skipped by the waterfall entirely.
                </p>
              </div>
              <Switch
                checked={form.enabled}
                label={`Enable ${provider.label}`}
                onCheckedChange={(next) =>
                  setForm((current) => ({ ...current, enabled: next }))
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Priority (1 is tried first)"
                type="number"
                value={form.priority}
                onChange={(value) => setForm((c) => ({ ...c, priority: value }))}
              />
              <Field
                label="Failover order"
                type="number"
                placeholder="Not set"
                value={form.failoverOrder}
                onChange={(value) => setForm((c) => ({ ...c, failoverOrder: value }))}
              />
            </div>

            <Field
              label="Country availability (ISO codes, comma separated — blank means global)"
              value={form.countryCodes}
              placeholder="GB, US, IE"
              onChange={(value) => setForm((c) => ({ ...c, countryCodes: value }))}
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Estimated unit cost"
                type="number"
                step="0.0001"
                value={form.unitCostEstimate}
                placeholder="Not set"
                onChange={(value) => setForm((c) => ({ ...c, unitCostEstimate: value }))}
              />
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-content-muted">
                  Unit basis
                </span>
                <Select
                  value={form.unitBasis}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, unitBasis: event.target.value as UnitBasis }))
                  }
                >
                  {UNIT_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {UNIT_BASIS_LABEL[basis]}
                    </option>
                  ))}
                </Select>
              </label>
              <Field
                label="Hard cost ceiling"
                type="number"
                step="0.0001"
                value={form.hardCostCeiling}
                placeholder="No ceiling"
                onChange={(value) => setForm((c) => ({ ...c, hardCostCeiling: value }))}
              />
            </div>

            {ceilingBelowCost && (
              <p className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[12px] text-danger-700">
                The ceiling is below the estimated unit cost, so every call would be
                blocked. Raise the ceiling or lower the estimate.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Requests / minute"
                type="number"
                value={form.rateLimitPerMinute}
                placeholder="Not set"
                onChange={(value) => setForm((c) => ({ ...c, rateLimitPerMinute: value }))}
              />
              <Field
                label="Requests / hour"
                type="number"
                value={form.rateLimitPerHour}
                placeholder="Not set"
                onChange={(value) => setForm((c) => ({ ...c, rateLimitPerHour: value }))}
              />
              <Field
                label="Max concurrency"
                type="number"
                value={form.maxConcurrency}
                placeholder="Not set"
                onChange={(value) => setForm((c) => ({ ...c, maxConcurrency: value }))}
              />
            </div>
          </section>
        )}

        {tab === "Capabilities" && (
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-content">
              What this provider can do
            </h3>
            <p className="mb-3 text-[12px] text-content-muted">
              Capabilities come from the platform catalogue — the client code that
              exists. A provider cannot be placed in a waterfall for a capability it
              does not have.
            </p>
            <ul className="space-y-1.5">
              {provider.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="flex items-center gap-2 text-[12.5px] text-content-secondary"
                >
                  <CheckCircle2 className="size-3.5 shrink-0 text-success-500" aria-hidden />
                  {capability}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "Monitoring" && (
          <>
            <section className="grid gap-3 sm:grid-cols-2">
              <Metric
                label="API calls (30 days)"
                value={formatNumber(provider.requests30d)}
              />
              <Metric
                label="Cost (30 days)"
                value={`$${provider.cost30d.toFixed(2)}`}
              />
              <Metric
                label="Probe error rate"
                value={
                  provider.errorRate === null
                    ? "Not monitored"
                    : `${(provider.errorRate * 100).toFixed(1)}%`
                }
              />
              <Metric
                label="Average latency"
                value={
                  provider.averageLatencyMs === null
                    ? "Not monitored"
                    : `${formatNumber(provider.averageLatencyMs)} ms`
                }
              />
            </section>

            {provider.recentChanges.length > 0 && (
              <section className="rounded-xl border border-line bg-surface p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-content">
                  Recent changes
                </h3>
                <ul className="space-y-2">
                  {provider.recentChanges.map((change, index) => (
                    <li key={index} className="text-[12.5px]">
                      <p className="text-content">{change.summary}</p>
                      <p className="text-[11.5px] text-content-subtle">
                        {formatRelative(change.at)} · {change.by ?? "system"}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === "Credentials" && (
          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-2.5">
              <IconTile
                icon={provider.credentialConfigured ? KeyRound : XCircle}
                tone={provider.credentialConfigured ? "success" : "danger"}
              />
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-content">
                  {provider.credentialConfigured
                    ? "Secret configured"
                    : "Secret not configured"}
                </h3>
                <p className="mt-1 text-[12.5px] text-content-secondary">
                  ClientTurn stores a <em>reference</em> to the credential, never the
                  credential. Rotating it means changing the value behind this
                  reference in the deployment environment — no admin screen can read
                  or write it.
                </p>
              </div>
            </div>

            <Field
              label="Credential reference"
              value={form.credentialRef}
              placeholder="env:CLEARBIT_API_KEY"
              onChange={(value) => setForm((c) => ({ ...c, credentialRef: value }))}
            />
            <p className="text-[11.5px] text-content-muted">
              Must be a pointer such as <code>env:NAME</code> or{" "}
              <code>vault:path/name</code>. A pasted secret is rejected.
            </p>

            <dl className="divide-y divide-line-subtle">
              <Row label="Environment">{provider.credentialEnvironment}</Row>
              <Row label="Last rotated">
                {provider.credentialRotatedAt
                  ? formatDateTime(provider.credentialRotatedAt)
                  : "Not recorded"}
              </Row>
            </dl>
          </section>
        )}
      </DrawerBody>
    </Drawer>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-content-muted">
        {label}
      </span>
      <Input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[12px] text-content-muted">{label}</p>
      <p className="lr-tabular mt-1.5 text-[19px] font-semibold text-content">{value}</p>
    </div>
  );
}
