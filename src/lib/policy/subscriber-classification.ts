/**
 * PECR subscriber classification from a Companies House register entry.
 *
 * Pure, so the rule is unit-testable and stated once. `companies-house.ts`
 * performs the lookup; this decides what the result means.
 *
 * ## The rule (ICO, "How do we comply with the PECR electronic mail marketing
 * rules?", checked 2026-09-25 — docs/revenue-engine/01-evidence-register.md §2)
 *
 * Corporate subscribers are companies, **LLPs**, **Scottish partnerships** and
 * government bodies. Sole traders and other partnerships are *individual*
 * subscribers and need consent or a soft opt-in for unsolicited marketing.
 *
 * The line is legal personality. A Scottish partnership — including a Scottish
 * *limited* partnership — is a legal person distinct from its partners
 * (Partnership Act 1890 s4(2)). An English or Welsh limited partnership is not,
 * so it is classified PARTNERSHIP, which the UK pack refuses for cold outreach.
 *
 * Companies House uses one type, `limited-partnership`, for LPs in every
 * jurisdiction; the jurisdiction is in the company number prefix. Scottish LPs
 * are registered with `SL` numbers, English and Welsh ones with `LP`, and
 * Northern Irish ones with `NL`.
 */

export type RegistrySubscriberType = "CORPORATE" | "PARTNERSHIP" | "UNKNOWN";

/**
 * Register types that are legal persons for PECR purposes. Anything absent
 * yields UNKNOWN, never CORPORATE: a false "corporate" asserts an exemption that
 * does not apply.
 */
const CORPORATE_TYPES = new Set([
  "ltd",
  "plc",
  "llp",
  "private-limited-guarant-nsc",
  "private-limited-guarant-nsc-limited-exemption",
  "private-unlimited",
  "private-unlimited-nsc",
  "old-public-company",
  "private-limited-shares-section-30-exemption",
  "northern-ireland",
  "northern-ireland-other",
  "scottish-partnership",
  "royal-charter",
  "industrial-and-provident-society",
  "registered-society-non-jurisdictional",
  "community-interest-company",
  "charitable-incorporated-organisation",
  "scottish-charitable-incorporated-organisation",
]);

/** Types the register lists that are partnerships without legal personality. */
const PARTNERSHIP_TYPES = new Set(["limited-partnership"]);

/** True for any register type this module can classify at all. */
export function isRecognisedRegistryType(companyType: string | null | undefined): boolean {
  const type = (companyType ?? "").toLowerCase();
  return CORPORATE_TYPES.has(type) || PARTNERSHIP_TYPES.has(type);
}

export function subscriberTypeForRegistryEntry(
  companyType: string | null | undefined,
  companyNumber: string | null | undefined,
): RegistrySubscriberType {
  const type = (companyType ?? "").toLowerCase();

  if (PARTNERSHIP_TYPES.has(type)) {
    // A Scottish LP is a legal person; an English, Welsh or NI one is not.
    return /^SL/i.test((companyNumber ?? "").trim()) ? "CORPORATE" : "PARTNERSHIP";
  }

  if (CORPORATE_TYPES.has(type)) return "CORPORATE";
  return "UNKNOWN";
}
