import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type ContactCandidate,
  type ProviderResponse,
  type SourcingProvider,
  type VerificationResult,
} from "./types";

/**
 * Hunter: email discovery and verification.
 *
 * Verification is the last cost-bearing stage before a prospect can be called
 * READY, and it is the one that most directly protects sender reputation — an
 * unverified address that hard-bounces damages the domain every later campaign
 * sends from. It is cheap enough to run on every surviving candidate.
 */

type HunterEmail = {
  value?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  linkedin?: string;
  phone_number?: string;
};

type HunterVerify = {
  data?: { result?: string; status?: string; score?: number; email?: string };
};

function key(): string | undefined {
  return serverEnv.sourcing.hunterApiKey;
}

async function findContacts(input: {
  companies: { domain: string | null; externalId: string | null }[];
  roles: string[];
  limit: number;
}): Promise<ProviderResponse<ContactCandidate>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<ContactCandidate>();

  const domains = input.companies
    .map((company) => company.domain)
    .filter((domain): domain is string => Boolean(domain))
    .slice(0, input.limit);

  const records: ContactCandidate[] = [];
  let latencyMs = 0;

  // Hunter's domain-search is one domain per call, so the batch is a loop.
  // It stops at the first non-transient failure rather than hammering a
  // provider that has just refused us.
  for (const domain of domains) {
    const result = await providerJson<{ data?: { emails?: HunterEmail[] } }>({
      url: `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(apiKey)}`,
    });

    latencyMs += result.latencyMs;

    if (!result.ok) {
      if (records.length === 0) return providerFailure<ContactCandidate>(result.code, latencyMs);
      break;
    }

    for (const email of result.data.data?.emails ?? []) {
      if (!email.value) continue;
      records.push({
        externalId: null,
        firstName: email.first_name ?? null,
        lastName: email.last_name ?? null,
        roleTitle: email.position ?? null,
        email: email.value,
        phone: email.phone_number ?? null,
        linkedinUrl: email.linkedin ?? null,
        companyExternalId: null,
        companyDomain: domain,
      });
    }
  }

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: null,
    latencyMs,
    errorCode: null,
  };
}

const STATUS_MAP: Record<string, VerificationResult["status"]> = {
  deliverable: "VALID",
  undeliverable: "INVALID",
  risky: "RISKY",
  accept_all: "CATCH_ALL",
  unknown: "UNVERIFIABLE",
};

async function verifyEmails(input: {
  emails: string[];
}): Promise<ProviderResponse<VerificationResult>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<VerificationResult>();

  const records: VerificationResult[] = [];
  let latencyMs = 0;

  for (const email of input.emails) {
    const result = await providerJson<HunterVerify>({
      url: `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`,
    });

    latencyMs += result.latencyMs;

    if (!result.ok) {
      if (records.length === 0) return providerFailure<VerificationResult>(result.code, latencyMs);
      break;
    }

    const verdict = result.data.data?.result ?? result.data.data?.status ?? "unknown";
    records.push({
      email,
      status: STATUS_MAP[verdict] ?? "UNKNOWN",
      score: result.data.data?.score ?? null,
    });
  }

  return { ok: true, records, costMinor: 0, cursor: null, latencyMs, errorCode: null };
}

export const hunterProvider: SourcingProvider = {
  key: "hunter",
  displayName: "Hunter",
  capabilities: ["CONTACT_DISCOVERY", "EMAIL_VERIFICATION"],
  costRank: 1,
  configured: () => Boolean(key()),
  findContacts,
  verifyEmails,
};
