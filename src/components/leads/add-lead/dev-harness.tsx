"use client";

import * as React from "react";
import type { AddLeadContext } from "@/lib/leads/add-lead/queries";
import type {
  AddLeadState,
  ContactabilityAssessment,
  DuplicateMatch,
} from "@/lib/leads/add-lead/types";
import { initialAddLeadState } from "@/lib/leads/add-lead/types";
import { ADD_LEAD_STEPS, WizardProgress } from "./wizard-progress";
import { ContactStep, type DuplicateStatus } from "./contact-step";
import { EnquiryStep } from "./enquiry-step";
import { PermissionStep } from "./permission-step";
import { RouteStartStep } from "./route-step";

/**
 * Development-only. Renders any one of the four Add Lead steps inside the real
 * modal chrome against fixed data, so each layout can be compared with the
 * design without a database, a session or a workspace behind it.
 *
 * Every server round trip the live wizard makes — the duplicate check, the
 * contactability assessment — is replaced here by a fixture. Imported only by
 * `/dev/add-lead`.
 */

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";

const CONTEXT: AddLeadContext = {
  services: [
    { id: SERVICE_ID, name: "Roof Repair", averageValue: 2400 },
    { id: "22222222-2222-4222-8222-222222222222", name: "New Roof", averageValue: 8200 },
  ],
  members: [
    {
      userId: "33333333-3333-4333-8333-333333333333",
      name: "Jamie Taylor",
      email: "jamie@blackwellen.co.uk",
      role: "member",
    },
    {
      userId: "44444444-4444-4444-8444-444444444444",
      name: "Priya Shah",
      email: "priya@blackwellen.co.uk",
      role: "admin",
    },
  ],
  goals: [],
  capabilities: { sms: true, whatsapp: true, email: true },
  followUp: { automationReady: true, reason: null },
  serviceFlows: [SERVICE_ID],
  permissions: {
    canCreateLead: true,
    canManageServices: true,
    canAssignOthers: true,
  },
  currencySymbol: "£",
};

function filledState(): AddLeadState {
  const state = initialAddLeadState();
  state.contact = {
    firstName: "Jamie",
    lastName: "Taylor",
    company: "Riverside Roofing",
    email: "jamie@riversideroofing.com",
    mobile: "07700 900123",
    telephone: "01202 123456",
    postcode: "BH2 6AA",
    address: "",
  };
  state.enquiry = {
    serviceId: SERVICE_ID,
    enquiryText:
      "Customer called about a leak near the chimney and wants someone to inspect the roof this week.",
    source: "PHONE_CALL",
    sourceDetail: "Inbound call from existing yard sign",
    estimatedValue: "2,500",
    conversionGoal: "BOOK_SITE_VISIT",
    notes:
      "Customer sounded concerned about water ingress. Prefers a morning appointment. Mentioned they saw our sign locally.",
  };
  state.permission = {
    relationship: "REFERRAL",
    evidence:
      "Introduced by existing customer (Sarah Williams) on 12 Apr 2025. Happy for email and phone contact regarding roofing quote.",
  };
  state.routing = {
    ...state.routing,
    assigneeId: "33333333-3333-4333-8333-333333333333",
  };
  return state;
}

const ASSESSMENT: ContactabilityAssessment = {
  classification: "WARM",
  channels: {
    EMAIL: { permission: "PERMITTED", reason: "This channel can be used." },
    SMS: { permission: "PERMITTED", reason: "This channel can be used." },
    WHATSAPP: {
      permission: "REVIEW",
      reason: "This contact needs a human decision before any message is sent.",
    },
    PHONE: { permission: "PERMITTED", reason: "A person may call this number." },
  },
  suppression: [],
  prospectRedirect: false,
  evidenceRequirement: null,
};

const NO_DUPLICATES: DuplicateStatus = { state: "clear" };
const NO_MATCHES: DuplicateMatch[] = [];

export function AddLeadHarness({ step }: { step: number }) {
  const [state, setState] = React.useState<AddLeadState>(filledState);
  const [current, setCurrent] = React.useState(
    Math.min(Math.max(step - 1, 0), ADD_LEAD_STEPS.length - 1),
  );

  const patch = <K extends keyof AddLeadState>(
    key: K,
    value: Partial<AddLeadState[K]>,
  ) => setState((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));

  return (
    <div className="mx-auto max-w-[980px] rounded-2xl border border-line bg-surface shadow-xl">
      <header className="px-6 pb-3 pt-5">
        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-content">
          Add Lead
        </h2>
        <p className="mt-1 text-[13px] text-content-muted">
          Manually add a vetted warm lead and route them into ClientTurn.
        </p>
        <div className="mt-4">
          <WizardProgress current={current} furthest={3} onSelect={setCurrent} />
        </div>
      </header>

      <div className="border-t border-line-subtle bg-surface-sunken/25 px-6 py-5">
        {current === 0 && (
          <ContactStep
            value={state.contact}
            errors={{}}
            duplicate={NO_DUPLICATES}
            acknowledged={false}
            onChange={(value) => patch("contact", value)}
            onAcknowledge={() => {}}
            onOpenExisting={() => {}}
          />
        )}
        {current === 1 && (
          <EnquiryStep
            value={state.enquiry}
            errors={{}}
            services={CONTEXT.services}
            canManageServices
            currencySymbol="£"
            onChange={(value) => patch("enquiry", value)}
            onServiceCreated={() => {}}
          />
        )}
        {current === 2 && (
          <PermissionStep
            value={state.permission}
            errors={{}}
            assessment={ASSESSMENT}
            assessing={false}
            assessError={null}
            prospectBusy={false}
            onChange={(value) => patch("permission", value)}
            onProspectHandoff={() => {}}
          />
        )}
        {current === 3 && (
          <RouteStartStep
            state={state}
            errors={{}}
            assessment={ASSESSMENT}
            duplicates={NO_MATCHES}
            duplicateChecked
            members={CONTEXT.members}
            services={CONTEXT.services}
            serviceFlows={CONTEXT.serviceFlows}
            followUp={{ eligible: true, reason: null }}
            canAssignOthers
            onChange={(value) => patch("routing", value)}
            onEditStep={setCurrent}
          />
        )}
      </div>

      <footer className="rounded-b-2xl border-t border-line-subtle bg-surface px-6 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-content-muted">Cancel</span>
          <span className="text-[13px] text-content-muted">
            Back · {["Continue to Enquiry", "Continue to Permission", "Continue to Route & Start", "Create lead"][current]}
          </span>
        </div>
      </footer>
    </div>
  );
}
