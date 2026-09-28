/**
 * Settings shapes and pure display helpers. Deliberately free of `server-only`
 * and of any Supabase import so client components can use these without
 * dragging the service-role client into the browser bundle.
 */

/** Mirrors the membership roles in the database; kept local so this module
 *  never reaches into a server-only import. */
export type BusinessRole = "owner" | "admin" | "member" | "viewer";

/**
 * The Settings sections. Settings is one route with a `?section=` query, so
 * every configuration surface stays in one place.
 *
 * Business Profile joined in V4: it holds what ClientTurn believes about the
 * business, plus the ICPs and conversion goals that Find Leads, agents and
 * intent monitors all target.
 */
export const SETTINGS_SECTIONS = [
  {
    id: "workspace",
    label: "Workspace",
    description: "Business info, services, hours",
  },
  {
    id: "connections",
    label: "Connections",
    description: "Integrations & syncing",
  },
  {
    id: "business-profile",
    label: "Business Profile",
    description: "What we know, ICPs and goals",
  },
  {
    id: "ai-selling",
    label: "AI & selling",
    description: "Strategy, budgets, brand and compliance",
  },
  {
    // Quote-to-cash (P2): catalogue, VAT, numbering, terms, signatures,
    // approvals and payment. A Settings section, not a new destination (V3).
    id: "quotes",
    label: "Quotes & invoices",
    description: "Catalogue, VAT, terms and payment",
  },
  {
    // AI voice calling (P2): identity, number, agent, hours, minutes. A
    // Settings section, not a new destination (V3).
    id: "voice",
    label: "Voice",
    description: "AI calls, number and minutes",
  },
  { id: "team", label: "Team", description: "Manage your team" },
  {
    id: "developer",
    label: "Developer",
    description: "API keys, webhooks and assistants",
  },
  {
    id: "data-controls",
    label: "Data Controls",
    description: "Compliance, sources and retention",
  },
  {
    id: "billing",
    label: "Billing & Usage",
    description: "Plan, usage and invoices",
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

const SECTION_IDS = SETTINGS_SECTIONS.map((section) => section.id) as string[];

/** Never trust the query string: anything unrecognised lands on Workspace. */
export function parseSettingsSection(value: unknown): SettingsSection {
  return typeof value === "string" && SECTION_IDS.includes(value)
    ? (value as SettingsSection)
    : "workspace";
}

export const ROLE_LABELS: Record<BusinessRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

/**
 * The one description of each role, used by the Roles card and the invite
 * dialog. Kept in step with what is enforced: billing, workspace export and
 * deletion, managing admins and transferring ownership are owner-only
 * (`requireRole("owner")`, src/lib/team/rules.ts); settings writes need an
 * owner or admin; working leads needs a member.
 */
export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  owner:
    "Full access, including billing, exporting or deleting the workspace, and managing admins. Can transfer ownership.",
  admin:
    "Changes settings and manages members and viewers. No billing, workspace export or deletion, and cannot manage other admins.",
  member: "Works leads, conversations and campaigns. Cannot change workspace settings.",
  viewer: "Read-only access to leads and reporting.",
};

/** Roles that can be assigned or invited. Ownership only moves by transfer. */
export const ASSIGNABLE_ROLES: BusinessRole[] = ["admin", "member", "viewer"];

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  invited: "Invited",
  suspended: "Suspended",
  removed: "Removed",
};

/**
 * The industry choices offered in onboarding and Workspace settings, B2B first
 * to match the ICP (UK agencies, studios, SaaS, ecommerce and professional
 * services; CLAUDE.md resolved conflict 5).
 *
 * `archetypeKey` names the sales-library archetype each choice corresponds to
 * (all DEEP archetypes in src/lib/sales-library/archetypes.ts). It is a hint
 * for the AI & selling classification, not a write: the onboarding save stores
 * the label in `businesses.industry` only, and a person confirms the archetype
 * under Settings -> AI & selling.
 *
 * `industry` is free text in the database, so a value from an earlier list
 * (see `LEGACY_INDUSTRIES`) stays valid and is still offered to that workspace.
 */
export const INDUSTRY_OPTIONS = [
  { label: "Marketing agency", archetypeKey: "MARKETING_AGENCY" },
  { label: "Advertising / paid media agency", archetypeKey: "ADVERTISING_AGENCY" },
  { label: "SEO agency", archetypeKey: "SEO_AGENCY" },
  { label: "Web / design studio", archetypeKey: "CREATIVE_WEB_STUDIO" },
  { label: "B2B SaaS", archetypeKey: "B2B_SAAS" },
  { label: "Product-led SaaS", archetypeKey: "PLG_SAAS" },
  { label: "Enterprise software", archetypeKey: "ENTERPRISE_SAAS" },
  { label: "Ecommerce brand", archetypeKey: "ECOMMERCE" },
  { label: "Subscription ecommerce", archetypeKey: "SUBSCRIPTION_ECOMMERCE" },
  { label: "Managed IT services (MSP)", archetypeKey: "MSP" },
  { label: "IT consultancy", archetypeKey: "IT_CONSULTANCY" },
  { label: "Cybersecurity", archetypeKey: "CYBERSECURITY" },
  { label: "Management consultancy", archetypeKey: "MANAGEMENT_CONSULTING" },
  { label: "Accountancy practice", archetypeKey: "ACCOUNTING" },
  { label: "Bookkeeping", archetypeKey: "BOOKKEEPING" },
  { label: "Law firm", archetypeKey: "LAW_FIRM" },
  { label: "Recruitment agency", archetypeKey: "RECRUITMENT" },
  { label: "Other", archetypeKey: null },
] as const satisfies readonly { label: string; archetypeKey: string | null }[];

export const INDUSTRIES = INDUSTRY_OPTIONS.map((option) => option.label);

/**
 * Industries an earlier version offered (home services). No longer offered to
 * new workspaces, but a workspace that saved one keeps it: saving settings must
 * never fail, or silently change the industry, because the list moved on.
 */
export const LEGACY_INDUSTRIES = [
  "Roofing",
  "Windows & doors",
  "Kitchens & bathrooms",
  "Driveways & landscaping",
  "Heating & plumbing",
  "Electrical",
  "Solar & renewables",
  "Damp & insulation",
  "Cleaning",
  "Other home services",
] as const;

/**
 * Whether an industry value may be saved: blank, a current option, a legacy
 * option, or the value the workspace already has.
 */
export function isAcceptedIndustry(value: string | null | undefined, current?: string | null): boolean {
  if (!value) return true;
  if (current && value === current) return true;
  return (
    (INDUSTRIES as readonly string[]).includes(value) ||
    (LEGACY_INDUSTRIES as readonly string[]).includes(value)
  );
}

/** The options a select should show: the current list, plus the saved value if it is not in it. */
export function industryOptionsFor(current: string | null | undefined): string[] {
  const options: string[] = [...INDUSTRIES];
  if (current && !options.includes(current)) options.push(current);
  return options;
}

/** The sales-library archetype an industry choice suggests, or null. */
export function archetypeKeyForIndustry(industry: string | null | undefined): string | null {
  return INDUSTRY_OPTIONS.find((option) => option.label === industry)?.archetypeKey ?? null;
}

/**
 * The full IANA list (./timezones.ts). It was six European zones, which left
 * any workspace -- or any prospect list -- outside them with a wrong quiet-
 * hours clock and no way to fix it.
 */
export { TIMEZONES, isTimezone, type Timezone } from "./timezones.ts";

/**
 * IANA identifiers are what gets stored; this is only how they read in a
 * select. The offset is computed rather than hard-coded so it stays correct
 * across daylight saving.
 */
export function timezoneLabel(zone: string, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(now);
    const offset =
      parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
    const city =
      zone === "UTC"
        ? "Coordinated Universal Time"
        : zone.split("/").slice(1).join(" / ").replace(/_/g, " ") || zone;
    // Chromium writes a zero offset as bare "GMT", Node as "GMT+00:00"; the
    // label is rendered on both, so they must agree or hydration fails.
    return `(${offset === "GMT" ? "GMT+00:00" : offset}) ${city}`;
  } catch {
    return zone;
  }
}

export const BOOKING_MODES = [
  {
    value: "calendly",
    label: "Calendly",
    description: "Qualified leads receive your Calendly link.",
  },
  {
    value: "google_calendar",
    label: "Google Calendar",
    description: "Qualified leads are offered slots from your calendar.",
  },
  {
    value: "handover",
    label: "Manual link or handover",
    description:
      "Qualified leads receive the link you set below, or are handed to you to book by hand.",
  },
] as const;

export type BookingMode = (typeof BOOKING_MODES)[number]["value"];

export const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

export type BusinessProfile = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  timezone: string;
  logoKey: string | null;
  logoUrl: string | null;
};

export type MessagingSettings = {
  defaultChannel: string;
  fallbackChannel: string | null;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  messageSignature: string | null;
  optOutWording: string;
  serviceAreaDescription: string | null;
  businessHours: BusinessHours;
  slackConnected: boolean;
  slackChannelId: string | null;
  slackNotifyNewLead: boolean;
  slackNotifyHandover: boolean;
  slackNotifyBooking: boolean;
  slackNotifyWarmProspect: boolean;
  slackDigestEnabled: boolean;
};

export type BookingSettings = {
  bookingMode: string;
  bookingUrl: string | null;
  appointmentDurationMinutes: number;
  bookingBufferMinutes: number;
  calendlyConnected: boolean;
  googleCalendarConnected: boolean;
  /** The Calendly event type times are offered from, when one is chosen. */
  calendlyEventTypeUri: string | null;
};

export type TeamMemberRow = {
  membershipId: string;
  userId: string | null;
  name: string;
  email: string;
  role: BusinessRole;
  status: string;
  invitedAt: string | null;
  createdAt: string;
  /** When they actually joined: acceptance date, falling back to the invite. */
  joinedAt: string;
};

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  averageValue: number | null;
  active: boolean;
  position: number;
  pricingVisibility: PricingVisibility;
  publicPriceText: string | null;
};

/**
 * What a lead may be told about a service's price (services.pricing_visibility,
 * 00241). Only the two PUBLIC_* values ever let price wording reach a lead,
 * and then only the exact `public_price_text` the workspace wrote.
 */
export const PRICING_VISIBILITY_OPTIONS = [
  {
    value: "QUOTE_REQUIRED",
    label: "Quote required",
    description: "Leads are told the price depends on the scope and is quoted by your team.",
  },
  {
    value: "PUBLIC_FROM",
    label: "Published 'from' price",
    description: "Leads may be told your published starting price, exactly as written below.",
  },
  {
    value: "PUBLIC_FIXED",
    label: "Published fixed price",
    description: "Leads may be told your published price, exactly as written below.",
  },
  {
    value: "INTERNAL_ONLY",
    label: "Never discuss price",
    description: "Price is never mentioned to a lead; any price question goes to your team.",
  },
] as const;

export type PricingVisibility = (typeof PRICING_VISIBILITY_OPTIONS)[number]["value"];

export function isPublicPricing(value: string): boolean {
  return value === "PUBLIC_FROM" || value === "PUBLIC_FIXED";
}

/**
 * The price wording that is stored for a service, or an error. Public
 * visibility needs wording (the database refuses it otherwise); any other
 * visibility stores none, so wording that is not published can never leak.
 */
export function normalisePublicPrice(input: {
  visibility: string;
  text: string | null | undefined;
}): { ok: true; text: string | null } | { ok: false; error: string } {
  const text = input.text?.trim() ?? "";
  if (!isPublicPricing(input.visibility)) return { ok: true, text: null };
  if (!text) {
    return {
      ok: false,
      error: "Write the price exactly as a lead may be told it, e.g. \"From £1,500\".",
    };
  }
  if (text.length > 120) return { ok: false, error: "Keep the published price under 120 characters." };
  return { ok: true, text };
}

export type BillingView = {
  plan: string;
  /** Lifecycle state (billing/lifecycle.ts): trial, grace, paused, ended. */
  state: string;
  status: string;
  /** The verified card Checkout collected, when known. */
  paymentMethod: { brand: string; last4: string } | null;
  billingInterval: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  leadLimit: number;
  userLimit: number;
  seatsUsed: number;
  leadsUsed: number;
  /** Every outbound message sent this period, any channel. Not metered against an allowance here. */
  messagesSent: number;
  /** Outbound SMS segments used this period; null when the read failed. */
  smsSegmentsUsed: number | null;
  /** Outbound SMS segments included in the plan. */
  smsSegmentAllowance: number;
  /** A downgrade scheduled for the period end, if any. */
  pendingPlanChange: { plan: string; effectiveAt: string } | null;
  /** What the workspace holds beyond its plan's count limits (after a downgrade). */
  overLimit: {
    key: string;
    label: string;
    used: number;
    limit: number;
    reduceBy: number;
    action: string;
    blocked: string;
    href: string;
  }[];
  /** Post-cancellation timeline and the retention policy (billing/cancellation.ts). */
  retention: {
    phase: "active" | "ending" | "read_only" | "deletion_due";
    endsAt: string | null;
    readOnlyUntil: string | null;
    numberReleaseAt: string | null;
    policy: string;
  };
  /** Display price for the current plan, in GBP. Null for trial/enterprise. */
  monthlyPrice: number | null;
  /** Display annual price, in GBP. Null for trial/enterprise. */
  yearlyPrice: number | null;
  planFeatures: string[];
};

export type NotificationPreferences = {
  handover: boolean;
  booking: boolean;
  integrationFailure: boolean;
  campaignComplete: boolean;
  dailySummary: boolean;
};

export type ProfileView = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  notifications: NotificationPreferences;
  canEditNotifications: boolean;
};

export const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export type DayKey = (typeof DAYS)[number]["key"];

export type DayHours = { open: boolean; start: string; end: string };

export type BusinessHours = Record<DayKey, DayHours>;

const DEFAULT_WEEKDAY: DayHours = { open: true, start: "08:00", end: "18:00" };
const DEFAULT_WEEKEND: DayHours = { open: false, start: "09:00", end: "13:00" };

export function defaultBusinessHours(): BusinessHours {
  return {
    mon: { ...DEFAULT_WEEKDAY },
    tue: { ...DEFAULT_WEEKDAY },
    wed: { ...DEFAULT_WEEKDAY },
    thu: { ...DEFAULT_WEEKDAY },
    fri: { ...DEFAULT_WEEKDAY },
    sat: { ...DEFAULT_WEEKEND },
    sun: { ...DEFAULT_WEEKEND },
  };
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

/** Tolerates whatever shape the jsonb column happens to hold. */
export function parseBusinessHours(raw: unknown): BusinessHours {
  const base = defaultBusinessHours();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;

  for (const day of DAYS) {
    const value = record[day.key];
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    base[day.key] = {
      open: typeof entry.open === "boolean" ? entry.open : base[day.key].open,
      start: isTime(entry.start) ? entry.start : base[day.key].start,
      end: isTime(entry.end) ? entry.end : base[day.key].end,
    };
  }
  return base;
}

export function trimTime(value: string) {
  return value.length > 5 ? value.slice(0, 5) : value;
}

export function memberDisplayName(member: {
  name: string;
  email: string;
}) {
  return member.name.trim() || member.email || "Pending invite";
}

export function usagePercent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function usageTone(used: number, limit: number) {
  const pct = usagePercent(used, limit);
  if (pct >= 100) return "danger" as const;
  if (pct >= 80) return "warning" as const;
  return "success" as const;
}

/**
 * Whether a member row can be edited by the current actor. Mirrored on the
 * server by the `member.set_role` / `member.remove` operations — the UI hides what the server
 * would refuse, it does not decide it.
 */
export function canEditMember(params: {
  actorRole: BusinessRole;
  memberRole: BusinessRole;
  isSelf: boolean;
  ownerCount: number;
}) {
  if (!["owner", "admin"].includes(params.actorRole)) return false;
  if (params.isSelf) return false;
  if (params.memberRole === "owner") return false;
  // Only the owner manages admins (src/lib/team/rules.ts).
  if (params.memberRole === "admin" && params.actorRole !== "owner") return false;
  return true;
}

/** The last owner can never be removed or demoted, whoever asks. */
export function isLastOwner(members: { role: BusinessRole; status: string }[], role: BusinessRole) {
  if (role !== "owner") return false;
  return (
    members.filter(
      (member) => member.role === "owner" && member.status !== "removed",
    ).length <= 1
  );
}

export function planLabel(plan: string) {
  if (plan === "trial") return "Free trial";
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

/* ------------------------------------------------- business-hours display */

export function to12Hour(value: string) {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${suffix}`;
}

/**
 * Collapses the week into the shortest true sentence: consecutive days sharing
 * the same window are grouped, and closed days are named as closed.
 */
export function summariseHours(hours: BusinessHours): string[] {
  const groups: { days: string[]; label: string }[] = [];

  for (const day of DAYS) {
    const value = hours[day.key];
    const label = value.open
      ? `${to12Hour(value.start)} – ${to12Hour(value.end)}`
      : "Closed";
    const last = groups.at(-1);
    if (last && last.label === label) {
      last.days.push(day.label);
    } else {
      groups.push({ days: [day.label], label });
    }
  }

  return groups.map((group) => {
    const first = group.days[0].slice(0, 3);
    const last = group.days.at(-1)!.slice(0, 3);
    const range = group.days.length === 1 ? first : `${first} – ${last}`;
    return `${range}: ${group.label}`;
  });
}
