/**
 * Settings shapes and pure display helpers. Deliberately free of `server-only`
 * and of any Supabase import so client components can use these without
 * dragging the service-role client into the browser bundle.
 */

/** Mirrors the membership roles in the database; kept local so this module
 *  never reaches into a server-only import. */
export type BusinessRole = "owner" | "admin" | "member" | "viewer";

/**
 * The four — and only four — Settings sections. Settings is one route with a
 * `?section=` query, so every configuration surface stays in one place.
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
    description: "Integrations and syncing",
  },
  { id: "team", label: "Team", description: "Manage your team" },
  { id: "billing", label: "Billing", description: "Plan, usage and invoices" },
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

export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  owner: "Full access, including billing and deleting the workspace.",
  admin: "Everything except deleting the workspace.",
  member: "Works leads and messages, cannot change workspace settings.",
  viewer: "Read-only access to leads and reporting.",
};

/** Roles an admin may assign. Ownership transfer is not part of V1. */
export const ASSIGNABLE_ROLES: BusinessRole[] = ["admin", "member", "viewer"];

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  invited: "Invited",
  suspended: "Suspended",
  removed: "Removed",
};

export const INDUSTRIES = [
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

export const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Madrid",
  "UTC",
] as const;

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
    const city = zone === "UTC" ? "Coordinated Universal Time" : zone.split("/")[1]?.replace(/_/g, " ") ?? zone;
    return `(${offset.replace("GMT", "GMT")}) ${city}`;
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
};

export type BookingSettings = {
  bookingMode: string;
  bookingUrl: string | null;
  appointmentDurationMinutes: number;
  bookingBufferMinutes: number;
  calendlyConnected: boolean;
  googleCalendarConnected: boolean;
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
};

export type BillingView = {
  plan: string;
  status: string;
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
  messagesUsed: number;
  /** Outbound SMS segments included in the plan. */
  messageAllowance: number;
  /** Display price for the current plan, in GBP. Null for trial/enterprise. */
  monthlyPrice: number | null;
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
 * server by `changeMemberRole` / `removeMember` — the UI hides what the server
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
