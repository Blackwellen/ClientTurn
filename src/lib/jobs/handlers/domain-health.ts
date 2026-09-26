import "server-only";
import { resolveTxt } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { dkimState, dmarcState, domainOf, spfState, type TxtLookup } from "@/lib/email/dns-health";

/**
 * `domain.health_check` (Phase 3.5): once a day, the real SPF / DMARC state of
 * every active sending domain, plus a DKIM probe where a selector is set, into
 * `domain_health_snapshots` -- so deliverability shows what DNS actually says
 * rather than a default of UNKNOWN (01 §6, gap in 00 §2.5).
 *
 * Only the DNS columns are written. The send/bounce/complaint counts and the
 * health state on the same row belong to the complaint recorder, and an upsert
 * that named them would reset them to zero.
 */

// sender_identities.dkim_selector (0125) post-dates the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
const LOOKUP_TIMEOUT_MS = 5_000;

async function txt(name: string): Promise<TxtLookup> {
  try {
    const records = await Promise.race([
      resolveTxt(name),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), LOOKUP_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, records };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    return { ok: false, notFound: NOT_FOUND.has(code) };
  }
}

type SenderRow = {
  business_id: string;
  email: string;
  domain: string | null;
  dkim_selector: string | null;
};

export async function handleDomainHealthCheck(_job: ClaimedJob): Promise<void> {
  const { data, error } = await db()
    .from("sender_identities")
    .select("business_id, email, domain, dkim_selector")
    .eq("active", true)
    .limit(2000);
  if (error) throw error;

  // One probe per (workspace, domain); a selector from any sender on the
  // domain is enough to probe DKIM.
  const targets = new Map<string, { businessId: string; domain: string; selector: string | null }>();
  for (const row of (data ?? []) as SenderRow[]) {
    const domain = (row.domain ?? domainOf(row.email))?.toLowerCase();
    if (!domain) continue;
    const key = `${row.business_id}:${domain}`;
    const existing = targets.get(key);
    targets.set(key, {
      businessId: row.business_id,
      domain,
      selector: existing?.selector ?? row.dkim_selector ?? null,
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const target of targets.values()) {
    const [spf, dmarc, dkim] = await Promise.all([
      txt(target.domain),
      txt(`_dmarc.${target.domain}`),
      target.selector ? txt(`${target.selector}._domainkey.${target.domain}`) : Promise.resolve(null),
    ]);
    const dmarcVerdict = dmarcState(dmarc);

    logWriteError(
      await db()
        .from("domain_health_snapshots")
        .upsert(
          {
            business_id: target.businessId,
            domain: target.domain,
            snapshot_date: today,
            spf_state: spfState(spf),
            dkim_state: dkimState(target.selector, dkim),
            dmarc_state: dmarcVerdict.state,
            dmarc_policy: dmarcVerdict.policy,
          },
          { onConflict: "business_id,domain,snapshot_date" },
        ),
      "domain health: write snapshot",
      { businessId: target.businessId, domain: target.domain },
    );
  }
}
