/**
 * Sending-domain DNS health (Phase 3.5, 01 §6).
 *
 * Pure: the job (jobs/handlers/domain-health.ts) does the DNS lookups and
 * hands the TXT records here, so every verdict is asserted in
 * tests/channels-phase3.test.ts without a network.
 *
 * States match `domain_health_snapshots` (0029): PASS | FAIL | MISSING | UNKNOWN.
 *   * SPF    one `v=spf1` record = PASS; none = MISSING; more than one, or a
 *            record ending in `+all` (anyone may send as you) = FAIL.
 *   * DMARC  a `v=DMARC1` record at `_dmarc.<domain>` = PASS with its `p=`
 *            policy; none = MISSING; one with no valid policy = FAIL.
 *   * DKIM   only probed when a selector is configured (DKIM keys live at
 *            `<selector>._domainkey.<domain>` and cannot be discovered): a key
 *            with a non-empty `p=` = PASS; `p=` empty (revoked) = FAIL; no
 *            record = MISSING; no selector configured = UNKNOWN.
 *   * A lookup that failed for a reason other than "no such record" is
 *     UNKNOWN, never MISSING: a DNS timeout is not evidence a record is absent.
 */

export type DnsState = "PASS" | "FAIL" | "MISSING" | "UNKNOWN";

/** TXT records as node:dns returns them (each record is chunked strings). */
export type TxtLookup =
  | { ok: true; records: string[][] }
  | { ok: false; notFound: boolean };

function joined(lookup: TxtLookup): string[] {
  return lookup.ok ? lookup.records.map((chunks) => chunks.join("").trim()) : [];
}

export function spfState(lookup: TxtLookup): DnsState {
  if (!lookup.ok) return lookup.notFound ? "MISSING" : "UNKNOWN";
  const spf = joined(lookup).filter((record) => /^v=spf1(\s|$)/i.test(record));
  if (spf.length === 0) return "MISSING";
  if (spf.length > 1) return "FAIL"; // RFC 7208 §4.5: multiple records = permerror
  if (/\s\+all\s*$/i.test(spf[0])) return "FAIL";
  return "PASS";
}

export function dmarcState(lookup: TxtLookup): { state: DnsState; policy: string | null } {
  if (!lookup.ok) return { state: lookup.notFound ? "MISSING" : "UNKNOWN", policy: null };
  const dmarc = joined(lookup).filter((record) => /^v=DMARC1\s*(;|$)/i.test(record));
  if (dmarc.length === 0) return { state: "MISSING", policy: null };
  if (dmarc.length > 1) return { state: "FAIL", policy: null };
  const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i.exec(dmarc[0])?.[1]?.toLowerCase() ?? null;
  return policy ? { state: "PASS", policy } : { state: "FAIL", policy: null };
}

export function dkimState(selector: string | null, lookup: TxtLookup | null): DnsState {
  if (!selector || !lookup) return "UNKNOWN";
  if (!lookup.ok) return lookup.notFound ? "MISSING" : "UNKNOWN";
  const key = joined(lookup).find((record) => /(?:^|;)\s*p\s*=/i.test(record));
  if (!key) return "MISSING";
  const value = /(?:^|;)\s*p\s*=\s*([^;]*)/i.exec(key)?.[1]?.trim() ?? "";
  return value ? "PASS" : "FAIL";
}

/** The sending domain of an address, lower-cased; null if it has none. */
export function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? "").lastIndexOf("@");
  if (at < 0) return null;
  const domain = email!.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}
