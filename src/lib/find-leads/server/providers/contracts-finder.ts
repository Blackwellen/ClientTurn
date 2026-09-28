import "server-only";
import {
  createContractsFinderClient,
  lookbackWindow,
  tenderSignals,
  type TenderNotice,
} from "../../contracts-finder";
import { providerFailure, type IntentResult, type ProviderResponse, type SourcingProvider } from "./types";

/**
 * Contracts Finder (UK public-sector tenders) as an INTENT source for the
 * catalogue's TENDER_PUBLISHED type. Free and keyless, so always configured;
 * the rules and the rate limit live in ../../contracts-finder.ts.
 *
 * One process-wide client holds the 5-minute rate-limit cooldown and the
 * request spacing, and one search per window is cached for ten minutes, so a
 * sourcing run checking hundreds of companies in batches reads the register
 * once rather than once per batch.
 */

const client = createContractsFinderClient({
  fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const CACHE_MS = 10 * 60_000;
let cache: { key: string; at: number; notices: TenderNotice[] } | null = null;

async function recentNotices(freshnessDays: number): Promise<{ ok: true; notices: TenderNotice[]; latencyMs: number } | { ok: false; response: ProviderResponse<IntentResult> }> {
  const started = Date.now();
  const now = new Date();
  const { from, to } = lookbackWindow(now, freshnessDays);
  // Keyed by day, so a run spanning minutes shares one read.
  const key = `${from.toISOString().slice(0, 10)}:${to.toISOString().slice(0, 13)}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return { ok: true, notices: cache.notices, latencyMs: 0 };
  const outcome = await client.search(from, to);
  const latencyMs = Date.now() - started;
  if (!outcome.ok) return { ok: false, response: providerFailure<IntentResult>(outcome.code, latencyMs) };
  cache = { key, at: Date.now(), notices: outcome.notices };
  return { ok: true, notices: outcome.notices, latencyMs };
}

export const contractsFinderProvider: SourcingProvider = {
  key: "contracts_finder",
  displayName: "Contracts Finder (UK public tenders)",
  capabilities: ["INTENT"],
  costRank: 2,
  configured: () => true,
  freeOfCharge: true,

  async fetchIntent(input) {
    // Only when a tender is something the run is looking for.
    const asked = input.wants?.types ? input.wants.types.includes("TENDER_PUBLISHED") : input.wants?.kinds.includes("TRIGGER_EVENT") ?? false;
    if (!asked || input.domains.length === 0) {
      return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
    }
    const keywords = input.categories.flatMap((category) => [category.name, ...category.keywords]);
    const read = await recentNotices(input.freshnessDays);
    if (!read.ok) return read.response;
    const records: IntentResult[] = tenderSignals({ notices: read.notices, domains: input.domains, keywords, now: new Date() }).map((signal) => ({
      category: null,
      domain: signal.domain,
      observedAt: signal.observedAt,
      strength: signal.strength,
      sourceUrl: signal.sourceUrl,
      evidence: signal.evidence,
    }));
    return { ok: true, records, costMinor: 0, cursor: null, latencyMs: read.latencyMs, errorCode: null };
  },
};
