"use client";

import * as React from "react";
import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { saveDataControlsAction } from "@/lib/compliance/actions";
import {
  ALLOWED_SOURCE_KINDS,
  BASIS_DESCRIPTIONS,
  BASIS_LABELS,
  LAWFUL_BASES,
  PROHIBITED_SOURCES,
  PROSPECT_TYPE_LABELS,
  SOURCE_DESCRIPTIONS,
  SOURCE_LABELS,
  complianceGaps,
  type AllowedSourceKind,
  type DataControls,
  type LawfulBasis,
  type ProspectType,
} from "@/lib/compliance/types";

/**
 * Settings → Data Controls (Programme §14).
 *
 * The engine that decides whether a contact may be messaged has existed for a
 * while and is good. What never existed was anywhere for the customer to state
 * the facts it reasons from. This is that.
 *
 * Two things this page does that a settings form usually does not:
 *
 *   * **It says what is missing, and what that costs.** A blocking gap is
 *     labelled as blocking. Cold outreach that cannot name its sender or point
 *     at a privacy notice is not a marginal risk — it is mail that fails on its
 *     face, and letting someone send it without warning would be the wrong
 *     default.
 *   * **It shows what can never be permitted.** The prohibited sources are
 *     printed with no toggle beside them, because a rule nobody sees is one that
 *     gets tested by somebody assuming silence means yes.
 */

const COUNTRY_SUGGESTIONS = [
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
];

export function DataControlsForm({
  initial,
  canManage,
}: {
  initial: DataControls;
  canManage: boolean;
}) {
  const [value, setValue] = React.useState<DataControls>(initial);
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const gaps = complianceGaps(value);
  const blocking = gaps.filter((gap) => gap.severity === "BLOCKING");
  const advisory = gaps.filter((gap) => gap.severity === "ADVISORY");

  function set<K extends keyof DataControls>(key: K, next: DataControls[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setSaved(false);
  }

  function toggleSource(source: AllowedSourceKind) {
    set(
      "allowedSources",
      value.allowedSources.includes(source)
        ? value.allowedSources.filter((entry) => entry !== source)
        : [...value.allowedSources, source],
    );
  }

  function toggleCountry(code: string) {
    set(
      "prospectCountries",
      value.prospectCountries.includes(code)
        ? value.prospectCountries.filter((entry) => entry !== code)
        : [...value.prospectCountries, code],
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveDataControlsAction({
      legalName: value.legalName ?? undefined,
      registeredCountry: value.registeredCountry ?? undefined,
      registeredAddress: value.registeredAddress ?? undefined,
      privacyPolicyUrl: value.privacyPolicyUrl ?? "",
      privacyContactEmail: value.privacyContactEmail ?? "",
      dpoContact: value.dpoContact ?? undefined,
      prospectCountries: value.prospectCountries,
      prospectType: value.prospectType,
      allowedSources: value.allowedSources,
      marketingLawfulBasis: value.marketingLawfulBasis,
      lawfulBasisNote: value.lawfulBasisNote ?? undefined,
      retainUncontactedProspectsDays: value.retainUncontactedProspectsDays,
      retainInactiveLeadsDays: value.retainInactiveLeadsDays,
      retainRawEventsDays: value.retainRawEventsDays,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- readiness */}
      <section
        className={`rounded-xl border p-4 ${
          blocking.length > 0
            ? "border-warning-100 bg-warning-50/70"
            : "border-success-100 bg-success-50/60"
        }`}
      >
        <div className="flex items-start gap-2.5">
          {blocking.length > 0 ? (
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-700" />
          ) : (
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-700" />
          )}
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-content">
              {blocking.length > 0
                ? "Cold outreach is not ready yet"
                : "Ready for cold outreach"}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-content-secondary">
              {blocking.length > 0
                ? "ClientTurn will keep asking for a human decision on every cold contact until these are answered."
                : "Everything a cold email legally has to carry is on file. Contact rules are still applied per person, per channel, at the moment of sending."}
            </p>

            {gaps.length > 0 && (
              <ul className="mt-2 space-y-1">
                {[...blocking, ...advisory].map((gap) => (
                  <li key={gap.code} className="flex items-start gap-2 text-[12.5px]">
                    <Badge tone={gap.severity === "BLOCKING" ? "warning" : "neutral"} dense>
                      {gap.severity === "BLOCKING" ? "Required" : "Advised"}
                    </Badge>
                    <span className="text-content-secondary">{gap.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- organisation */}
      <Panel
        title="Organisation"
        description="Who is sending. This appears in marketing email because it has to."
      >
        <Field
          label="Legal name"
          hint="The registered name, not the trading name, if they differ."
          value={value.legalName ?? ""}
          onChange={(next) => set("legalName", next || null)}
          disabled={!canManage}
        />
        <Field
          label="Registered address"
          hint="A postal address is required in marketing email in several markets."
          value={value.registeredAddress ?? ""}
          onChange={(next) => set("registeredAddress", next || null)}
          disabled={!canManage}
          multiline
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Registered country"
            hint="Two-letter code, e.g. GB."
            value={value.registeredCountry ?? ""}
            onChange={(next) => set("registeredCountry", next.toUpperCase() || null)}
            disabled={!canManage}
            maxLength={2}
          />
          <Field
            label="Privacy contact"
            hint="Where privacy questions should go."
            value={value.privacyContactEmail ?? ""}
            onChange={(next) => set("privacyContactEmail", next || null)}
            disabled={!canManage}
          />
        </div>
        <Field
          label="Privacy notice URL"
          hint="Linked from outreach so people can see how their data is handled."
          value={value.privacyPolicyUrl ?? ""}
          onChange={(next) => set("privacyPolicyUrl", next || null)}
          disabled={!canManage}
        />
        <Field
          label="Data protection officer"
          hint="Only if your organisation is required to have one."
          value={value.dpoContact ?? ""}
          onChange={(next) => set("dpoContact", next || null)}
          disabled={!canManage}
        />
      </Panel>

      {/* --------------------------------------------------------- markets */}
      <Panel
        title="Markets"
        description="Which countries you prospect into. Each has its own rules, and naming yours means the right ones apply instead of the most restrictive."
      >
        <ul className="flex flex-wrap gap-1.5">
          {COUNTRY_SUGGESTIONS.map((country) => {
            const on = value.prospectCountries.includes(country.code);
            return (
              <li key={country.code}>
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => toggleCountry(country.code)}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                    on
                      ? "border-accent-300 bg-accent-50 text-content-accent"
                      : "border-line bg-surface text-content-secondary hover:bg-surface-hover"
                  }`}
                >
                  {country.name}
                </button>
              </li>
            );
          })}
        </ul>

        <fieldset className="mt-3">
          <legend className="text-[12.5px] font-medium text-content">
            Who you contact
          </legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(Object.keys(PROSPECT_TYPE_LABELS) as ProspectType[]).map((type) => (
              <label
                key={type}
                className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-[12.5px] ${
                  value.prospectType === type
                    ? "border-accent-300 bg-accent-50 text-content-accent"
                    : "border-line bg-surface text-content-secondary"
                }`}
              >
                <input
                  type="radio"
                  name="prospect-type"
                  className="sr-only"
                  checked={value.prospectType === type}
                  disabled={!canManage}
                  onChange={() => set("prospectType", type)}
                />
                {PROSPECT_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {value.prospectType !== "B2B" && (
            <p className="mt-1.5 text-[12px] text-content-muted">
              Contacting individuals is more tightly restricted than contacting
              businesses in every market ClientTurn supports. Expect more contacts
              to need a recorded consent before anything is sent.
            </p>
          )}
        </fieldset>
      </Panel>

      {/* --------------------------------------------------------- sources */}
      <Panel
        title="Data sources"
        description="Where prospect data may come from. Nothing is permitted until you choose."
      >
        <ul className="space-y-1.5">
          {ALLOWED_SOURCE_KINDS.map((source) => (
            <li key={source}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                  checked={value.allowedSources.includes(source)}
                  disabled={!canManage}
                  onChange={() => toggleSource(source)}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-content">
                    {SOURCE_LABELS[source]}
                  </span>
                  <span className="block text-[12px] text-content-muted">
                    {SOURCE_DESCRIPTIONS[source]}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
          <p className="text-[12.5px] font-medium text-content">
            Never permitted, on any plan
          </p>
          <ul className="mt-1 space-y-0.5">
            {PROHIBITED_SOURCES.map((entry) => (
              <li key={entry} className="text-[12px] text-content-muted">
                {entry}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* --------------------------------------------------- lawful basis */}
      <Panel
        title="Basis for contacting people"
        description="What makes your outreach lawful. ClientTurn records this; it does not assess it for you."
      >
        <ul className="space-y-1.5">
          {LAWFUL_BASES.filter((basis) => basis !== "UNSTATED").map((basis) => (
            <li key={basis}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 hover:bg-surface-hover">
                <input
                  type="radio"
                  name="lawful-basis"
                  className="mt-0.5 size-3.5 shrink-0 accent-accent-500"
                  checked={value.marketingLawfulBasis === basis}
                  disabled={!canManage}
                  onChange={() => set("marketingLawfulBasis", basis as LawfulBasis)}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-content">
                    {BASIS_LABELS[basis]}
                  </span>
                  <span className="block text-[12px] text-content-muted">
                    {BASIS_DESCRIPTIONS[basis]}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <Field
          label="Note"
          hint="If you rely on legitimate interests, summarise the assessment you made."
          value={value.lawfulBasisNote ?? ""}
          onChange={(next) => set("lawfulBasisNote", next || null)}
          disabled={!canManage}
          multiline
        />

        <p className="text-[12px] text-content-muted">
          This is a record of what you have decided, not legal advice, and
          ClientTurn does not check it. The per-contact rules — suppression,
          opt-outs, quiet hours, channel restrictions — are applied regardless of
          what is chosen here.
        </p>
      </Panel>

      {/* ------------------------------------------------------- retention */}
      <Panel
        title="Retention"
        description="How long data is kept. Blank means kept until deleted by hand."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Uncontacted prospects"
            suffix="days"
            value={value.retainUncontactedProspectsDays}
            onChange={(next) => set("retainUncontactedProspectsDays", next)}
            disabled={!canManage}
          />
          <NumberField
            label="Inactive leads"
            suffix="days"
            value={value.retainInactiveLeadsDays}
            onChange={(next) => set("retainInactiveLeadsDays", next)}
            disabled={!canManage}
          />
          <NumberField
            label="Raw inbound payloads"
            suffix="days"
            value={value.retainRawEventsDays}
            onChange={(next) => set("retainRawEventsDays", next)}
            disabled={!canManage}
          />
        </div>
      </Panel>

      {canManage && (
        <div className="flex items-center gap-3">
          <Button loading={pending} onClick={save}>
            Save data controls
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-success-700">
              <Check aria-hidden className="size-3.5" />
              Saved
            </span>
          )}
          {error && <span className="text-[12.5px] text-danger-700">{error}</span>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- fragments */

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="text-[14px] font-semibold text-content">{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-content-muted">{description}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  multiline,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  maxLength?: number;
}) {
  const className =
    "mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-content outline-none focus:border-accent-400 disabled:bg-surface-sunken";

  return (
    <label className="block">
      <span className="text-[12.5px] font-medium text-content">{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          maxLength={maxLength ?? 500}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength ?? 320}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      )}
      {hint && <span className="mt-0.5 block text-[11.5px] text-content-subtle">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  suffix,
  value,
  onChange,
  disabled,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium text-content">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          value={value ?? ""}
          disabled={disabled}
          placeholder="—"
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange(next === "" ? null : Number(next));
          }}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-content outline-none focus:border-accent-400 disabled:bg-surface-sunken"
        />
        <span className="shrink-0 text-[12px] text-content-subtle">{suffix}</span>
      </span>
    </label>
  );
}
