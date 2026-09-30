"use client";

import * as React from "react";
import Link from "next/link";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useReducedMotion } from "@/components/marketing/use-reduced-motion";
import { Check, Copy, PhoneCall, RotateCcw, Sparkles, UserRound } from "lucide-react";
import {
  AUTO_ENROLMENT,
  BOUNDS,
  CALC_PLAN_KEYS,
  DEFAULT_INPUTS,
  EMPLOYER_NI,
  FIGURES_CHECKED_ON,
  HOLIDAY_SOURCE,
  MAX_PACK_QUANTITY,
  ONS_SICK_DAYS_2022,
  SICKNESS_SOURCE,
  TAX_YEAR,
  VOICE_PACK_KEYS,
  WORKING_DAYS_PER_YEAR,
  calculate,
  employerNi,
  employerPension,
  formatCount,
  formatGbp,
  inputsFromQuery,
  inputsToQuery,
  matchSdrCalls,
  planAllowances,
  planLabel,
  summaryText,
  type CalculatorInputs,
  type CallMatch,
  type CallMatchMode,
  type NumericKey,
} from "@/lib/marketing/sdr-calculator";
import {
  VOICE_MINUTE_PACKS,
  VOICE_NUMBER_MONTHLY_GBP,
  PLANS,
} from "@/lib/billing/plans";
import { WHATSAPP_TOKEN_PACKS } from "@/lib/billing/whatsapp-tokens";
import { PrimaryCta, SecondaryCta } from "@/components/marketing/public/actions";
import { cn } from "@/lib/cn";

/**
 * The /sdr-cost-calculator widget. Every number comes from
 * `lib/marketing/sdr-calculator.ts`; this file only renders inputs and results.
 */

/* ------------------------------------------------------------- numbers --- */

/** A number that eases to its new value. Instant under reduced motion. */
function Animated({ value, format }: { value: number; format: (value: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (latest) => format(latest));
  React.useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.35, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, reduce]);
  return <motion.span className="sdrc-num">{text}</motion.span>;
}

function Money({ value }: { value: number | null }) {
  if (value === null) return <span className="sdrc-num">n/a</span>;
  return <Animated value={value} format={formatGbp} />;
}

function Count({ value }: { value: number }) {
  return <Animated value={value} format={(v) => formatCount(Math.round(v * 10) / 10)} />;
}

/* -------------------------------------------------------------- fields --- */

function NumberField({
  id,
  label,
  value,
  onChange,
  field,
  prefix,
  suffix,
  slider = false,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  field: NumericKey;
  prefix?: string;
  suffix?: string;
  slider?: boolean;
  hint?: React.ReactNode;
}) {
  const { min, max, step } = BOUNDS[field];
  const [draft, setDraft] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);
  const shown = editing ? draft : String(value);

  return (
    <div className={cn("sdrc-field", slider && "sdrc-field-slider")}>
      <label htmlFor={id}>{label}</label>
      <div className="sdrc-input">
        {prefix ? <span aria-hidden>{prefix}</span> : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={shown}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onFocus={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(next)) {
              onChange(Math.min(max, Math.max(min, next)));
            }
          }}
          onBlur={() => setEditing(false)}
        />
        {suffix ? <span aria-hidden>{suffix}</span> : null}
      </div>
      {slider ? (
        <input
          type="range"
          className="sdrc-range"
          aria-label={`${label}, slider`}
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ "--sdrc-fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        />
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="sdrc-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
  detail,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  detail: string;
}) {
  return (
    <div className="sdrc-toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        <span>{label}</span>
        <span className="sdrc-hint">{detail}</span>
      </label>
    </div>
  );
}

function Stepper({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const set = (next: number) => onChange(Math.max(0, Math.min(MAX_PACK_QUANTITY, next)));
  return (
    <div className="sdrc-stepper" aria-disabled={disabled || undefined}>
      <label htmlFor={id}>{label}</label>
      <div>
        <button type="button" aria-label={`Fewer: ${label}`} disabled={disabled || value === 0} onClick={() => set(value - 1)}>
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_PACK_QUANTITY}
          value={value}
          disabled={disabled}
          onChange={(e) => set(Math.floor(Number(e.target.value) || 0))}
        />
        <button type="button" aria-label={`More: ${label}`} disabled={disabled} onClick={() => set(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

function Row({ label, children, strong }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("sdrc-row", strong && "sdrc-row-strong")}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- bars --- */

function CompareBar({ label, sdr, clientTurn, note }: { label: string; sdr: number; clientTurn: number; note?: string }) {
  const max = Math.max(sdr, clientTurn, 1);
  return (
    <div className="sdrc-bar">
      <div className="sdrc-bar-head">
        <span>{label}</span>
        {note ? <span className="sdrc-hint">{note}</span> : null}
      </div>
      <div className="sdrc-bar-line" data-side="sdr">
        <span className="sdrc-bar-track" aria-hidden>
          <span style={{ transform: `scaleX(${sdr / max})` }} />
        </span>
        <span className="sdrc-bar-value">
          <span className="sr-only">SDR: </span>
          <Count value={sdr} />
        </span>
      </div>
      <div className="sdrc-bar-line" data-side="ct">
        <span className="sdrc-bar-track" aria-hidden>
          <span style={{ transform: `scaleX(${clientTurn / max})` }} />
        </span>
        <span className="sdrc-bar-value">
          <span className="sr-only">ClientTurn: </span>
          <Count value={clientTurn} />
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- the widget --- */

export function SdrCalculator() {
  const [inputs, setInputs] = React.useState<CalculatorInputs>(DEFAULT_INPUTS);
  const [hydrated, setHydrated] = React.useState(false);
  const [matchMode, setMatchMode] = React.useState<CallMatchMode>("connects");
  const [match, setMatch] = React.useState<CallMatch | null>(null);
  const [copied, setCopied] = React.useState<"idle" | "done" | "failed">("idle");

  // Read the shared link once, after hydration (the page stays static).
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is only available in the browser.
    setInputs(inputsFromQuery(window.location.search));
    setHydrated(true);
  }, []);

  // Keep the URL in step, so a copied link reproduces the calculation.
  React.useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      const query = inputsToQuery(inputs);
      const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", url);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [inputs, hydrated]);

  const result = React.useMemo(() => calculate(inputs), [inputs]);
  const { clientTurn: ct, sdr, capacity } = result;
  const allowances = ct.allowances;

  const set = React.useCallback(<K extends keyof CalculatorInputs>(key: K, value: CalculatorInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
    setMatch(null);
  }, []);

  const setPack = (group: "voicePacks" | "whatsappPacks", key: string, qty: number) => {
    setInputs((current) => {
      const next = { ...current[group] };
      if (qty > 0) next[key] = qty;
      else delete next[key];
      return { ...current, [group]: next };
    });
    setMatch(null);
  };

  const num = (field: NumericKey, label: string, extra: Partial<React.ComponentProps<typeof NumberField>> = {}) => (
    <NumberField
      id={`sdrc-${field}`}
      field={field}
      label={label}
      value={inputs[field]}
      onChange={(value) => set(field, value)}
      {...extra}
    />
  );

  function applyMatch() {
    const found = matchSdrCalls(result.inputs, matchMode);
    setInputs((current) => ({ ...current, voicePacks: { ...found.combo.counts } }));
    setMatch(found);
  }

  async function copy() {
    const text = summaryText(result, window.location.href);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 2400);
  }

  function reset() {
    setInputs({ ...DEFAULT_INPUTS, voicePacks: {}, whatsappPacks: {} });
    setMatch(null);
    setMatchMode("connects");
  }

  const packsOn = !ct.enterprise;
  const whatsappOn = allowances.whatsappEnabled;
  const suggestedLabel = planLabel(capacity.plan);
  const sdrConnects = Math.round((sdr.activity.calls * result.inputs.callConnectPct) / 100);

  return (
    <div className="sdrc">
      <div className="sdrc-cols">
        {/* -------------------------------------------------- ClientTurn --- */}
        <section className="sdrc-panel" data-side="ct" aria-labelledby="sdrc-ct-title">
          <header className="sdrc-panel-head">
            <span className="sdrc-badge" aria-hidden>
              <Sparkles className="size-4" />
            </span>
            <div>
              <h2 id="sdrc-ct-title">ClientTurn</h2>
              <p className="sdrc-hint">Per month, from the plan catalogue.</p>
            </div>
          </header>

          <fieldset className="sdrc-plans">
            <legend className="sr-only">Plan</legend>
            {CALC_PLAN_KEYS.map((key) => {
              const price = planAllowances(key).monthlyPrice;
              return (
                <label key={key} className="sdrc-plan" data-checked={inputs.plan === key || undefined}>
                  <input
                    type="radio"
                    name="sdrc-plan"
                    value={key}
                    checked={inputs.plan === key}
                    onChange={() => set("plan", key)}
                  />
                  <span className="sdrc-plan-name">{planLabel(key)}</span>
                  <span className="sdrc-plan-price">{price === null ? "Custom" : formatGbp(price)}</span>
                </label>
              );
            })}
          </fieldset>

          {ct.enterprise ? (
            <div className="sdrc-enterprise">
              <p>
                <strong>Custom volumes: contact sales.</strong> Enterprise is priced against your lead
                volume, sourcing, messaging and users, so there is no public price to compare.
              </p>
              <SecondaryCta placement="sdr_calculator_enterprise" href="/contact-sales" size="sm" withArrow>
                Contact sales
              </SecondaryCta>
            </div>
          ) : (
            <dl className="sdrc-list">
              <Row label="Price" strong>
                <Money value={ct.monthly} />
              </Row>
              <Row label="Outbound emails">
                <Count value={allowances.emailSends} />
              </Row>
              <Row label="Leads processed">
                <Count value={allowances.leadsProcessed} />
              </Row>
              <Row label="Verified prospects sourced">
                <Count value={allowances.verifiedProspects} />
              </Row>
              <Row label="SMS segments">
                <Count value={allowances.smsSegments} />
              </Row>
              <Row label={<>AI voice minutes <span className="sdrc-hint">(calls at {formatCount(result.inputs.avgCallMinutes)} min)</span></>}>
                <Count value={ct.voiceMinutes} /> <span className="sdrc-hint">(<Count value={ct.callsCovered} />)</span>
              </Row>
              {ct.breakdown.voicePacks > 0 ? (
                <Row label="Voice packs">
                  <Money value={ct.breakdown.voicePacks} />
                </Row>
              ) : null}
              {ct.breakdown.number > 0 ? (
                <Row label="Dedicated number">
                  <Money value={ct.breakdown.number} />
                </Row>
              ) : null}
              {ct.breakdown.whatsapp > 0 ? (
                <Row label={<>WhatsApp tokens <span className="sdrc-hint">({formatCount(ct.whatsappMessages)} marketing msgs)</span></>}>
                  <Money value={ct.breakdown.whatsapp} />
                </Row>
              ) : null}
            </dl>
          )}

          {packsOn ? (
            <>
              {num("avgCallMinutes", "Average call length", { suffix: "min" })}

              <details className="sdrc-more">
                <summary>Voice minutes and WhatsApp add-ons</summary>
                <div className="sdrc-more-body">
                  <div className="sdrc-steppers">
                    {VOICE_MINUTE_PACKS.map((pack) => (
                      <Stepper
                        key={pack.key}
                        id={`sdrc-${pack.key}`}
                        label={`${formatCount(pack.minutes)} min, ${formatGbp(pack.priceGbp)}`}
                        value={inputs.voicePacks[pack.key] ?? 0}
                        onChange={(qty) => setPack("voicePacks", pack.key, qty)}
                      />
                    ))}
                  </div>
                  <p className="sdrc-hint">
                    Prepaid packs, bought as needed, no overage; shown as a monthly cost at this usage.
                    {allowances.includesNumber
                      ? " Pro with Voice includes the number."
                      : ` Packs add a ${formatGbp(VOICE_NUMBER_MONTHLY_GBP)}/month number.`}
                  </p>

                  <div className="sdrc-match">
                    <div className="sdrc-seg" role="radiogroup" aria-label="Match the SDR's">
                      {(["connects", "dials"] as const).map((mode) => (
                        <label key={mode} data-checked={matchMode === mode || undefined}>
                          <input
                            type="radio"
                            name="sdrc-match"
                            checked={matchMode === mode}
                            onChange={() => {
                              setMatchMode(mode);
                              setMatch(null);
                            }}
                          />
                          {mode === "connects" ? "Conversations" : "Every dial"}
                        </label>
                      ))}
                    </div>
                    {matchMode === "dials"
                      ? num("unansweredAttemptMinutes", "Minutes per unanswered attempt", {
                          suffix: "min",
                          hint: "Voicemail and ring-outs, averaged (our cost model).",
                        })
                      : null}
                    <button type="button" className="sdrc-btn" onClick={applyMatch}>
                      <PhoneCall className="size-4" aria-hidden />
                      Match my SDR&apos;s calls
                    </button>
                    <p className="sdrc-hint" aria-live="polite">
                      {match
                        ? match.combo.packs === 0
                          ? `No packs needed: the plan covers ${formatCount(match.minutesNeeded)} minutes.`
                          : `${formatCount(match.minutes)} min covers ${formatCount(match.callsCovered)} calls, adding ${formatGbp(match.addedMonthly)}/month.${match.beyondWorkspaceCapacity ? " That is above one workspace's calling capacity: talk to sales." : ""}`
                        : `Covers the SDR's ${matchMode === "connects" ? `${formatCount(sdrConnects)} conversations` : `${formatCount(sdr.activity.calls)} dials`} a month.`}
                    </p>
                  </div>

                  <div className="sdrc-steppers">
                    {WHATSAPP_TOKEN_PACKS.map((pack) => (
                      <Stepper
                        key={pack.tokens}
                        id={`sdrc-wa-${pack.tokens}`}
                        label={`${formatCount(pack.tokens)} WhatsApp tokens, ${formatGbp(pack.priceGbp)}`}
                        value={inputs.whatsappPacks[String(pack.tokens)] ?? 0}
                        disabled={!whatsappOn}
                        onChange={(qty) => setPack("whatsappPacks", String(pack.tokens), qty)}
                      />
                    ))}
                  </div>
                  {!whatsappOn ? (
                    <p className="sdrc-hint">WhatsApp is an add-on from {PLANS.growth.name}.</p>
                  ) : null}
                </div>
              </details>
              <p className="sdrc-note">
                AI calls only go to leads who asked for a call or agreed on a form: calls to warm, opted-in
                leads, not cold dials.
              </p>
            </>
          ) : null}
        </section>

        {/* --------------------------------------------------------- SDR --- */}
        <section className="sdrc-panel" data-side="sdr" aria-labelledby="sdrc-sdr-title">
          <header className="sdrc-panel-head">
            <span className="sdrc-badge" aria-hidden>
              <UserRound className="size-4" />
            </span>
            <div>
              <h2 id="sdrc-sdr-title">A human SDR</h2>
              <p className="sdrc-hint">UK employer costs, {TAX_YEAR}. Year one.</p>
            </div>
          </header>

          {num("salary", "Annual salary", { prefix: "£", slider: true })}

          <div className="sdrc-toggles">
            <Toggle
              id="sdrc-ni"
              label="Employer National Insurance"
              checked={inputs.employerNi}
              onChange={(value) => set("employerNi", value)}
              detail={`${EMPLOYER_NI.rate * 100}% over ${formatGbp(EMPLOYER_NI.secondaryThresholdAnnual)}: ${formatGbp(employerNi(result.inputs.salary))}/yr`}
            />
            <Toggle
              id="sdrc-pension"
              label="Auto-enrolment pension"
              checked={inputs.pension}
              onChange={(value) => set("pension", value)}
              detail={`${AUTO_ENROLMENT.employerMinimumRate * 100}% of qualifying earnings: ${formatGbp(employerPension(result.inputs.salary))}/yr`}
            />
          </div>

          <details className="sdrc-more">
            <summary>Time off and ramp-up</summary>
            <div className="sdrc-more-body sdrc-grid">
              {num("holidayDays", "Holiday (incl. bank holidays)", { suffix: "days" })}
              {num("sickDays", "Sick days", { suffix: "days" })}
              {num("rampMonths", "Ramp-up", { suffix: "months" })}
              {num("rampOutputPct", "Output while ramping", { suffix: "%" })}
            </div>
          </details>

          <details className="sdrc-more">
            <summary>Hiring, tools and overhead</summary>
            <div className="sdrc-more-body sdrc-grid">
              {num("recruitmentPct", "Recruitment fee", { suffix: "% of salary" })}
              {num("managementPct", "Management time", { suffix: "% of salary" })}
              {num("toolDialler", "Dialler", { prefix: "£", suffix: "/mo" })}
              {num("toolData", "Contact data", { prefix: "£", suffix: "/mo" })}
              {num("toolSalesNav", "Sales Navigator", { prefix: "£", suffix: "/mo" })}
              {num("toolCrm", "CRM seat", { prefix: "£", suffix: "/mo" })}
              {num("equipmentMonthly", "Equipment and office", { prefix: "£", suffix: "/mo" })}
            </div>
            <p className="sdrc-hint sdrc-pad">Tool, fee and overhead defaults are our estimates. Use your own.</p>
          </details>

          <details className="sdrc-more">
            <summary>
              Daily activity{" "}
              <span className="sdrc-hint">
                ({formatCount(sdr.productiveDays)} working days a month)
              </span>
            </summary>
            <div className="sdrc-more-body sdrc-grid">
              {num("callsPerDay", "Calls a day")}
              {num("emailsPerDay", "Emails a day")}
              {num("messagesPerDay", "Social and text messages a day")}
              {num("leadsPerDay", "Leads researched a day")}
            </div>
          </details>

          <dl className="sdrc-list">
            <Row label="Salary"><Money value={sdr.cost.salary} /></Row>
            <Row label="Employer NI and pension"><Money value={sdr.cost.employerNi + sdr.cost.pension} /></Row>
            <Row label="Recruitment"><Money value={sdr.cost.recruitment} /></Row>
            <Row label="Tools"><Money value={sdr.cost.tools} /></Row>
            <Row label="Management, equipment, office"><Money value={sdr.cost.management + sdr.cost.equipment} /></Row>
            <Row label="Year one, fully loaded" strong><Money value={sdr.cost.annual} /></Row>
          </dl>

          <details className="sdrc-more sdrc-how">
            <summary>How we calculated</summary>
            <ul className="sdrc-more-body">
              <li>
                Employer NI: {EMPLOYER_NI.rate * 100}% of salary above the {formatGbp(EMPLOYER_NI.secondaryThresholdAnnual)}{" "}
                secondary threshold (<a href={EMPLOYER_NI.source} target="_blank" rel="noopener noreferrer">gov.uk, {TAX_YEAR}</a>).
                Employment Allowance is not applied.
              </li>
              <li>
                Pension: {AUTO_ENROLMENT.employerMinimumRate * 100}% of earnings between {formatGbp(AUTO_ENROLMENT.qualifyingLower)}{" "}
                and {formatGbp(AUTO_ENROLMENT.qualifyingUpper)}, above the {formatGbp(AUTO_ENROLMENT.earningsTrigger)} trigger (
                <a href={AUTO_ENROLMENT.source} target="_blank" rel="noopener noreferrer">gov.uk</a>,{" "}
                <a href={AUTO_ENROLMENT.thresholdsSource} target="_blank" rel="noopener noreferrer">TPR</a>).
              </li>
              <li>
                Days: {WORKING_DAYS_PER_YEAR} weekdays less holiday (
                <a href={HOLIDAY_SOURCE} target="_blank" rel="noopener noreferrer">28 days statutory</a>) and sickness (
                <a href={SICKNESS_SOURCE} target="_blank" rel="noopener noreferrer">ONS 2022: {ONS_SICK_DAYS_2022} days</a>).
              </li>
              <li>Outcomes are a year-one monthly average: ramp-up months count at the output you set.</li>
              <li>Figures checked {FIGURES_CHECKED_ON}.</li>
            </ul>
          </details>
        </section>
      </div>

      {/* ------------------------------------------------------ rates --- */}
      <section className="sdrc-panel sdrc-rates" aria-labelledby="sdrc-rates-title">
        <div className="sdrc-rates-head">
          <div>
            <h2 id="sdrc-rates-title">Conversion rates</h2>
            <p className="sdrc-hint">
              Example rates, adjust to yours. The same rates apply to both sides. Faster follow-up often
              lifts them, but nothing here assumes it.
            </p>
          </div>
          <div className="sdrc-seg" role="radiogroup" aria-label="Compare ClientTurn at">
            {(["sdr", "allowance"] as const).map((mode) => (
              <label key={mode} data-checked={inputs.volume === mode || undefined}>
                <input
                  type="radio"
                  name="sdrc-volume"
                  checked={inputs.volume === mode}
                  onChange={() => set("volume", mode)}
                />
                {mode === "sdr" ? "SDR's volume" : "Full allowance"}
              </label>
            ))}
          </div>
        </div>
        <div className="sdrc-rates-grid">
          {num("emailReplyPct", "Email reply rate", { suffix: "%" })}
          {num("emailReplyToMeetingPct", "Email reply to meeting", { suffix: "%" })}
          {num("callConnectPct", "Call connect rate", { suffix: "%" })}
          {num("connectToMeetingPct", "Call connect to meeting", { suffix: "%" })}
          {num("messageReplyPct", "SMS / social reply rate", { suffix: "%" })}
          {num("messageReplyToMeetingPct", "SMS / social reply to meeting", { suffix: "%" })}
          {num("meetingToSalePct", "Meeting to sale", { suffix: "%" })}
        </div>
      </section>

      {/* ----------------------------------------------------- results --- */}
      <section className="sdrc-results" aria-labelledby="sdrc-results-title">
        <h2 id="sdrc-results-title" className="sr-only">
          Results
        </h2>
        <div className="sdrc-stats">
          <div className="sdrc-stat">
            <p>Human SDR</p>
            <b><Money value={sdr.cost.monthly} /></b>
            <span>a month · <Money value={sdr.cost.annual} /> a year</span>
          </div>
          <div className="sdrc-stat" data-side="ct">
            <p>ClientTurn {allowances.label}</p>
            {ct.monthly === null ? (
              <>
                <b className="sdrc-num">Custom</b>
                <span>
                  <Link href="/contact-sales" className="pub-link">Contact sales</Link>
                </span>
              </>
            ) : (
              <>
                <b><Money value={ct.monthly} /></b>
                <span>a month · <Money value={ct.annual} /> a year</span>
              </>
            )}
          </div>
          <div className="sdrc-stat" data-side="save">
            {result.savingMonthly === null ? (
              <>
                <p>Saving</p>
                <b className="sdrc-num">Quote needed</b>
                <span>Enterprise is priced per contract</span>
              </>
            ) : result.savingMonthly >= 0 ? (
              <>
                <p>Estimated saving</p>
                <b><Money value={result.savingMonthly} /></b>
                <span>a month · <Money value={result.savingAnnual} /> a year</span>
              </>
            ) : (
              <>
                <p>ClientTurn costs more</p>
                <b><Money value={-result.savingMonthly} /></b>
                <span>a month on these inputs</span>
              </>
            )}
          </div>
        </div>

        <div className="sdrc-results-grid">
          <table className="sdrc-table">
            <caption className="sr-only">Outcomes and unit costs per month</caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Measure</span></th>
                <th scope="col">SDR</th>
                <th scope="col">ClientTurn</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Conversations</th>
                <td><Count value={sdr.outcomes.conversations} /></td>
                <td><Count value={ct.outcomes.conversations} /></td>
              </tr>
              <tr>
                <th scope="row">Meetings booked</th>
                <td><Count value={sdr.outcomes.meetings} /></td>
                <td><Count value={ct.outcomes.meetings} /></td>
              </tr>
              <tr>
                <th scope="row">Deals won</th>
                <td><Count value={sdr.outcomes.sales} /></td>
                <td><Count value={ct.outcomes.sales} /></td>
              </tr>
              <tr>
                <th scope="row">Cost per meeting</th>
                <td><Money value={sdr.costPerMeeting} /></td>
                <td><Money value={ct.costPerMeeting} /></td>
              </tr>
              <tr>
                <th scope="row">Cost per deal</th>
                <td><Money value={sdr.costPerSale} /></td>
                <td><Money value={ct.costPerSale} /></td>
              </tr>
            </tbody>
          </table>

          <div className="sdrc-bars" role="group" aria-labelledby="sdrc-bars-title">
            <div className="sdrc-bars-head">
              <h3 id="sdrc-bars-title">Monthly activity</h3>
              <span className="sdrc-legend" aria-hidden>
                <i data-side="sdr" /> SDR <i data-side="ct" /> ClientTurn
              </span>
            </div>
            {ct.enterprise ? (
              <p className="sdrc-hint">Enterprise volumes are set per contract.</p>
            ) : (
              <>
                <CompareBar label="Call conversations" sdr={sdrConnects} clientTurn={ct.capacity.calls} />
                <CompareBar label="Emails" sdr={sdr.activity.emails} clientTurn={ct.capacity.emails} />
                <CompareBar label="Messages" sdr={sdr.activity.messages} clientTurn={ct.capacity.messages} note="SMS goes to form-submitted mobiles only" />
                <CompareBar label="Leads sourced" sdr={sdr.activity.leadsSourced} clientTurn={ct.capacity.leadsSourced} />
              </>
            )}
          </div>
        </div>

        <div className="sdrc-capacity" aria-live="polite">
          {ct.enterprise ? (
            <p>Enterprise allowances are set per contract to match your volume.</p>
          ) : capacity.enterprise ? (
            <p>
              <strong>Beyond self-serve allowances.</strong> This SDR&apos;s volume needs custom
              allowances: <Link href="/contact-sales" className="pub-link">talk to sales</Link>.
            </p>
          ) : capacity.shortfalls.length === 0 ? (
            <p>
              <Check className="inline size-4" aria-hidden /> {allowances.label} covers this SDR&apos;s monthly volume.
            </p>
          ) : (
            <p>
              <strong>ClientTurn is bounded by plan allowances.</strong>{" "}
              {capacity.currentPlanCovers ? "" : `${suggestedLabel} covers the emails and prospects. `}
              {capacity.voice.combo.packs > 0 && ct.callsCovered < sdrConnects
                ? `Calls: add ${VOICE_PACK_KEYS.filter((key) => capacity.voice.combo.counts[key])
                    .map((key) => {
                      const pack = VOICE_MINUTE_PACKS.find((p) => p.key === key)!;
                      return `${capacity.voice.combo.counts[key]} × ${pack.minutes} min`;
                    })
                    .join(" + ")} (${formatGbp(capacity.voice.addedMonthly)}/month). `
                : ""}
              {capacity.smsTopUp.packs > 0 ? `Messages: ${formatCount(capacity.smsTopUp.units)} SMS credit (${formatGbp(capacity.smsTopUp.priceGbp)}). ` : ""}
            </p>
          )}
        </div>

        <div className="sdrc-actions">
          <button type="button" className="sdrc-btn" onClick={copy}>
            {copied === "done" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy results"}
          </button>
          <button type="button" className="sdrc-btn sdrc-btn-quiet" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Reset
          </button>
          <span className="sdrc-actions-gap" />
          <PrimaryCta placement="sdr_calculator_results" size="sm">
            Start free trial
          </PrimaryCta>
          <SecondaryCta placement="sdr_calculator_contact_sales" href="/contact-sales" size="sm">
            Contact sales
          </SecondaryCta>
        </div>
        <p className="sr-only" aria-live="polite">
          {copied === "done" ? "Results copied to the clipboard." : copied === "failed" ? "Could not copy. Select the page address to share it." : ""}
        </p>
      </section>
    </div>
  );
}
