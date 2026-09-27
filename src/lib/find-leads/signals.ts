/**
 * Signals: the individual searches feeding an agent.
 *
 * Pure -- no `server-only`, no Supabase -- so the vocabulary and the health
 * judgement can be rendered by a client component and asserted without a
 * database.
 *
 * ## Why signals became rows
 *
 * The sourcing waterfall already ran these: a recently-funded search, a
 * competitor's followers, a job-change feed. They existed only as provider calls
 * inside a run, so a customer could see that 354 leads arrived and could not see
 * *which search produced them*, could not tell a productive one from a dead one,
 * and could not run one on demand.
 *
 * That is the difference between "the agent found some leads" and something a
 * person can manage. A signal returning nothing for a fortnight is worth turning
 * off; one returning ten good leads a day is worth running more often. Neither
 * decision is available if the only visible number is the total.
 */

import {
  INTENT_EVIDENCE_KINDS,
  kindsForCategory,
  type CategoryShape,
  type IntentEvidenceKind,
} from "./intent-evidence.ts";
import { TECH_FINGERPRINTS, type TechnologyKey } from "./website-signals.ts";
import type { SearchPlan } from "./plan.ts";
import {
  intentType,
  intentTypesForCategory,
  type IntentTypeId,
  type RoleFunction,
} from "./intent-catalogue.ts";
import { segmentTypes } from "./intent-segments.ts";

export const SIGNAL_KINDS = [
  "ENGAGEMENT",
  "COMPETITOR",
  "JOB_CHANGE",
  "FUNDING",
  "HIRING",
  "KEYWORD",
  "ICP_TOP",
  "WEBSITE_SIGNAL",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** The subtitle under a signal's name. Written for a customer. */
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  ENGAGEMENT: "Engagement & interest",
  COMPETITOR: "Competitor's audience",
  JOB_CHANGE: "Recently changed jobs",
  FUNDING: "Recently raised funds",
  HIRING: "Currently hiring",
  KEYWORD: "Keyword match",
  ICP_TOP: "Best fit for your profile",
  WEBSITE_SIGNAL: "Something on their website",
};

export type Signal = {
  id: string;
  name: string;
  kind: SignalKind;
  query: string | null;
  active: boolean;
  leadsFound: number;
  leadsFoundThisWeek: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: string | null;
  /**
   * Set when nothing that feeds this kind is configured: what to connect, in
   * words. A signal whose source is missing would otherwise run and silently
   * find nothing, which reads as "no leads" rather than "not set up".
   */
  needs?: string | null;
};

/* ---------------------------------------------------- where signals come from */

/**
 * The free, first-party feeds a signal can draw on.
 *
 * Every entry is the company's own website, the official register, the
 * workspace's own accounts, or a company-search source for discovery. No kind
 * depends on a paid contact-data vendor.
 */
export const SIGNAL_FEEDS = [
  "COMPANY_WEBSITE",
  "COMPANIES_HOUSE",
  "OWN_SOCIAL_ACCOUNTS",
  "COMPANY_SEARCH",
  "PLACES",
] as const;
export type SignalFeed = (typeof SIGNAL_FEEDS)[number];

/** The sourcing provider behind each feed. Asserted against the registry in tests. */
export const SIGNAL_FEED_PROVIDERS: Record<SignalFeed, string[]> = {
  COMPANY_WEBSITE: ["website_signals"],
  COMPANIES_HOUSE: ["companies_house"],
  OWN_SOCIAL_ACCOUNTS: ["meta_engagement", "tiktok_engagement"],
  COMPANY_SEARCH: ["google_places", "meta_ad_library", "tiktok_commercial_content"],
  // Business listings: corroborates a location, never dates it.
  PLACES: ["google_places"],
};

/** What to connect when a feed is missing. Written for a customer. */
export const SIGNAL_FEED_NEEDS: Record<SignalFeed, string> = {
  COMPANY_WEBSITE: "Nothing to connect: this reads companies' own public websites.",
  COMPANIES_HOUSE:
    "Needs a Companies House API key. It is free from developer.company-information.service.gov.uk.",
  OWN_SOCIAL_ACCOUNTS: "Needs a connected Facebook, Instagram or TikTok account.",
  COMPANY_SEARCH: "Needs a company search source, such as Google Places.",
  PLACES: "Needs a Google Places key.",
};

/**
 * Which feeds can serve each kind. Any one of them is enough.
 *
 * An empty list is a kind with no lawful free source. COMPETITOR is one: no
 * platform lets a third party list another company's followers, and scraping
 * them is exactly what this product does not do.
 */
export const SIGNAL_KIND_FEEDS: Record<SignalKind, SignalFeed[]> = {
  ENGAGEMENT: ["OWN_SOCIAL_ACCOUNTS"],
  COMPETITOR: [],
  // Officer appointments on the register: a company-level leadership change.
  JOB_CHANGE: ["COMPANIES_HOUSE"],
  // Share allotments (SH01) on the register.
  FUNDING: ["COMPANIES_HOUSE"],
  // Roles named on the company's own careers and jobs pages.
  HIRING: ["COMPANY_WEBSITE"],
  KEYWORD: ["COMPANY_WEBSITE"],
  ICP_TOP: ["COMPANY_SEARCH"],
  WEBSITE_SIGNAL: ["COMPANY_WEBSITE"],
};

export const NO_LAWFUL_SOURCE =
  "No free, lawful source can supply this signal, so it is not offered.";

export type SignalAvailability = { available: boolean; needs: string | null };

/** Whether a kind can run with the feeds this workspace has live, and if not, why. */
export function signalAvailability(
  kind: SignalKind,
  live: ReadonlySet<SignalFeed>,
): SignalAvailability {
  const feeds = SIGNAL_KIND_FEEDS[kind];
  if (feeds.length === 0) return { available: false, needs: NO_LAWFUL_SOURCE };
  if (feeds.some((feed) => live.has(feed))) return { available: true, needs: null };
  return { available: false, needs: SIGNAL_FEED_NEEDS[feeds[0]] };
}

/** The feeds live for a workspace, from which providers report configured. */
export function liveFeeds(configuredProviderKeys: Iterable<string>): Set<SignalFeed> {
  const configured = new Set(configuredProviderKeys);
  return new Set(
    SIGNAL_FEEDS.filter((feed) => SIGNAL_FEED_PROVIDERS[feed].some((key) => configured.has(key))),
  );
}

/**
 * What kind of signal a plan represents.
 *
 * Derived from the plan rather than asked for: the customer described a
 * target, and this is the label that best describes what the resulting search
 * looks for. The most specific request wins; ICP_TOP is what a plan with no
 * distinguishing feature genuinely is.
 */
export function signalKindForPlan(plan: SearchPlan): SignalKind {
  const { signals } = plan;
  if (signals.fundingFilings) return "FUNDING";
  if (signals.hiringRoles.length > 0) return "HIRING";
  if (signals.leadershipChanges) return "JOB_CHANGE";
  if (signals.technologies.length > 0) return "WEBSITE_SIGNAL";
  const typed = [...signals.intentTypes, ...segmentTypes(plan.segment)];
  if (typed.length > 0) {
    const group = intentType(typed[0]).group;
    if (group === "FUNDING") return "FUNDING";
    if (group === "HIRING") return "HIRING";
    if (group === "PEOPLE") return "JOB_CHANGE";
    return "WEBSITE_SIGNAL";
  }
  if (plan.intent.categories.length > 0) return "KEYWORD";
  return "ICP_TOP";
}

/**
 * The structured evidence a plan asks the intent stage to fetch, beyond the
 * keyword categories it names. Each maps to one free feed.
 */
export function requestedEvidenceKinds(plan: SearchPlan): IntentEvidenceKind[] {
  const { signals } = plan;
  const kinds: IntentEvidenceKind[] = [];
  if (signals.fundingFilings) kinds.push("FUNDING");
  if (signals.hiringRoles.length > 0) kinds.push("HIRING");
  if (signals.leadershipChanges) kinds.push("JOB_CHANGE");
  if (signals.recentlyIncorporated) kinds.push("NEW_COMPANY");
  if (signals.officeMoves) kinds.push("EXPANSION");
  if (signals.technologies.length > 0) kinds.push("TECHNOLOGY");
  for (const id of [...signals.intentTypes, ...segmentTypes(plan.segment)]) {
    const entry = intentType(id);
    if (entry.sources.length > 0 && !kinds.includes(entry.evidenceKind)) kinds.push(entry.evidenceKind);
  }
  return kinds;
}

/** The feed that produces each evidence kind. */
export const EVIDENCE_KIND_FEED: Record<IntentEvidenceKind, SignalFeed> = {
  FUNDING: "COMPANIES_HOUSE",
  JOB_CHANGE: "COMPANIES_HOUSE",
  NEW_COMPANY: "COMPANIES_HOUSE",
  EXPANSION: "COMPANIES_HOUSE",
  HIRING: "COMPANY_WEBSITE",
  TECHNOLOGY: "COMPANY_WEBSITE",
  WEBSITE_MENTION: "COMPANY_WEBSITE",
  GROWTH: "COMPANY_WEBSITE",
  TRIGGER_EVENT: "COMPANIES_HOUSE",
};

/**
 * How a signal is doing, as one word plus a reason.
 *
 * Deliberately three states rather than a number. "47 leads" means nothing
 * without knowing whether that is a week's work or a morning's; what a person
 * needs is whether to leave it alone, look at it, or turn it off.
 */
export type SignalHealth = {
  tone: "healthy" | "quiet" | "idle";
  label: string;
  detail: string;
};

/** A signal that has produced nothing in this many days is not working. */
const QUIET_AFTER_DAYS = 14;

export function signalHealth(signal: Signal, now: Date = new Date()): SignalHealth {
  if (!signal.active) {
    return {
      tone: "idle",
      label: "Paused",
      detail: "This signal is switched off and is not being run.",
    };
  }

  if (signal.leadsFoundThisWeek > 0) {
    return {
      tone: "healthy",
      label: "Producing",
      detail: `${signal.leadsFoundThisWeek} new lead${signal.leadsFoundThisWeek === 1 ? "" : "s"} this week.`,
    };
  }

  // Never run is not the same as run and found nothing, and telling somebody
  // their brand-new signal is unproductive would be simply wrong.
  if (!signal.lastRunAt) {
    return {
      tone: "idle",
      label: "Not run yet",
      detail: "This signal has not run yet. It will on the next scheduled pass.",
    };
  }

  const ageDays = (now.getTime() - new Date(signal.lastRunAt).getTime()) / 86_400_000;

  if (signal.leadsFound === 0 && ageDays >= QUIET_AFTER_DAYS) {
    return {
      tone: "quiet",
      label: "Nothing found",
      detail:
        signal.lastResult ??
        `Running for ${Math.round(ageDays)} days without finding anyone. Worth narrowing or turning off.`,
    };
  }

  return {
    tone: "quiet",
    label: "Quiet",
    detail:
      signal.lastResult ?? "Nothing new this week, but it has produced leads before.",
  };
}

/**
 * When the signal next runs, in words.
 *
 * Returns null rather than "unknown" when nothing is scheduled: a row with no
 * next run is one the customer should be able to launch by hand, and the button
 * says that better than a label would.
 */
export function nextRunLabel(nextRunAt: string | null, now: Date = new Date()): string | null {
  if (!nextRunAt) return null;

  const ms = new Date(nextRunAt).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "due now";

  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Everything the intent stage should fetch for a plan: the structured kinds
 * it asked for, plus those its named categories collect (a "New funding"
 * category fetches register allotments without a separate toggle).
 *
 * A HIRING category's keywords are the roles to look for, and a TECHNOLOGY
 * category's keywords name technologies to fingerprint.
 */
export function intentWantsFor(
  plan: SearchPlan,
  categories: CategoryShape[],
): {
  kinds: IntentEvidenceKind[];
  hiringRoles: string[];
  technologies: TechnologyKey[];
  types: IntentTypeId[];
  roleFunctions: RoleFunction[];
} {
  const kinds = new Set<IntentEvidenceKind>(requestedEvidenceKinds(plan));
  const roles = new Set(plan.signals.hiringRoles);
  const technologies = new Set<TechnologyKey>(plan.signals.technologies);

  // Catalogue types: named on the plan, used by its segment, or named by a
  // category (a category started from the catalogue). The legacy toggles stay
  // kinds, which the register adapter reads as before, so an older plan
  // fetches exactly what it always did.
  const types = new Set<IntentTypeId>([...plan.signals.intentTypes, ...segmentTypes(plan.segment)]);
  for (const category of categories) intentTypesForCategory(category).forEach((id) => types.add(id));

  // Role functions narrow role-carrying types only when every one of them is
  // narrowed: one un-narrowed hiring condition wants every function.
  const functions = new Set<RoleFunction>(plan.signals.roleFunctions);
  let unnarrowed = plan.signals.roleFunctions.length === 0 &&
    plan.signals.intentTypes.some((id) => intentType(id).hasRoleFunction);
  for (const condition of plan.segment?.conditions ?? []) {
    const roleTypes = condition.types.some((id) => intentType(id).hasRoleFunction);
    if (!roleTypes) continue;
    if (condition.roleFunction) functions.add(condition.roleFunction);
    else unnarrowed = true;
  }
  if (categories.some((category) => intentTypesForCategory(category).some((id) => intentType(id).hasRoleFunction))) {
    unnarrowed = true;
  }

  for (const category of categories) {
    for (const kind of kindsForCategory(category)) {
      if (kind === "WEBSITE_MENTION") continue;
      if (kind === "HIRING") {
        category.keywords.forEach((keyword) => roles.add(keyword));
        if (roles.size === 0) continue;
      }
      if (kind === "TECHNOLOGY") {
        const text = [category.name, ...category.keywords].join(" ").toLowerCase();
        const named = TECH_FINGERPRINTS.filter(
          (entry) => text.includes(entry.label.toLowerCase().split(" ")[0]) || text.includes(entry.key.toLowerCase()),
        );
        named.forEach((entry) => technologies.add(entry.key));
        if (named.length === 0) continue;
      }
      kinds.add(kind);
    }
  }

  for (const id of types) {
    const entry = intentType(id);
    if (entry.sources.length > 0) kinds.add(entry.evidenceKind);
  }

  return {
    kinds: INTENT_EVIDENCE_KINDS.filter((kind) => kinds.has(kind)),
    hiringRoles: [...roles].slice(0, 20),
    technologies: [...technologies],
    types: [...types].filter((id) => intentType(id).sources.length > 0),
    roleFunctions: unnarrowed ? [] : [...functions],
  };
}
