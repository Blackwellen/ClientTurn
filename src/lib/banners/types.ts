/**
 * Platform banners and announcements: the vocabulary (docs/MAINTENANCE.md).
 *
 * Pure: relative imports only. A banner is plain text plus at most one link.
 * There is no HTML field anywhere in the model, so there is nothing to
 * sanitise and nothing an operator can inject into every customer's app.
 */

export const BANNER_TONES = ["info", "success", "warning", "critical"] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

export const BANNER_AUDIENCES = [
  "ALL",
  "APP_USERS",
  "MARKETING_VISITORS",
  "PLANS",
  "WORKSPACES",
  "OWNERS_ADMINS",
] as const;
export type BannerAudience = (typeof BANNER_AUDIENCES)[number];

export const BANNER_AUDIENCE_LABEL: Record<BannerAudience, string> = {
  ALL: "Everyone",
  APP_USERS: "Signed-in app users",
  MARKETING_VISITORS: "Website visitors",
  PLANS: "Specific plans",
  WORKSPACES: "Specific workspaces",
  OWNERS_ADMINS: "Owners and admins only",
};

export const BANNER_PLANS = ["trial", "starter", "growth", "pro", "enterprise"] as const;
export type BannerPlan = (typeof BANNER_PLANS)[number];

export const BANNER_PLACEMENTS = ["APP_TOP", "MARKETING_TOP", "DASHBOARD_CARD"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const BANNER_PLACEMENT_LABEL: Record<BannerPlacement, string> = {
  APP_TOP: "App top bar",
  MARKETING_TOP: "Website top bar",
  DASHBOARD_CARD: "Dashboard card",
};

export const TITLE_MAX = 120;
export const BODY_MAX = 500;
export const LINK_LABEL_MAX = 40;
export const PRIORITY_MAX = 100;

export type Banner = {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  tone: BannerTone;
  audience: BannerAudience;
  plans: string[];
  businessIds: string[];
  placements: BannerPlacement[];
  /** ISO, UTC. */
  startsAt: string;
  endsAt: string | null;
  /** Set by "End now". */
  endedAt: string | null;
  dismissible: boolean;
  /** 0-100; the highest wins its placement. */
  priority: number;
  updatedAt: string;
};

/** Who is looking. `app` viewers carry what the audience rules need. */
export type BannerViewer =
  | { kind: "marketing" }
  | {
      kind: "app";
      businessId: string;
      /** The workspace's plan key: trial while trialling. */
      plan: string;
      role: "owner" | "admin" | "member" | "viewer";
    };

/** A notice the stack renders: a platform banner or an account notice. */
export type StackSource = "platform" | "maintenance" | "account";

export type StackItem = {
  key: string;
  source: StackSource;
  /** Account notices map their own tone (danger = critical). */
  tone: BannerTone;
  priority: number;
};
