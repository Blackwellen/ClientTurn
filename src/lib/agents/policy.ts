/**
 * Agent run policy — the decisions the scheduler and the sourcing worker make
 * about one agent, kept pure so they can be tested and so the UI can describe
 * exactly what the engine will do.
 *
 * Pure: no `server-only`, no Supabase.
 */

import type { AgentType, Autonomy, Cadence, SourceKey } from "./types";
import { chooseCostAwareChannel } from "../follow-up/channel-strategy.ts";

/* ------------------------------------------------------------ what runs */

export type AgentWork = "SOURCING" | "BOOKING" | "REENGAGEMENT";

/**
 * The work one scheduled tick does for an agent type.
 *
 * A combined agent does all three, in this order, each behind its own guards
 * and under the agent's one set of caps. Sourcing runs first because it only
 * queues a run; booking and re-engagement then act on existing leads.
 */
export function workForType(type: AgentType): AgentWork[] {
  switch (type) {
    case "SOURCING":
      return ["SOURCING"];
    case "BOOKING":
      return ["BOOKING"];
    case "REENGAGEMENT":
      return ["REENGAGEMENT"];
    case "COMBINED":
      return ["SOURCING", "BOOKING", "REENGAGEMENT"];
    default:
      return [];
  }
}

/* ------------------------------------------------------------- autonomy */

/**
 * The sourcing review mode an agent asks for.
 *
 * REVIEW_ALL keeps every result for a person. REVIEW_NEW and AUTO both ask for
 * AUTO_CONTACT, which `createRun` only grants when a verified sending identity
 * and an active acquisition campaign exist — and even then every send is
 * re-checked by the outreach dispatcher. Which prospects are handed to the
 * campaign is then narrowed by `enrolmentScope`.
 */
export function sourcingReviewMode(autonomy: Autonomy | string): "HUMAN_REVIEW" | "AUTO_CONTACT" {
  return autonomy === "AUTO" || autonomy === "REVIEW_NEW" ? "AUTO_CONTACT" : "HUMAN_REVIEW";
}

export type EnrolmentScope = "ALL" | "KNOWN_COMPANIES" | "NONE";

/**
 * Which READY prospects from an auto-contact run join the campaign without a
 * person approving them.
 *
 *   * AUTO — every READY prospect that matched the approved plan.
 *   * REVIEW_NEW — only prospects at companies the workspace already held
 *     before this run. A company seen for the first time waits for review.
 *   * anything else — none.
 */
export function enrolmentScope(autonomy: Autonomy | string | null | undefined): EnrolmentScope {
  if (autonomy === "AUTO") return "ALL";
  if (autonomy === "REVIEW_NEW") return "KNOWN_COMPANIES";
  return "NONE";
}

/**
 * The prospects to enrol, given the scope. A company counts as known when its
 * row existed before the run started — i.e. it was already in the workspace
 * and this run re-discovered it.
 */
export function selectEnrollable(
  prospects: { id: string; companyId: string | null }[],
  companyCreatedAt: Map<string, string>,
  runStartedAt: string,
  scope: EnrolmentScope,
): { enrol: string[]; held: string[] } {
  if (scope === "NONE") return { enrol: [], held: prospects.map((p) => p.id) };
  if (scope === "ALL") return { enrol: prospects.map((p) => p.id), held: [] };

  const enrol: string[] = [];
  const held: string[] = [];
  const started = Date.parse(runStartedAt);
  for (const prospect of prospects) {
    const created = prospect.companyId ? companyCreatedAt.get(prospect.companyId) : undefined;
    if (created && Date.parse(created) < started) enrol.push(prospect.id);
    else held.push(prospect.id);
  }
  return { enrol, held };
}

/* -------------------------------------------------------------- sources */

/**
 * The sourcing providers each agent source stands for. Keys are the
 * provider registry keys in `find-leads/server/providers`.
 *
 * Sources with no entry here are not part of a sourcing run (inbound lead
 * sources, a CRM, an imported list) and cannot be chosen for an agent.
 */
export const SOURCE_PROVIDERS: Partial<Record<SourceKey, readonly string[]>> = {
  GOOGLE_PLACES: ["google_places"],
  COMPANY_REGISTRY: ["companies_house"],
  WEBSITE: ["website_contacts", "website_signals"],
  // The LinkedIn list-import route is the customer's own imported list, not a
  // data provider, so it is not governed here.
  DATA_PROVIDER: ["hunter", "apollo", "clearbit"],
};

/** Every provider an agent's source choice governs. */
export const GOVERNED_PROVIDERS: readonly string[] = Object.values(SOURCE_PROVIDERS).flat();

/**
 * Providers a run for this agent must not use: every governed provider whose
 * source the agent has not switched on. Providers outside the catalogue
 * (public ad libraries, engagement on the workspace's own social accounts)
 * are left to the search plan.
 */
export function excludedProvidersFor(enabled: readonly string[]): string[] {
  const allowed = new Set(
    enabled.flatMap((key) => SOURCE_PROVIDERS[key as SourceKey] ?? []),
  );
  return GOVERNED_PROVIDERS.filter((provider) => !allowed.has(provider));
}

/* ----------------------------------------------------- re-engagement */

export type ReengagementChannel = "email" | "sms";

/**
 * The channel a re-engagement draft uses: the cheapest channel first, by the
 * same rule every automated re-engagement message follows
 * (follow-up/channel-strategy.ts `chooseCostAwareChannel`). Every lead in the
 * agent's audience has never replied and is therefore unengaged, so that is
 * the workspace's own mailbox when one is connected (free), otherwise SMS when
 * Twilio is connected, otherwise nothing -- and the agent reports that setup is
 * needed rather than drafting a campaign that could never launch. An SMS draft
 * is created in the cost-aware channel mode, so a lead with an email address
 * still gets email once a mailbox is connected.
 */
export function chooseReengagementChannel(connected: {
  mailbox: boolean;
  sms: boolean;
}): ReengagementChannel | null {
  return chooseCostAwareChannel({
    engaged: false,
    available: { sms: connected.sms, email: connected.mailbox },
    leadHas: { sms: true, email: true },
  });
}

/* ------------------------------------------------------------- run state */

/**
 * What a customer should read as the agent's state.
 *
 * An agent with a "Only when I run it" schedule stays ACTIVE after a manual
 * run so an in-flight sourcing run is not paused under it, but it will not run
 * again on its own — so it reads as idle, not as running.
 */
export function agentRunState(agent: {
  status: string;
  cadence: Cadence | string;
  nextRunAt: string | null;
}): { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger"; hint: string | null } {
  switch (agent.status) {
    case "ACTIVE":
      if (agent.cadence === "MANUAL" && !agent.nextRunAt) {
        return {
          label: "Idle",
          tone: "neutral",
          hint: "Ran once. It runs again only when you press Run once.",
        };
      }
      return { label: "Running", tone: "success", hint: null };
    case "PAUSED":
      return { label: "Paused", tone: "warning", hint: null };
    case "NEEDS_ATTENTION":
      return { label: "Needs attention", tone: "warning", hint: null };
    case "ERROR":
      return {
        label: "Error",
        tone: "danger",
        hint: "The last run failed unexpectedly. Start the agent again to retry.",
      };
    case "STOPPED":
      return { label: "Stopped", tone: "neutral", hint: null };
    default:
      return { label: "Draft", tone: "neutral", hint: null };
  }
}

/** The primary control's label and what pressing it does. */
export function runButton(agent: {
  status: string;
  cadence: Cadence | string;
}): { label: string; hint: string } {
  if (agent.cadence === "MANUAL") {
    return { label: "Run once", hint: "Runs the agent once now. It does not repeat on its own." };
  }
  if (agent.status === "ACTIVE") {
    return {
      label: "Run now",
      hint: "Runs immediately instead of waiting. The schedule carries on afterwards.",
    };
  }
  return {
    label: "Start agent",
    hint: "Runs once now, then on its schedule until you pause or stop it.",
  };
}

/** Whether a run failure is something the customer can fix (NEEDS_ATTENTION)
 *  or an unexpected fault (ERROR). */
export class AgentBlocked extends Error {}

export function failureStatus(error: unknown): "NEEDS_ATTENTION" | "ERROR" {
  return error instanceof AgentBlocked ? "NEEDS_ATTENTION" : "ERROR";
}
