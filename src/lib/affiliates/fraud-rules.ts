import { createHmac } from "node:crypto";

/**
 * Affiliate fraud and self-referral rules (affiliate audit 17, §1).
 *
 * Pure: no `server-only`, no Supabase, no Stripe. The signup attribution, the
 * click route and the daily ledger job all call these, and the tests assert
 * them directly.
 *
 * GDPR shape, which every function here keeps:
 *
 * - **No raw IP is ever returned or stored.** `ipHash` and `deviceHash` are
 *   keyed HMACs with a server secret, so a stored value cannot be reversed or
 *   rainbow-tabled, and they are purged after `FINGERPRINT_RETENTION_DAYS`
 *   (migration 0166 `purge_affiliate_identifiers`).
 * - **No paid IP intelligence.** The proxy heuristic reads only headers the
 *   request already carried. It is a soft signal (INFO), never a block.
 * - **Signals decide a hold, a person decides a rejection**, except for the
 *   unambiguous cases (the affiliate's own account, email, Stripe customer or
 *   card), which the published terms already exclude.
 */

/** How long IP and device hashes are kept before they are purged. */
export const FINGERPRINT_RETENTION_DAYS = 120;

/** Click rows themselves are deleted after this (link counters survive). */
export const CLICK_RETENTION_DAYS = 400;

/* ------------------------------------------------------------- hashing -- */

/** A keyed hash of the network address alone (same office / same home). */
export function ipHash(secret: string, ip: string): string {
  return createHmac("sha256", secret).update(`ip:${ip.trim().toLowerCase()}`).digest("hex").slice(0, 40);
}

/** A keyed hash of address plus browser: the same device, approximately. */
export function deviceHash(secret: string, ip: string, userAgent: string): string {
  return createHmac("sha256", secret)
    .update(`device:${ip.trim().toLowerCase()}:${userAgent.trim()}`)
    .digest("hex")
    .slice(0, 40);
}

/** A keyed hash of a normalised email, so the fingerprint table holds no address. */
export function emailHash(secret: string, email: string): string {
  return createHmac("sha256", secret).update(`email:${normaliseEmail(email)}`).digest("hex").slice(0, 40);
}

/**
 * Lower-cased, with Gmail-style `+tag` and dots removed for the providers that
 * ignore them, so `j.doe+aff@gmail.com` and `jdoe@gmail.com` match.
 */
export function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Consumer mailbox providers. Two people sharing `gmail.com` is not a signal;
 * two people sharing `acme-studio.co.uk` is.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.co.uk", "mail.com", "zoho.com", "btinternet.com", "sky.com",
  "virginmedia.com", "talktalk.net",
]);

export function isFreeMailDomain(domain: string | null): boolean {
  return domain ? FREE_MAIL_DOMAINS.has(domain) : false;
}

/* --------------------------------------------------------- bot / proxy -- */

/**
 * A link-preview fetch or a browser prefetch, which is not a person clicking.
 * Slack, iMessage and Chrome's speculative loads all announce themselves.
 */
export function isPrefetch(headers: { get(name: string): string | null }): boolean {
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  return /prefetch|preview|prerender/i.test(purpose);
}

/**
 * A cheap, lawful proxy/VPN heuristic from headers we already receive.
 *
 * Only two facts: an explicit `Via` header (most forward proxies add one) or a
 * forwarding chain longer than our own edge adds. It is a note on the click,
 * never a reason to drop it: plenty of honest people browse through a
 * corporate proxy.
 */
export function proxySuspected(headers: { get(name: string): string | null }): boolean {
  if (headers.get("via")) return true;
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain.length > 2;
}

/* ------------------------------------------------------------- signals -- */

export const FRAUD_CODES = [
  "SELF_REFERRAL_USER",
  "SAME_EMAIL",
  "SAME_STRIPE_CUSTOMER",
  "SAME_PAYMENT_CARD",
  "AFFILIATE_IS_MEMBER",
  "SAME_EMAIL_DOMAIN",
  "SAME_DEVICE",
  "SAME_NETWORK",
  "DUPLICATE_ACCOUNT",
  "INSTANT_SIGNUP",
  "PROXY_SUSPECTED",
] as const;
export type FraudCode = (typeof FRAUD_CODES)[number];

export type FraudSeverity = "BLOCK" | "REVIEW" | "INFO";

export const FRAUD_SEVERITY: Record<FraudCode, FraudSeverity> = {
  // Unambiguous: the published terms already say these earn nothing.
  SELF_REFERRAL_USER: "BLOCK",
  SAME_EMAIL: "BLOCK",
  SAME_STRIPE_CUSTOMER: "BLOCK",
  SAME_PAYMENT_CARD: "BLOCK",
  AFFILIATE_IS_MEMBER: "BLOCK",
  // A reason for a person to look before money moves.
  SAME_EMAIL_DOMAIN: "REVIEW",
  SAME_DEVICE: "REVIEW",
  SAME_NETWORK: "REVIEW",
  DUPLICATE_ACCOUNT: "REVIEW",
  // Context for the reviewer only.
  INSTANT_SIGNUP: "INFO",
  PROXY_SUSPECTED: "INFO",
};

export const FRAUD_LABEL: Record<FraudCode, string> = {
  SELF_REFERRAL_USER: "Affiliate signed up through their own link",
  SAME_EMAIL: "Customer email matches the affiliate's",
  SAME_STRIPE_CUSTOMER: "Same Stripe customer as the affiliate's own workspace",
  SAME_PAYMENT_CARD: "Same payment card as the affiliate's own workspace",
  AFFILIATE_IS_MEMBER: "Affiliate is a member of the referred workspace",
  SAME_EMAIL_DOMAIN: "Customer and affiliate share a company email domain",
  SAME_DEVICE: "Signed up from a device the affiliate uses",
  SAME_NETWORK: "Signed up from a network the affiliate uses",
  DUPLICATE_ACCOUNT: "Customer already had another ClientTurn workspace",
  INSTANT_SIGNUP: "Signed up within seconds of the click",
  PROXY_SUSPECTED: "Click came through a proxy or VPN",
};

export type FraudSignal = { code: FraudCode; severity: FraudSeverity };

export type SignupEvidence = {
  affiliate: {
    userId: string;
    email: string;
    /** Keyed hashes of networks and devices the affiliate has used the portal from. */
    ipHashes: readonly string[];
    deviceHashes: readonly string[];
  };
  signup: {
    userId: string;
    email: string | null;
    ipHash: string | null;
    deviceHash: string | null;
    /** Workspaces the signing-up user already belonged to before this one. */
    priorWorkspaceCount: number;
    /** Milliseconds from the recorded click to the signup, when known. */
    msSinceClick: number | null;
    proxySuspected: boolean;
  };
};

/**
 * Every signal a signup raises against the affiliate being credited.
 *
 * Ordered by severity so the first entry is the headline reason.
 */
export function assessSignup(evidence: SignupEvidence): FraudSignal[] {
  const { affiliate, signup } = evidence;
  const codes: FraudCode[] = [];

  if (affiliate.userId === signup.userId) codes.push("SELF_REFERRAL_USER");

  if (signup.email && normaliseEmail(signup.email) === normaliseEmail(affiliate.email)) {
    codes.push("SAME_EMAIL");
  }

  const signupDomain = emailDomain(signup.email);
  if (
    signupDomain &&
    !isFreeMailDomain(signupDomain) &&
    signupDomain === emailDomain(affiliate.email) &&
    !codes.includes("SAME_EMAIL")
  ) {
    codes.push("SAME_EMAIL_DOMAIN");
  }

  if (signup.deviceHash && affiliate.deviceHashes.includes(signup.deviceHash)) {
    codes.push("SAME_DEVICE");
  } else if (signup.ipHash && affiliate.ipHashes.includes(signup.ipHash)) {
    codes.push("SAME_NETWORK");
  }

  if (signup.priorWorkspaceCount > 0) codes.push("DUPLICATE_ACCOUNT");
  if (signup.msSinceClick !== null && signup.msSinceClick >= 0 && signup.msSinceClick < 5_000) {
    codes.push("INSTANT_SIGNUP");
  }
  if (signup.proxySuspected) codes.push("PROXY_SUSPECTED");

  return sortSignals(codes.map((code) => ({ code, severity: FRAUD_SEVERITY[code] })));
}

/** Signals from the payment side, checked once the referral pays. */
export function assessPayment(input: {
  referredCustomerId: string | null;
  affiliateCustomerIds: readonly string[];
  referredCardFingerprints: readonly string[];
  affiliateCardFingerprints: readonly string[];
  affiliateIsMember: boolean;
}): FraudSignal[] {
  const codes: FraudCode[] = [];
  if (input.affiliateIsMember) codes.push("AFFILIATE_IS_MEMBER");
  if (input.referredCustomerId && input.affiliateCustomerIds.includes(input.referredCustomerId)) {
    codes.push("SAME_STRIPE_CUSTOMER");
  }
  const own = new Set(input.affiliateCardFingerprints);
  if (input.referredCardFingerprints.some((fingerprint) => own.has(fingerprint))) {
    codes.push("SAME_PAYMENT_CARD");
  }
  return sortSignals(codes.map((code) => ({ code, severity: FRAUD_SEVERITY[code] })));
}

const SEVERITY_RANK: Record<FraudSeverity, number> = { BLOCK: 0, REVIEW: 1, INFO: 2 };

function sortSignals(signals: FraudSignal[]): FraudSignal[] {
  return [...signals].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export type FlagDecision =
  /** Nothing worth holding money for. INFO signals are still recorded. */
  | { action: "none" }
  /** Hold: no accrual, approval or payout until a person clears it. */
  | { action: "hold"; reason: FraudCode }
  /** Not eligible under the published terms. Rejected, reversible by an admin. */
  | { action: "reject"; reason: FraudCode };

export function decideFlag(signals: readonly FraudSignal[]): FlagDecision {
  const block = signals.find((signal) => signal.severity === "BLOCK");
  if (block) return { action: "reject", reason: block.code };
  const review = signals.find((signal) => signal.severity === "REVIEW");
  if (review) return { action: "hold", reason: review.code };
  return { action: "none" };
}

/**
 * The per-IP click rate we record. Over it the visitor still reaches the page;
 * the click just is not counted or cookied. Tighter than the old 240/minute,
 * which let one machine inflate a link's numbers by thousands an hour.
 */
export const CLICK_RATE_LIMIT = { limit: 20, windowSeconds: 600 } as const;
