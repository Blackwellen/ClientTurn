/**
 * Settings shapes and pure display helpers. Deliberately free of `server-only`
 * and of any Supabase import so client components can use these without
 * dragging the service-role client into the browser bundle.
 */

/** Mirrors the membership roles in the database; kept local so this module
 *  never reaches into a server-only import. */
export type BusinessRole = "owner" | "admin" | "member" | "viewer";

export type SettingsTab = {
  segment: string;
  label: string;
  /** Owner-only tabs are still rendered, but the page enforces the rule. */
  ownerOnly?: boolean;
};

export const SETTINGS_TABS: SettingsTab[] = [
  { segment: "workspace", label: "Workspace" },
  { segment: "connections", label: "Connections" },
  { segment: "team", label: "Team" },
  { segment: "billing", label: "Billing" },
];

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

export function planLabel(plan: string) {
  if (plan === "trial") return "Free trial";
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}
