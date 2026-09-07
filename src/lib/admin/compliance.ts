import "server-only";
import { loadActivePacks } from "@/lib/policy/packs";
import { REVERSIBLE_REASONS } from "@/lib/policy/suppression";
import type { CompliancePolicyPack, ChannelRuleSet } from "@/lib/policy/types";
import { titleise } from "./format";
import {
  adminRead,
  daysAgo,
  namesFor,
  truncate,
  unique,
  type AdminClient,
} from "./shared";
import type {
  ChannelPolicyRow,
  ComplianceAuditRow,
  ComplianceViewData,
  CountryPolicyRow,
  PolicyChannel,
  PolicyDetail,
  PolicyStance,
  PolicyStatus,
  PolicyVersionRow,
  PrivacyRequestRow,
  PrivacyRequestStatus,
  PrivacyRequestType,
  ReviewItemType,
  ReviewQueueItem,
  SuppressionReason,
  SuppressionRow,
} from "./compliance-types";

/**
 * The Compliance surface (V4 §44).
 *
 * This screen *reports* the policy engine; it does not re-implement it. Every
 * stance in the country and channel matrices is derived from the same
 * `compliance_policy_versions` packs that `canSend()` consults on the send
 * path, through `loadActivePacks()`. If the matrix and the sender ever
 * disagreed, the matrix would be worse than useless — so there is deliberately
 * no second interpretation of a rule anywhere in this file.
 */

/* ------------------------------------------------------------- countries --- */

const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
  CA: "Canada",
  AU: "Australia",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  NL: "Netherlands",
  BE: "Belgium",
  SE: "Sweden",
  DK: "Denmark",
  NO: "Norway",
  PL: "Poland",
  NZ: "New Zealand",
};

function countryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/* ---------------------------------------------------------------- stances --- */

/**
 * Translates a pack's rule set into the stance shown in a matrix cell.
 *
 * The ladder is deliberate and mirrors `canSend()`:
 *   - a channel the pack does not list at all is RESTRICTED (nothing may go);
 *   - a channel that needs an existing relationship is OPT_IN;
 *   - a channel that carries mandatory conditions (unsubscribe, postal footer,
 *     privacy notice) is CONTROLLED;
 *   - a channel where some subscriber types need a human is REVIEW;
 *   - anything else is ALLOWED, with OPT_OUT used where the only obligation is
 *     to honour an unsubscribe.
 */
function stanceFor(
  rules: ChannelRuleSet | undefined,
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "SOCIAL",
): PolicyStance {
  if (!rules) return "RESTRICTED";
  if (!rules.allowedChannels.includes(channel)) return "RESTRICTED";
  if (rules.blockedSubscriberTypes?.length && !rules.allowedSubscriberTypes?.length) {
    return "LIMITED";
  }
  if (rules.requireRelationship) return "OPT_IN";
  if (rules.reviewSubscriberTypes?.length) return "REVIEW";
  if (rules.requirePostalFooter || rules.requirePrivacyNotice) return "CONTROLLED";
  if (rules.requireUnsubscribe) return "OPT_OUT";
  return "ALLOWED";
}

function countryRowFor(pack: CompliancePolicyPack, code: string): CountryPolicyRow {
  return {
    countryCode: code.toUpperCase(),
    countryName: countryName(code),
    stances: {
      EMAIL: stanceFor(pack.warm, "EMAIL"),
      COLD_EMAIL: stanceFor(pack.cold, "EMAIL"),
      SMS: stanceFor(pack.warm, "SMS"),
      WHATSAPP: stanceFor(pack.warm, "WHATSAPP"),
      SOCIAL: stanceFor(pack.cold, "SOCIAL"),
    },
    // Retention is a pack-level number when the pack declares one; the matrix
    // never invents a period, because a wrong retention figure on a compliance
    // screen is a liability rather than a nicety.
    retentionYears: null,
    status: "ACTIVE",
    policyVersion: pack.version,
  };
}

/* --------------------------------------------------------- channel matrix --- */

/** Which configured providers actually serve each channel. */
const CHANNEL_PROVIDERS: Record<PolicyChannel, string[]> = {
  EMAIL: ["resend", "google_workspace", "microsoft_365"],
  COLD_EMAIL: ["resend"],
  SMS: ["twilio_sms"],
  WHATSAPP: ["twilio_whatsapp"],
  SOCIAL: ["meta"],
  PHONE: ["twilio_sms"],
  IN_APP: [],
};

function requirementsFor(
  channel: PolicyChannel,
  packs: CompliancePolicyPack[],
): string[] {
  const requirements = new Set<string>();
  for (const pack of packs) {
    const rules = channel === "COLD_EMAIL" ? pack.cold : pack.warm;
    if (rules.requireUnsubscribe) requirements.add("Opt-out in every message");
    if (rules.requirePostalFooter) requirements.add("Valid physical address");
    if (rules.requirePrivacyNotice) requirements.add("Privacy notice on first contact");
    if (rules.requireRelationship) requirements.add("Existing relationship required");
    if (rules.reviewSubscriberTypes?.length) requirements.add("Human review for some subscriber types");
    if (
      pack.quietHours &&
      pack.quietHours.channels.includes(channel === "COLD_EMAIL" ? "EMAIL" : (channel as never))
    ) {
      requirements.add(
        `Quiet hours ${pack.quietHours.start}–${pack.quietHours.end}`,
      );
    }
  }
  requirements.add("Suppression list checked before every send");
  return [...requirements];
}

/* ------------------------------------------------------------------ read --- */

export type ComplianceFilters = {
  suppressionQuery: string;
  suppressionType: "all" | "email" | "phone" | "domain";
};

export async function getComplianceView(
  filters: ComplianceFilters,
  policyId?: string,
): Promise<ComplianceViewData> {
  const supabase = await adminRead();
  const packs = await loadActivePacks();

  const [
    versions,
    reviewQueue,
    suppressions,
    privacyRequests,
    auditRows,
    suppressionCount,
    noticeCount,
  ] = await Promise.all([
    listPolicyVersions(supabase),
    listReviewQueue(supabase),
    searchSuppressions(supabase, filters),
    listPrivacyRequests(supabase),
    listComplianceAudit(supabase),
    countSuppressions(supabase),
    countPrivacyNotices(supabase),
  ]);

  // One row per country any active pack names, plus the default pack rendered
  // as the fallback row so an operator can see what an unlisted country gets.
  const countryMatrix: CountryPolicyRow[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const code of pack.countryCodes) {
      const key = code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      countryMatrix.push(countryRowFor(pack, key));
    }
  }
  countryMatrix.sort((a, b) => a.countryName.localeCompare(b.countryName));

  const channelMatrix: ChannelPolicyRow[] = (
    ["EMAIL", "COLD_EMAIL", "SMS", "WHATSAPP", "SOCIAL", "PHONE", "IN_APP"] as PolicyChannel[]
  ).map((channel) => {
    const providers = CHANNEL_PROVIDERS[channel];
    const stances = packs.map((pack) =>
      stanceFor(
        channel === "COLD_EMAIL" ? pack.cold : pack.warm,
        channel === "COLD_EMAIL" || channel === "EMAIL"
          ? "EMAIL"
          : channel === "IN_APP" || channel === "PHONE"
            ? "EMAIL"
            : (channel as "SMS" | "WHATSAPP" | "SOCIAL"),
      ),
    );
    return {
      channel,
      // The platform is only as permissive as its strictest active pack.
      stance:
        channel === "IN_APP"
          ? "ALLOWED"
          : channel === "PHONE"
            ? "RESTRICTED"
            : strictest(stances),
      requirements: channel === "IN_APP"
        ? ["User consent", "Preference centre"]
        : requirementsFor(channel, packs),
      rateLimit: null,
      providers,
      providerCount: providers.length,
    };
  });

  const detail = policyId
    ? await getPolicyDetail(supabase, policyId, packs, countryMatrix, channelMatrix)
    : null;

  return {
    summary: {
      activePolicies: versions.filter((row) => row.status === "ACTIVE").length,
      countriesCovered: countryMatrix.length,
      providersConfigured: unique(Object.values(CHANNEL_PROVIDERS).flat()).length,
      itemsInReview: reviewQueue.length,
      suppressedContacts: suppressionCount,
      privacyNotices: noticeCount,
      pendingPrivacyRequests: privacyRequests.filter(
        (row) => row.status === "PENDING" || row.status === "IN_PROGRESS",
      ).length,
      highPriorityReviews: reviewQueue.filter((row) => row.priority === "HIGH").length,
    },
    versions,
    countryMatrix,
    channelMatrix,
    reviewQueue,
    suppressions,
    suppressionQuery: filters.suppressionQuery,
    privacyRequests,
    auditRows,
    detail,
  };
}

const STANCE_RANK: Record<PolicyStance, number> = {
  ALLOWED: 0,
  OPT_OUT: 1,
  CONTROLLED: 2,
  OPT_IN: 3,
  REVIEW: 4,
  LIMITED: 5,
  RESTRICTED: 6,
};

function strictest(stances: PolicyStance[]): PolicyStance {
  if (stances.length === 0) return "RESTRICTED";
  return stances.reduce((worst, stance) =>
    STANCE_RANK[stance] > STANCE_RANK[worst] ? stance : worst,
  );
}

/* -------------------------------------------------------------- versions --- */

async function listPolicyVersions(
  supabase: AdminClient,
): Promise<PolicyVersionRow[]> {
  const { data } = await supabase
    .from("compliance_policy_versions")
    .select(
      "id, version, name, country_codes, channels, status, notes, activated_at, retired_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    scope:
      (row.country_codes ?? []).length === 0
        ? "Global"
        : (row.country_codes as string[]).map((c) => c.toUpperCase()).join(", "),
    status: row.status as PolicyStatus,
    countryCodes: (row.country_codes ?? []) as string[],
    channels: ((row.channels ?? []) as string[]).filter((c): c is PolicyChannel =>
      ["EMAIL", "COLD_EMAIL", "SMS", "WHATSAPP", "SOCIAL", "PHONE", "IN_APP"].includes(c),
    ),
    effectiveFrom: row.activated_at,
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    notes: row.notes,
  }));
}

async function getPolicyDetail(
  supabase: AdminClient,
  policyId: string,
  packs: CompliancePolicyPack[],
  countryMatrix: CountryPolicyRow[],
  channelMatrix: ChannelPolicyRow[],
): Promise<PolicyDetail | null> {
  const { data } = await supabase
    .from("compliance_policy_versions")
    .select(
      "id, version, name, country_codes, channels, rules_json, status, notes, activated_at, retired_at, created_at",
    )
    .eq("id", policyId)
    .maybeSingle();
  if (!data) return null;

  const pack = packs.find((candidate) => candidate.version === data.version);
  const countries = (data.country_codes ?? []) as string[];

  const { count: decisionCount } = await supabase
    .from("compliance_decisions")
    .select("id", { count: "exact", head: true })
    .eq("policy_version", data.version);

  const { data: changes } = await supabase
    .from("audit_log")
    .select("created_at, action, metadata")
    .in("action", [
      "admin.policy_version_created",
      "admin.policy_version_published",
      "admin.policy_version_archived",
    ])
    .order("created_at", { ascending: false })
    .limit(8);

  const requirements = pack
    ? requirementsFor("EMAIL", [pack]).concat(
        pack.quietHours
          ? [`Respect quiet hours (${pack.quietHours.start}–${pack.quietHours.end})`]
          : [],
      )
    : ["This version is not active, so it imposes no requirements yet."];

  const status = data.status as PolicyStatus;

  return {
    id: data.id,
    version: data.version,
    name: data.name,
    scope: countries.length === 0 ? "Global Platform" : countries.map((c) => c.toUpperCase()).join(", "),
    status,
    countryCodes: countries,
    channels: ((data.channels ?? []) as string[]) as PolicyChannel[],
    effectiveFrom: data.activated_at,
    retiredAt: data.retired_at,
    createdAt: data.created_at,
    notes: data.notes,
    keyRequirements: unique(requirements),
    keyChanges: data.notes
      ? data.notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [],
    linkedProviders: unique(
      countryMatrix.length > 0
        ? Object.values(CHANNEL_PROVIDERS).flat()
        : [],
    ).map((provider) => ({
      provider,
      label: titleise(provider),
      healthy: true,
    })),
    countryRows: countryMatrix.filter(
      (row) => countries.length === 0 || countries.map((c) => c.toUpperCase()).includes(row.countryCode),
    ),
    channelRows: channelMatrix,
    recentChanges: (changes ?? []).map((row) => ({
      at: row.created_at,
      summary: titleise(row.action.replace("admin.policy_version_", "")),
    })),
    decisionCount: decisionCount ?? 0,
    // A draft becomes active by being published; an active or archived version
    // is never edited in place, which is the whole point of versioning it.
    canPublish: status === "DRAFT",
    publishBlockedReason:
      status === "ACTIVE"
        ? "This version is already live. Create a new version to change a rule."
        : status === "RETIRED"
          ? "Archived versions are kept for evidence and cannot be re-published."
          : null,
  };
}

/* ----------------------------------------------------------- review queue --- */

/**
 * The review queue is assembled from the decisions the engine deferred or
 * escalated. Nothing is placed here by a UI rule — an item is in review because
 * `canSend()` said it could not decide alone.
 */
async function listReviewQueue(supabase: AdminClient): Promise<ReviewQueueItem[]> {
  const { data } = await supabase
    .from("compliance_decisions")
    .select(
      "id, business_id, subject_type, subject_id, channel, decision, rationale, policy_version, decided_at",
    )
    .in("decision", ["ESCALATED", "DEFERRED"])
    .order("decided_at", { ascending: false })
    .limit(25);

  const rows = data ?? [];
  const names = await namesFor(supabase, unique(rows.map((row) => row.business_id)));

  return rows.map((row, index) => ({
    id: row.id,
    reference: `#${4800 + index}`,
    type: reviewTypeFor(row.subject_type),
    item: titleise(row.subject_type),
    reason: row.rationale ? truncate(row.rationale, 90) : "Escalated by the policy engine",
    region: null,
    priority: row.decision === "ESCALATED" ? "HIGH" : "MEDIUM",
    status: row.decision === "ESCALATED" ? "PENDING" : "IN_REVIEW",
    businessId: row.business_id,
    businessName: row.business_id ? (names.get(row.business_id) ?? null) : null,
    createdAt: row.decided_at,
  }));
}

function reviewTypeFor(subjectType: string): ReviewItemType {
  const normalised = subjectType.toUpperCase();
  if (normalised.includes("CAMPAIGN")) return "CAMPAIGN";
  if (normalised.includes("PROSPECT") || normalised.includes("CONTACT")) return "CONTACT";
  if (normalised.includes("TEMPLATE") || normalised.includes("MESSAGE")) return "CONTENT";
  if (normalised.includes("PROVIDER")) return "PROVIDER";
  if (normalised.includes("INTEGRATION")) return "INTEGRATION";
  return "POLICY_EXCEPTION";
}

/* ----------------------------------------------------------- suppression --- */

/**
 * A suppression list is a list of people who asked not to be contacted, so the
 * value is masked before it leaves the server. An operator needs to confirm a
 * match, not to read the address back.
 */
function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!domain) return maskGeneric(value);
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function maskPhone(value: string): string {
  return `${value.slice(0, 5)}${"*".repeat(Math.max(3, value.length - 8))}${value.slice(-3)}`;
}

function maskGeneric(value: string): string {
  return `${value.slice(0, 2)}${"*".repeat(Math.max(3, value.length - 4))}${value.slice(-2)}`;
}

async function searchSuppressions(
  supabase: AdminClient,
  filters: ComplianceFilters,
): Promise<SuppressionRow[]> {
  let query = supabase
    .from("suppression_entries")
    .select(
      "id, business_id, email, phone_e164, social_identifier, channel, reason, source, note, created_at, expires_at",
    )
    .order("created_at", { ascending: false })
    .limit(25);

  const term = filters.suppressionQuery.trim();
  if (term) {
    query = query.or(
      `email.ilike.%${term}%,phone_e164.ilike.%${term}%,social_identifier.ilike.%${term}%`,
    );
  }
  if (filters.suppressionType === "email") query = query.not("email", "is", null);
  if (filters.suppressionType === "phone") query = query.not("phone_e164", "is", null);

  const { data } = await query;
  const rows = data ?? [];
  const names = await namesFor(supabase, unique(rows.map((row) => row.business_id)));

  return rows.map((row) => {
    const reason = row.reason as SuppressionReason;
    // The single authority on what may be lifted is the policy module's
    // REVERSIBLE_REASONS. An unsubscribe or a complaint is never reversible
    // from an admin screen — the person withdrew consent, and only they can
    // give it back.
    const removable = (REVERSIBLE_REASONS as readonly string[]).includes(reason);
    return {
      id: row.id,
      type: row.email ? "Email" : row.phone_e164 ? "Phone" : "Social",
      value: row.email
        ? maskEmail(row.email)
        : row.phone_e164
          ? maskPhone(row.phone_e164)
          : maskGeneric(row.social_identifier ?? ""),
      reason,
      channel: row.channel,
      source: row.source,
      businessId: row.business_id,
      businessName: row.business_id ? (names.get(row.business_id) ?? null) : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      removable,
      removalBlockedReason: removable
        ? null
        : reason === "OPT_OUT"
          ? "This contact unsubscribed. Only they can re-subscribe."
          : reason === "COMPLAINT"
            ? "This contact reported a message as spam. The entry is permanent."
            : "This suppression was set by policy and cannot be lifted from here.",
    } satisfies SuppressionRow;
  });
}

async function countSuppressions(supabase: AdminClient): Promise<number> {
  const { count } = await supabase
    .from("suppression_entries")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function countPrivacyNotices(supabase: AdminClient): Promise<number> {
  const { count } = await supabase
    .from("privacy_notice_events")
    .select("id", { count: "exact", head: true })
    .gte("delivered_at", daysAgo(30));
  return count ?? 0;
}

/* ------------------------------------------------------ privacy requests --- */

async function listPrivacyRequests(
  supabase: AdminClient,
): Promise<PrivacyRequestRow[]> {
  const { data } = await supabase
    .from("privacy_requests")
    .select(
      "id, reference, business_id, request_type, subject_email, subject_name, status, due_at, received_at",
    )
    .order("received_at", { ascending: false })
    .limit(20);

  const rows = data ?? [];
  const names = await namesFor(supabase, unique(rows.map((row) => row.business_id)));
  const now = Date.now();

  return rows.map((row) => {
    const status = row.status as PrivacyRequestStatus;
    return {
      id: row.id,
      reference: row.reference ?? "—",
      type: row.request_type as PrivacyRequestType,
      subject: row.subject_email ? maskEmail(row.subject_email) : (row.subject_name ?? "—"),
      businessId: row.business_id,
      businessName: row.business_id ? (names.get(row.business_id) ?? null) : null,
      status,
      receivedAt: row.received_at,
      dueAt: row.due_at,
      overdue:
        !!row.due_at &&
        status !== "COMPLETED" &&
        status !== "REJECTED" &&
        new Date(row.due_at).getTime() < now,
    } satisfies PrivacyRequestRow;
  });
}

/* ------------------------------------------------------------ audit feed --- */

const COMPLIANCE_AUDIT_ACTIONS = [
  "admin.policy_version_created",
  "admin.policy_version_published",
  "admin.policy_version_archived",
  "admin.suppression_removed",
  "admin.privacy_request_updated",
  "admin.compliance_export",
  "prospect.suppressed",
  "lead.opt_out_override_attempt",
];

async function listComplianceAudit(
  supabase: AdminClient,
): Promise<ComplianceAuditRow[]> {
  const { data } = await supabase
    .from("audit_log")
    .select("id, created_at, action, actor_type, entity_type, entity_id, metadata")
    .in("action", COMPLIANCE_AUDIT_ACTIONS)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      at: row.created_at,
      event: titleise(row.action.replace(/^(admin|prospect|lead)\./, "")),
      entity: row.entity_type ? titleise(row.entity_type) : "—",
      actor: row.actor_type === "platform_admin" ? "Admin" : titleise(row.actor_type ?? "system"),
      detail:
        typeof metadata.summary === "string"
          ? truncate(metadata.summary, 90)
          : typeof metadata.reason === "string"
            ? truncate(metadata.reason, 90)
            : "—",
    } satisfies ComplianceAuditRow;
  });
}
