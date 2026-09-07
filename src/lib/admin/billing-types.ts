/**
 * Admin billing shapes shared with client components. No `server-only`, no
 * Supabase and no Stripe import.
 *
 * Stripe remains the source of truth for money. Everything on this surface is
 * either read straight from Stripe or from the local mirror the webhooks
 * maintain, and where the two could disagree the row says which one it came
 * from — an operator making a billing decision needs to know that.
 */

export const BILLING_VIEWS = [
  "subscriptions",
  "invoices",
  "credits",
  "entitlements",
] as const;
export type BillingView = (typeof BILLING_VIEWS)[number];

export const BILLING_VIEW_LABEL: Record<BillingView, string> = {
  subscriptions: "Subscriptions",
  invoices: "Invoices",
  credits: "Credits & Adjustments",
  entitlements: "Entitlements",
};

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELLED",
  "UNPAID",
  "INCOMPLETE",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  CANCELLED: "Cancelled",
  UNPAID: "Unpaid",
  INCOMPLETE: "Incomplete",
};

export const SUBSCRIPTION_STATUS_TONE = {
  TRIALING: "info",
  ACTIVE: "success",
  PAST_DUE: "danger",
  CANCELLED: "neutral",
  UNPAID: "danger",
  INCOMPLETE: "warning",
} as const;

export type SubscriptionRow = {
  id: string;
  businessId: string;
  businessName: string;
  domain: string | null;
  plan: string;
  planLabel: string;
  status: SubscriptionStatus;
  /** Monthly recurring revenue in pounds, normalised from an annual price. */
  mrr: number;
  billingCycle: "Monthly" | "Annual" | "—";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  /** Null when the workspace has never reached Stripe (trial without checkout). */
  stripeState: SubscriptionStatus | null;
};

export type SubscriptionListResult = {
  rows: SubscriptionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type BillingSummary = {
  totalSubscriptions: number;
  active: number;
  trials: number;
  pastDue: number;
  cancelled: number;
  /** Sum of MRR across non-cancelled subscriptions, in pounds. */
  mrr: number;
  churnRate30d: number | null;
  /** Per-bucket MRR across the window, for the trend chart. */
  mrrSeries: number[];
  byPlan: { plan: string; label: string; count: number; mrr: number }[];
};

export type InvoiceRow = {
  id: string;
  number: string | null;
  businessId: string;
  businessName: string;
  createdAt: string;
  amount: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

export const CREDIT_ENTRY_TYPES = ["CREDIT", "DEBIT", "ADJUSTMENT", "REVERSAL"] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

export const CREDIT_ENTRY_TYPE_LABEL: Record<CreditEntryType, string> = {
  CREDIT: "Credit",
  DEBIT: "Debit",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

export type CreditRow = {
  id: string;
  businessId: string;
  businessName: string;
  entryType: CreditEntryType;
  /** Pounds. Always positive; `entryType` carries the direction. */
  amount: number;
  currency: string;
  reason: string;
  supportReference: string | null;
  state: "PENDING" | "APPLIED" | "FAILED" | "REVERSED";
  createdBy: string | null;
  createdAt: string;
  /** False once it has been reversed, or when it was never applied. */
  reversible: boolean;
};

export type EntitlementRow = {
  id: string;
  businessId: string;
  businessName: string;
  plan: string;
  planLabel: string;
  key: string;
  keyLabel: string;
  /** What the plan grants before any override. Null for a boolean feature. */
  baseLimit: number | null;
  /** The granted override. Null when the grant is a boolean capability. */
  override: number | null;
  booleanValue: boolean | null;
  reason: string;
  grantedAt: string;
  expiresAt: string | null;
  /** True once `expiresAt` has passed — the grant is inert but still listed. */
  expired: boolean;
  source: "Plan" | "Admin grant";
};

export type BillingEventRow = {
  id: string;
  at: string;
  type: string;
  summary: string;
};

export type SubscriptionDetail = SubscriptionRow & {
  /** Masked: brand and last four only. A full PAN never reaches this screen. */
  paymentMethod: string | null;
  createdAt: string;
  price: number | null;
  /** Where the Stripe dashboard entry for this customer lives, if it exists. */
  stripeDashboardUrl: string | null;
  invoices: InvoiceRow[];
  credits: CreditRow[];
  entitlements: EntitlementRow[];
  events: BillingEventRow[];
  usage: { label: string; used: number; limit: number | null }[];
  /** Which controlled actions are available, decided by the server. */
  canChangePlan: boolean;
  canCancelAtPeriodEnd: boolean;
  canRevertCancellation: boolean;
  cancellationEffectiveOn: string | null;
  actionBlockedReason: string | null;
};

export type BillingViewData = {
  view: BillingView;
  summary: BillingSummary;
  subscriptions: SubscriptionListResult;
  invoices: InvoiceRow[];
  invoiceError: string | null;
  credits: CreditRow[];
  entitlements: EntitlementRow[];
  detail: SubscriptionDetail | null;
  plans: { value: string; label: string }[];
};
