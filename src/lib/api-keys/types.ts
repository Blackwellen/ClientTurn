/**
 * API key shapes and pure display helpers.
 *
 * Deliberately free of `server-only` and of any Supabase import, so the
 * Settings panel can render these without dragging the service-role client
 * into the browser bundle — the same split the rest of Settings uses.
 */

import type { PlatformScope } from "@/lib/platform/scopes";

export type ApiKeyEnvironment = "live" | "test";

/**
 * What a workspace admin is shown about a key. Note what is absent: there is no
 * field here that could carry the secret, so no future edit to a query can
 * accidentally start returning it.
 */
export type ApiKeyView = {
  id: string;
  name: string;
  /** `ct_live_a1b2c3d4` — enough to recognise, not enough to use. */
  keyPrefix: string;
  keyLastFour: string;
  environment: ApiKeyEnvironment;
  scopes: PlatformScope[];
  /** The member whose authority the key carries. */
  ownerName: string;
  ownerIsCaller: boolean;
  allowedIps: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  requestCount: number;
  revokedAt: string | null;
  createdAt: string;
  /** Refusals in the last 7 days. A key being denied is worth noticing. */
  recentDenials: number;
  recentRequests: number;
};

export type ApiKeyStatus = "active" | "revoked" | "expired" | "unused";

export function apiKeyStatus(key: ApiKeyView, now = new Date()): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  // A key that exists but has never been presented is not yet doing anything.
  // Calling it "Active" would be a claim the customer could disprove.
  return key.lastUsedAt ? "active" : "unused";
}

export const API_KEY_STATUS_LABELS: Record<ApiKeyStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  unused: "Never used",
};

export const API_KEY_STATUS_TONES: Record<
  ApiKeyStatus,
  "success" | "danger" | "warning" | "neutral"
> = {
  active: "success",
  revoked: "danger",
  expired: "warning",
  unused: "neutral",
};

/** `ct_live_a1b2c3d4…f9c4`. Never the whole key. */
export function maskedKey(key: Pick<ApiKeyView, "keyPrefix" | "keyLastFour">) {
  return `${key.keyPrefix}…${key.keyLastFour}`;
}

/**
 * How long a key may live. Unbounded is offered because some integrations
 * genuinely cannot rotate, but it is not the default: the form opens on 90 days
 * so the safe choice is the one someone has to actively leave alone.
 */
export const API_KEY_EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
] as const;

export type ApiKeyExpiryOption = (typeof API_KEY_EXPIRY_OPTIONS)[number]["value"];

export function expiryToDate(
  option: string,
  from = new Date(),
): Date | null {
  if (option === "never") return null;
  const days = Number(option);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export const ENVIRONMENT_LABELS: Record<ApiKeyEnvironment, string> = {
  live: "Live",
  test: "Test",
};

/**
 * Validates one entry of an IP allowlist: a bare IPv4/IPv6 address or a CIDR
 * block. Kept pure so the form refuses a typo before the server does — the
 * server still refuses it too, because the form is not the guard.
 */
export function isAllowedIpEntry(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const [address, mask] = trimmed.split("/");
  if (mask !== undefined) {
    const bits = Number(mask);
    if (!Number.isInteger(bits) || bits < 0) return false;
    const limit = address.includes(":") ? 128 : 32;
    if (bits > limit) return false;
  }

  if (address.includes(":")) {
    // Loose by design: a full IPv6 grammar here would reject valid forms more
    // often than it would catch mistakes. The connecting address is compared
    // literally, so a malformed entry simply never matches.
    return /^[0-9a-fA-F:]+$/.test(address) && address.length >= 2;
  }

  const octets = address.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const number = Number(octet);
    return number >= 0 && number <= 255;
  });
}

/**
 * An IP matches the allowlist if it is listed exactly, or falls inside a listed
 * IPv4 CIDR block.
 *
 * IPv6 is exact-match only. A partly-correct IPv6 prefix comparison is worse
 * than none: it would silently admit addresses the customer believed were
 * excluded. Documented rather than approximated.
 */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip || ip === "unknown") return false;

  for (const entry of allowlist) {
    const rule = entry.trim();
    if (!rule) continue;
    if (rule === ip) return true;

    const [network, maskText] = rule.split("/");
    if (maskText === undefined) continue;
    if (network.includes(":") || ip.includes(":")) continue;

    const bits = Number(maskText);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;

    const left = ipv4ToInt(network);
    const right = ipv4ToInt(ip);
    if (left === null || right === null) continue;

    // A /0 shifts by 32, which in JavaScript is a no-op rather than zero, so it
    // is handled explicitly instead of producing a mask of all ones.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((left & mask) === (right & mask)) return true;
  }

  return false;
}

function ipv4ToInt(value: string): number | null {
  const octets = value.split(".");
  if (octets.length !== 4) return null;
  let result = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    result = (result << 8) | number;
  }
  return result >>> 0;
}
