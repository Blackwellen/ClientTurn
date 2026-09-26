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

  if (address.includes(":")) return ipv6ToBigInt(address) !== null;

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
 * CIDR block -- IPv4 or IPv6.
 *
 * Both sides are parsed to numbers before comparing, so `2001:DB8::1` matches
 * `2001:db8:0:0::1`. An IPv4-mapped IPv6 caller (`::ffff:203.0.113.4`, which is
 * how a dual-stack socket reports an IPv4 client) is compared as the IPv4
 * address it is. Anything that does not parse never matches: an allowlist
 * refuses what it cannot understand.
 */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const caller = parseIp(ip);
  if (!caller) return false;

  for (const entry of allowlist) {
    const rule = entry.trim();
    if (!rule) continue;

    const [networkText, maskText] = rule.split("/");
    const network = parseIp(networkText);
    if (!network || network.family !== caller.family) continue;

    const width = network.family === 4 ? 32 : 128;
    const bits = maskText === undefined ? width : Number(maskText);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) continue;
    if (maskText !== undefined && !/^\d{1,3}$/.test(maskText)) continue;

    const shift = BigInt(width - bits);
    if (network.value >> shift === caller.value >> shift) return true;
  }

  return false;
}

type ParsedIp = { family: 4 | 6; value: bigint };

/** Parses either family; unwraps IPv4-mapped IPv6 to IPv4. */
function parseIp(text: string): ParsedIp | null {
  const value = (text ?? "").trim();
  if (!value || value === "unknown") return null;
  if (!value.includes(":")) {
    const v4 = ipv4ToInt(value);
    return v4 === null ? null : { family: 4, value: BigInt(v4) };
  }
  const v6 = ipv6ToBigInt(value);
  if (v6 === null) return null;
  // ::ffff:0:0/96 -- an IPv4 client seen through an IPv6 socket.
  if (v6 >> BigInt(32) === BigInt(0xffff)) {
    return { family: 4, value: v6 & BigInt(0xffffffff) };
  }
  return { family: 6, value: v6 };
}

/**
 * RFC 4291 text form to a 128-bit number: eight hex groups, one `::` run of
 * zeros at most, an optional dotted IPv4 tail, and an optional `%zone` (which
 * is dropped -- it names an interface, not an address). Null for anything else.
 */
export function ipv6ToBigInt(text: string): bigint | null {
  let value = text.trim();
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value || !/^[0-9a-fA-F:.]+$/.test(value)) return null;

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (piece.includes(".")) {
        if (index !== pieces.length - 1) return null;
        const v4 = ipv4ToInt(piece);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  // An IPv4 tail is only valid at the very end of the address.
  if (halves.length === 2 && halves[0].includes(".")) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  return groups.reduce((acc, group) => (acc << BigInt(16)) | BigInt(group), BigInt(0));
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
