"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { planOrder, type PlanDefinition } from "@/lib/billing/plans";
import { SOURCING_ALLOWANCES } from "@/lib/billing/sourcing-allowances";
import { trackEngagement } from "@/lib/marketing/track";

/**
 * The plan comparison.
 *
 * Every cell is computed from the plan catalogue and the seeded Find Leads
 * allowances, so a row cannot claim a capability the entitlements do not
 * grant. A tick means the entitlement is on for that plan; a dash means it is
 * off — there is no third state that quietly means "coming soon".
 *
 * Below 900px the table is replaced by one disclosure per plan rather than a
 * horizontally scrolling grid with a frozen column: on a phone that pattern is
 * a puzzle, not a table.
 */

const NUMBER = new Intl.NumberFormat("en-GB");

type Cell = string | boolean;

type Row = {
  label: string;
  value: (plan: PlanDefinition) => Cell;
};

type Group = {
  heading: string;
  rows: Row[];
};

function allowance(plan: PlanDefinition, value: number): string {
  return plan.id === "enterprise" ? "Custom" : NUMBER.format(value);
}

const GROUPS: Group[] = [
  {
    heading: "Volume",
    rows: [
      {
        label: "Users",
        value: (plan) =>
          plan.id === "enterprise" ? "Custom" : String(plan.userLimit),
      },
      {
        label: "New inbound leads per month",
        value: (plan) => allowance(plan, plan.leadLimit),
      },
      {
        label: "Verified prospects per month",
        value: (plan) =>
          allowance(plan, SOURCING_ALLOWANCES[plan.id].verifiedProspects),
      },
      {
        label: "Sourcing runs per month",
        value: (plan) =>
          allowance(plan, SOURCING_ALLOWANCES[plan.id].searchRuns),
      },
      {
        label: "Outbound emails per month",
        value: (plan) => allowance(plan, SOURCING_ALLOWANCES[plan.id].emailSends),
      },
      {
        label: "Included UK SMS segments",
        value: (plan) => allowance(plan, plan.smsSegmentAllowance),
      },
      {
        label: "Reactivation contacts",
        value: (plan) => allowance(plan, plan.reactivationContactLimit),
      },
    ],
  },
  {
    heading: "Channels",
    rows: [
      { label: "Email", value: () => true },
      { label: "SMS", value: () => true },
      { label: "WhatsApp", value: (plan) => plan.whatsappEnabled },
    ],
  },
  {
    heading: "Capabilities",
    rows: [
      { label: "Follow-up sequences", value: () => true },
      { label: "Qualification rules", value: () => true },
      { label: "Booking and handover", value: () => true },
      { label: "Reactivation campaigns", value: (plan) => plan.campaignsEnabled },
      { label: "Find Leads sourcing", value: () => true },
      {
        label: "Intent monitors",
        value: (plan) =>
          allowance(plan, SOURCING_ALLOWANCES[plan.id].intentMonitors),
      },
      {
        label: "Saved or recurring searches",
        value: (plan) =>
          allowance(plan, SOURCING_ALLOWANCES[plan.id].savedSearches),
      },
      {
        label: "Sending identities",
        value: (plan) =>
          allowance(plan, SOURCING_ALLOWANCES[plan.id].senderIdentities),
      },
      { label: "AI assistant", value: (plan) => plan.aiAssistAllowed },
      { label: "Analytics and CSV export", value: () => true },
      { label: "Integrations", value: () => true },
    ],
  },
  {
    heading: "Commercial",
    rows: [
      {
        label: "Self-serve checkout",
        value: (plan) => plan.selfServe,
      },
      {
        label: "Data processing agreement",
        value: (plan) => plan.id === "enterprise",
      },
      {
        label: "Dedicated support contact",
        value: (plan) => plan.id === "enterprise",
      },
      {
        label: "Onboarding assistance",
        value: (plan) => plan.id === "enterprise",
      },
    ],
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <>
        <Check className="pub-yes mx-auto size-4" aria-hidden />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus className="pub-no mx-auto size-4" aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

function priceLabel(plan: PlanDefinition): string {
  return plan.monthlyPrice === null
    ? "Custom"
    : `£${NUMBER.format(plan.monthlyPrice)}/m`;
}

export function PlanComparison() {
  const plans = planOrder();
  const reported = React.useRef(false);

  function report() {
    if (reported.current) return;
    reported.current = true;
    trackEngagement("pricing_compare_interaction");
  }

  return (
    <>
      {/* Desktop: one table, scrollable inside its own container. */}
      <div
        className="pub-compare-desktop pub-screen-scroll mt-8"
        onPointerDown={report}
      >
        <table className="pub-compare">
          <caption className="sr-only">
            Plan comparison. Allowances are per month unless stated otherwise.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  data-highlight={plan.recommended ? "true" : undefined}
                >
                  {plan.name}
                  <small>{priceLabel(plan)}</small>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.heading}>
              <tr className="pub-compare-group">
                <th scope="colgroup" colSpan={plans.length + 1}>
                  {group.heading}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {plans.map((plan) => (
                    <td
                      key={plan.id}
                      data-highlight={plan.recommended ? "true" : undefined}
                    >
                      <CellValue value={row.value(plan)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Mobile: one disclosure per plan. */}
      <div className="pub-compare-mobile">
        {plans.map((plan, index) => (
          <PlanDisclosure
            key={plan.id}
            plan={plan}
            defaultOpen={index === 0}
            onOpen={report}
          />
        ))}
      </div>
    </>
  );
}

function PlanDisclosure({
  plan,
  defaultOpen,
  onOpen,
}: {
  plan: PlanDefinition;
  defaultOpen?: boolean;
  onOpen: () => void;
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const id = `compare-${plan.id}`;

  return (
    <div className="pub-faq-row">
      <h3>
        <button
          type="button"
          className="pub-faq-trigger"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          onClick={() => {
            setOpen((value) => !value);
            onOpen();
          }}
        >
          <span>
            {plan.name}
            <span className="ml-2 font-normal text-[var(--pub-text-muted)]">
              {priceLabel(plan)}
            </span>
          </span>
          <span className="pub-faq-sign" aria-hidden />
        </button>
      </h3>

      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        hidden={!open}
      >
        {GROUPS.map((group) => (
          <React.Fragment key={group.heading}>
            <p className="px-[18px] pt-3 text-[0.63rem] font-semibold uppercase tracking-[0.14em] text-[var(--pub-text-muted)]">
              {group.heading}
            </p>
            <ul className="pub-compare-rows">
              {group.rows.map((row) => {
                const value = row.value(plan);
                return (
                  <li key={row.label}>
                    <span>{row.label}</span>
                    <b>
                      {value === true
                        ? "Included"
                        : value === false
                          ? "Not included"
                          : value}
                    </b>
                  </li>
                );
              })}
            </ul>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
