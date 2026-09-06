import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChannelRuleSet,
  CompliancePolicyPack,
  PolicyChannel,
  QuietHoursRule,
  SubscriberType,
} from "./types";

/**
 * Loads and validates the versioned compliance packs.
 *
 * A pack is stored as jsonb, which means it is untrusted-shaped data as far as
 * TypeScript is concerned. Everything below narrows it defensively: a
 * malformed pack must degrade to the most restrictive interpretation, never to
 * an accidentally permissive one. That is why every `readChannels` failure
 * yields an empty array (nothing allowed) rather than a default list.
 */

const CHANNELS = new Set<PolicyChannel>(["EMAIL", "SMS", "WHATSAPP", "SOCIAL"]);
const SUBSCRIBERS = new Set<SubscriberType>([
  "CORPORATE",
  "SOLE_TRADER",
  "PARTNERSHIP",
  "INDIVIDUAL",
  "UNKNOWN",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readChannels(value: unknown): PolicyChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is PolicyChannel => typeof v === "string" && CHANNELS.has(v as PolicyChannel));
}

function readSubscribers(value: unknown): SubscriberType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (v): v is SubscriberType => typeof v === "string" && SUBSCRIBERS.has(v as SubscriberType),
  );
  return out.length ? out : undefined;
}

function readBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRuleSet(value: unknown): ChannelRuleSet {
  const raw = asRecord(value);
  return {
    allowedChannels: readChannels(raw.allowed_channels),
    allowedSubscriberTypes: readSubscribers(raw.allowed_subscriber_types),
    reviewSubscriberTypes: readSubscribers(raw.review_subscriber_types),
    blockedSubscriberTypes: readSubscribers(raw.blocked_subscriber_types),
    requireRelationship: readBool(raw.require_relationship),
    requirePostalFooter: readBool(raw.require_postal_footer),
    requireUnsubscribe: readBool(raw.require_unsubscribe),
    requirePrivacyNotice: readBool(raw.require_privacy_notice),
  };
}

function readQuietHours(value: unknown): QuietHoursRule | null {
  const raw = asRecord(value);
  const start = typeof raw.start === "string" ? raw.start : null;
  const end = typeof raw.end === "string" ? raw.end : null;
  if (!start || !end) return null;
  return { start, end, channels: readChannels(raw.channels) };
}

/**
 * The pack used when a country has no pack of its own, and when the database
 * is unreachable. Permits nothing cold and nothing but email warm, so a
 * failure to load policy can never widen what the product will send.
 */
export const FAIL_CLOSED_PACK: CompliancePolicyPack = {
  version: "fail-closed",
  name: "Restricted",
  countryCodes: [],
  cold: {
    allowedChannels: [],
    blockedSubscriberTypes: ["INDIVIDUAL"],
    reviewSubscriberTypes: ["CORPORATE", "SOLE_TRADER", "PARTNERSHIP", "UNKNOWN"],
  },
  warm: {
    allowedChannels: ["EMAIL"],
    requireRelationship: true,
    requireUnsubscribe: true,
  },
  quietHours: { start: "20:00", end: "08:00", channels: ["SMS", "WHATSAPP"] },
};

/**
 * All active packs, memoised for the request. Packs change rarely and are
 * platform-owned, so a per-request read is cheap and always current enough.
 */
export const loadActivePacks = cache(async (): Promise<CompliancePolicyPack[]> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("compliance_policy_versions")
    .select("version, name, country_codes, rules_json")
    .eq("status", "ACTIVE");

  if (error || !data) return [];

  return data.map((row) => {
    const rules = asRecord(row.rules_json);
    return {
      version: row.version,
      name: row.name,
      countryCodes: Array.isArray(row.country_codes) ? row.country_codes : [],
      cold: readRuleSet(rules.cold),
      warm: readRuleSet(rules.warm),
      quietHours: readQuietHours(rules.quiet_hours),
    };
  });
});

/**
 * Resolves the pack governing a country. Falls back to the pack whose
 * countryCodes list is empty (the seeded "Default"), and to FAIL_CLOSED_PACK if
 * even that is missing — an unknown jurisdiction must never inherit the most
 * permissive pack that happens to be loaded.
 */
export async function packForCountry(country: string | null): Promise<CompliancePolicyPack> {
  const packs = await loadActivePacks();
  if (packs.length === 0) return FAIL_CLOSED_PACK;

  const code = (country ?? "").trim().toUpperCase();
  if (code) {
    const match = packs.find((pack) => pack.countryCodes.includes(code));
    if (match) return match;
  }

  return packs.find((pack) => pack.countryCodes.length === 0) ?? FAIL_CLOSED_PACK;
}
