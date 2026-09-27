/**
 * Destination rules for outbound voice: E.164 normalisation, UK number-range
 * classification, a per-destination cost-rate lookup and a max-rate cap.
 *
 * Pure. No `server-only`, no Supabase, no network. Safe for tests and for any
 * shared code (the dial job, the eligibility gate, the settings preview).
 *
 * Sources (docs/revenue-engine/12-voice-provider-research.md §4, retrieved
 * 2026-09-27): Twilio UK Programmable Voice and Elastic SIP outbound rates, and
 * the Ofcom number ranges. Twilio publishes no prefix-to-route map, so which
 * prefixes Twilio prices as "Special Services", "Surcharged" or "Mobile Other"
 * is UNVERIFIED. That is why the prefix rule is paired with a rate cap: the cap
 * is applied to the provider's looked-up price when one is supplied, which
 * catches a `+447` number Twilio prices as "Mobile Other" ($0.32/min) that no
 * prefix rule can see.
 */

export const DESTINATION_CLASSES = [
  "UK_GEOGRAPHIC",
  "UK_MOBILE",
  "NON_GEO_03",
  "BLOCKED_PREMIUM",
  "BLOCKED_PERSONAL_070",
  "BLOCKED_PAGER_076",
  "BLOCKED_SPECIAL_084_087_09_118",
  "TOLL_FREE_080",
  "NON_UK",
] as const;
export type DestinationClass = (typeof DESTINATION_CLASSES)[number];

/** Classes an outbound call may reach without any further permission. */
export const DIALLABLE_CLASSES: readonly DestinationClass[] = [
  "UK_GEOGRAPHIC",
  "UK_MOBILE",
  "NON_GEO_03",
];

export type NormaliseResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "EMPTY" | "INVALID_CHARACTERS" | "INVALID_LENGTH" | "UNSUPPORTED_FORMAT" };

/**
 * Normalise a human-entered phone number to E.164.
 *
 * Accepts the shapes UK lead forms produce: `07700 900123`, `+44 (0)7700 900123`,
 * `0044 7700 900123`, `447700900123`, `+447700900123`. A leading national `0`
 * is read against `defaultCountry` (only GB is supported; any other default
 * needs an explicit `+` prefix, because guessing a trunk prefix abroad is how
 * calls go to the wrong person).
 */
export function normaliseE164(raw: string | null | undefined, defaultCountry: "GB" = "GB"): NormaliseResult {
  if (raw == null) return { ok: false, reason: "EMPTY" };
  let s = String(raw).trim();
  if (s === "") return { ok: false, reason: "EMPTY" };

  // "+44 (0)20 ..." : the bracketed trunk zero is dropped before anything else.
  s = s.replace(/\(\s*0\s*\)/g, "");
  // Separators people type.
  s = s.replace(/[\s.\-()/ ]/g, "");
  if (!/^\+?\d+$/.test(s)) return { ok: false, reason: "INVALID_CHARACTERS" };

  let e164: string;
  if (s.startsWith("+")) {
    e164 = s;
  } else if (s.startsWith("00")) {
    e164 = `+${s.slice(2)}`;
  } else if (s.startsWith("44") && (s.length === 12 || s.length === 11)) {
    e164 = `+${s}`;
  } else if (s.startsWith("0") && defaultCountry === "GB") {
    e164 = `+44${s.slice(1)}`;
  } else {
    return { ok: false, reason: "UNSUPPORTED_FORMAT" };
  }

  // A stray trunk zero after the country code: +4407700... -> +447700...
  if (e164.startsWith("+440")) e164 = `+44${e164.slice(4)}`;

  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return { ok: false, reason: "INVALID_LENGTH" };
  if (e164.startsWith("+44")) {
    const nsn = e164.slice(3);
    // UK national significant numbers are 10 digits, with a handful of 9-digit
    // geographic numbers, 7-digit 0800 1111 style freephone and 6-digit 118 numbers.
    if (nsn.length < 6 || nsn.length > 10) return { ok: false, reason: "INVALID_LENGTH" };
  }
  return { ok: true, e164 };
}

/**
 * Classify an E.164 number by UK number range (Ofcom).
 *
 * `+4409...` never occurs after normalisation. `09` premium rate is reported as
 * BLOCKED_PREMIUM (the Twilio "Premium Services" row, $1.0479/min), the more
 * severe of the two classes whose names cover it; 084, 087 and 118 are
 * BLOCKED_SPECIAL_084_087_09_118. 055, 056, 0500 and any range Ofcom has not
 * allocated for calling are also BLOCKED_PREMIUM: unrecognised means unpriced,
 * and unpriced fails closed.
 *
 * `+447624` (Isle of Man mobile) sits inside the 076 pager range by prefix and
 * is blocked with it. Twilio likely prices it as "Mobile Other" (UNVERIFIED).
 */
export function classifyDestination(e164: string): DestinationClass {
  if (!e164.startsWith("+44")) return "NON_UK";
  const n = e164.slice(3);
  // 118 xxx directory enquiries and 116 xxx harmonised services are 6-digit
  // numbers. 0118 (Reading) is a 10-digit geographic number, so length decides.
  if (n.length === 6 && (n.startsWith("118") || n.startsWith("116"))) return "BLOCKED_SPECIAL_084_087_09_118";
  if (n.startsWith("1") || n.startsWith("2")) return "UK_GEOGRAPHIC";
  if (n.startsWith("3")) return "NON_GEO_03";
  if (n.startsWith("70")) return "BLOCKED_PERSONAL_070";
  if (n.startsWith("76")) return "BLOCKED_PAGER_076";
  if (n.startsWith("7")) return "UK_MOBILE";
  if (n.startsWith("800") || n.startsWith("808")) return "TOLL_FREE_080";
  if (n.startsWith("84") || n.startsWith("87")) {
    return "BLOCKED_SPECIAL_084_087_09_118";
  }
  if (n.startsWith("9")) return "BLOCKED_PREMIUM";
  // 055, 056, 0500 and unallocated ranges (04, 06, 080x other than 800/808, ...).
  return "BLOCKED_PREMIUM";
}

export type VoiceRoute = "PROGRAMMABLE_VOICE" | "ELASTIC_SIP";

export type RateRow = { programmableVoice: number; elasticSip: number | null };

/**
 * USD per minute, Twilio UK outbound (research doc §4, 2026-09-27).
 * `null` means no published price for that route: the class is unpriced.
 *
 * NON_GEO_03 uses the geographic row. Ofcom prices 03 like 01/02 for callers;
 * Twilio's own route for 03 is UNVERIFIED.
 * BLOCKED_SPECIAL uses the "Special Services" row, the conservative of the two
 * special rows. BLOCKED_PAGER_076 and NON_UK have no row.
 */
export const DEFAULT_RATE_TABLE_USD: Readonly<Record<DestinationClass, RateRow | null>> = {
  UK_GEOGRAPHIC: { programmableVoice: 0.0158, elasticSip: 0.0118 },
  UK_MOBILE: { programmableVoice: 0.0305, elasticSip: 0.0265 },
  NON_GEO_03: { programmableVoice: 0.0158, elasticSip: 0.0118 },
  TOLL_FREE_080: { programmableVoice: 0.0798, elasticSip: null },
  BLOCKED_PERSONAL_070: { programmableVoice: 0.5577, elasticSip: 0.5537 },
  BLOCKED_SPECIAL_084_087_09_118: { programmableVoice: 0.2625, elasticSip: 0.2585 },
  BLOCKED_PREMIUM: { programmableVoice: 1.0479, elasticSip: 1.0439 },
  BLOCKED_PAGER_076: null,
  NON_UK: null,
};

/** Per-call rate cap, USD/min (research doc §4 recommendation). */
export const DEFAULT_MAX_RATE_USD_PER_MIN = 0.04;

export function lookupRate(
  cls: DestinationClass,
  route: VoiceRoute = "ELASTIC_SIP",
  table: Readonly<Record<DestinationClass, RateRow | null>> = DEFAULT_RATE_TABLE_USD,
): number | null {
  const row = table[cls];
  if (!row) return null;
  return route === "ELASTIC_SIP" ? row.elasticSip : row.programmableVoice;
}

export type RateCapResult =
  | { allowed: true; rateUsdPerMin: number }
  | { allowed: false; reason: "UNPRICED" | "RATE_ABOVE_CAP"; rateUsdPerMin: number | null };

/**
 * The cap check. `providerRate` (a live price lookup for this exact number),
 * when given, wins over the class table: it is the only way to see a
 * surcharged `+447` number.
 */
export function checkRateCap(input: {
  cls: DestinationClass;
  route?: VoiceRoute;
  capUsdPerMin?: number;
  providerRate?: number | null;
  table?: Readonly<Record<DestinationClass, RateRow | null>>;
}): RateCapResult {
  const cap = input.capUsdPerMin ?? DEFAULT_MAX_RATE_USD_PER_MIN;
  const rate =
    input.providerRate != null ? input.providerRate : lookupRate(input.cls, input.route, input.table);
  if (rate == null || !Number.isFinite(rate)) return { allowed: false, reason: "UNPRICED", rateUsdPerMin: null };
  if (rate > cap) return { allowed: false, reason: "RATE_ABOVE_CAP", rateUsdPerMin: rate };
  return { allowed: true, rateUsdPerMin: rate };
}

export type DestinationDenial =
  | "INVALID_NUMBER"
  | "NON_UK"
  | "BLOCKED_RANGE"
  | "TOLL_FREE_NOT_PERMITTED"
  | "UNPRICED"
  | "RATE_ABOVE_CAP";

export type DestinationAssessment =
  | { dialable: true; e164: string; cls: DestinationClass; rateUsdPerMin: number }
  | {
      dialable: false;
      e164: string | null;
      cls: DestinationClass | null;
      reason: DestinationDenial;
      rateUsdPerMin: number | null;
    };

/**
 * The full outbound decision for one number: normalise, classify, then price.
 *
 * TOLL_FREE_080 is blocked unless `allowPricedTollFree` is set, and then it
 * must still pass the rate cap (at the default $0.04 cap it never does:
 * $0.0798). Everything in a BLOCKED_* class and NON_UK is refused regardless of
 * price.
 */
export function assessDestination(
  raw: string | null | undefined,
  opts: {
    route?: VoiceRoute;
    capUsdPerMin?: number;
    providerRate?: number | null;
    allowPricedTollFree?: boolean;
    table?: Readonly<Record<DestinationClass, RateRow | null>>;
  } = {},
): DestinationAssessment {
  const norm = normaliseE164(raw);
  if (!norm.ok) return { dialable: false, e164: null, cls: null, reason: "INVALID_NUMBER", rateUsdPerMin: null };
  const cls = classifyDestination(norm.e164);
  const deny = (reason: DestinationDenial, rate: number | null = null): DestinationAssessment => ({
    dialable: false,
    e164: norm.e164,
    cls,
    reason,
    rateUsdPerMin: rate,
  });

  if (cls === "NON_UK") return deny("NON_UK");
  if (cls === "TOLL_FREE_080" && !opts.allowPricedTollFree) return deny("TOLL_FREE_NOT_PERMITTED");
  if (cls !== "TOLL_FREE_080" && !DIALLABLE_CLASSES.includes(cls)) return deny("BLOCKED_RANGE");

  const cap = checkRateCap({
    cls,
    route: opts.route,
    capUsdPerMin: opts.capUsdPerMin,
    providerRate: opts.providerRate,
    table: opts.table,
  });
  if (!cap.allowed) return deny(cap.reason, cap.rateUsdPerMin);
  return { dialable: true, e164: norm.e164, cls, rateUsdPerMin: cap.rateUsdPerMin };
}

/** SMS can only reach a UK mobile (geographic and 03 numbers cannot take SMS). */
export function isSmsCapableDestination(e164: string): boolean {
  return classifyDestination(e164) === "UK_MOBILE";
}
