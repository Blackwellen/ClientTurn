/**
 * Admin -> Affiliates: shapes and labels (V4 section 41).
 *
 * Pure - no `server-only`, no Supabase - because the admin view is a client
 * component and must not pull the service-role client into the browser graph.
 */

export const AFFILIATE_TABS = [
  "overview",
  "affiliates",
  "referrals",
  "commissions",
  "payouts",
  "resources",
] as const;
export type AffiliateTab = (typeof AFFILIATE_TABS)[number];

export const TAB_LABELS: Record<AffiliateTab, string> = {
  overview: "Overview",
  affiliates: "Affiliates",
  referrals: "Referrals",
  commissions: "Commissions",
  payouts: "Payouts",
  resources: "Resources",
};

export function parseTab(value: unknown): AffiliateTab {
  return typeof value === "string" && AFFILIATE_TABS.includes(value as AffiliateTab)
    ? (value as AffiliateTab)
    : "overview";
}

export type AdminAffiliateRow = {
  id: string;
  code: string;
  displayName: string;
  companyName: string | null;
  contactEmail: string;
  websiteUrl: string | null;
  country: string | null;
  audienceDescription: string | null;
  promotionMethods: string[];
  status: string;
  statusReason: string | null;
  taxStatus: string;
  hasPaymentDetails: boolean;
  planName: string | null;
  clicks: number;
  referrals: number;
  paying: number;
  pendingMinor: number;
  payableMinor: number;
  paidMinor: number;
  lifetimeMinor: number;
  createdAt: string;
  approvedAt: string | null;
};

export type AdminReferralRow = {
  id: string;
  affiliateName: string;
  businessName: string | null;
  status: string;
  planKey: string | null;
  signupAt: string | null;
  paidAt: string | null;
  lifetimeRevenueMinor: number;
  createdAt: string;
};

export type AdminCommissionRow = {
  id: string;
  affiliateName: string;
  businessName: string | null;
  status: string;
  baseAmountMinor: number;
  commissionAmountMinor: number;
  currency: string;
  periodMonth: string | null;
  createdAt: string;
  payableAt: string | null;
};

export type AdminPayoutRow = {
  id: string;
  affiliateName: string;
  batchReference: string | null;
  status: string;
  amountMinor: number;
  currency: string;
  commissionCount: number;
  method: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type AdminResourceRow = {
  id: string;
  category: string;
  title: string;
  status: string;
  version: string;
  downloadCount: number;
  updatedAt: string;
};

export type AdminAffiliatesData = {
  tab: AffiliateTab;
  totals: {
    activeAffiliates: number;
    pendingApplications: number;
    referrals: number;
    payingReferrals: number;
    pendingMinor: number;
    payableMinor: number;
    paidMinor: number;
  };
  affiliates: AdminAffiliateRow[];
  referrals: AdminReferralRow[];
  commissions: AdminCommissionRow[];
  payouts: AdminPayoutRow[];
  resources: AdminResourceRow[];
};

/**
 * Whether an application has enough for a reviewer to decide.
 *
 * Not a gate — an operator may approve anyone. It exists so the queue can show
 * which applications will need a conversation first, rather than making a
 * reviewer open each one to find out.
 */
export function applicationGaps(row: AdminAffiliateRow): string[] {
  const gaps: string[] = [];
  if (!row.websiteUrl) gaps.push("No website or channel");
  if (!row.audienceDescription || row.audienceDescription.trim().length < 40) {
    gaps.push("Thin audience description");
  }
  if (row.promotionMethods.length === 0) gaps.push("No promotion method given");
  return gaps;
}
