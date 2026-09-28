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
  "flags",
  "tiers",
  "resources",
] as const;
export type AffiliateTab = (typeof AFFILIATE_TABS)[number];

export const TAB_LABELS: Record<AffiliateTab, string> = {
  overview: "Overview",
  affiliates: "Affiliates",
  referrals: "Referrals",
  commissions: "Commissions",
  payouts: "Payouts",
  flags: "Fraud review",
  tiers: "Tiers & settings",
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
  tier: string;
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
  /** NEW_CUSTOMER, REVERSAL, REACCRUAL, ADJUSTMENT, WRITE_OFF (ledger-rules.ts ledgerEntryLabel). */
  entryType: string | null;
  reversalReason: string | null;
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
  failureReason?: string | null;
};

/** One held or rejected referral in the fraud review queue (audit 17). */
export type AdminFlagRow = {
  referralId: string;
  affiliateId: string;
  affiliateName: string;
  businessName: string | null;
  referralStatus: string;
  heldReason: string | null;
  signals: { code: string; label: string; severity: string; status: string; source: string }[];
  createdAt: string;
};

export type AdminTierRow = {
  key: string;
  name: string;
  rank: number;
  /** Paid referred customers in the last 12 months. */
  minActiveCustomers: number;
  /** The one-off commission rate (1-10%). */
  commissionPercent: number | null;
  description: string | null;
};

export type AdminProgrammeSettings = {
  autoApprovePayouts: boolean;
  autoDispatchPayouts: boolean;
  envAutoPayout: boolean;
  available: boolean;
};

export type AdminAffiliateDetail = {
  id: string;
  displayName: string;
  code: string;
  status: string;
  tier: string;
  tierLocked: boolean;
  activeCustomers: number;
  referredMrrMinor: number;
  nextTier: string | null;
  tierPercent: number;
  sales: { label: string; customers: number; mrrMinor: number }[];
  tierHistory: { fromTier: string | null; toTier: string; reason: string; createdAt: string }[];
  balances: { pendingMinor: number; approvedMinor: number; availableMinor: number; paidMinor: number; reversedMinor: number };
  payoutReadiness: string;
  connectState: string;
  openFlags: number;
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
  flags: AdminFlagRow[];
  tiers: AdminTierRow[];
  settings: AdminProgrammeSettings;
  /** The partner opened with `?affiliate=<id>`, or null. */
  detail: AdminAffiliateDetail | null;
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
