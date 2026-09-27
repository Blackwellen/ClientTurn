/**
 * The details a workspace gives once, so its dedicated number can be
 * provisioned with no manual step per customer. Pure.
 *
 * Reuses the OD-1 identity (identity.ts): calling_as_name, legal_entity_name,
 * identification_contact. Adds what Twilio's GB mobile regulation asks of a
 * business end user (guideline page read 2026-09-27): registration authority
 * and number, website, a business address (any country for mobile), and an
 * authorised representative with a phone and a work email. No supporting
 * documents are required for UK mobile numbers.
 *
 * UNVERIFIED: the business-classification value an ISV should give for its
 * customers' numbers. The default is DIRECT_CUSTOMER (each workspace is the
 * end user of its own number); confirm with Twilio before the first live
 * submission.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { identityReadiness, type IdentityProblem } from "../identity.ts";
import { normaliseE164 } from "../destinations.ts";
import type { BundleSubmission } from "../providers/types.ts";

/**
 * Companies House numbers: 8 digits, or a 2-letter prefix and 6 digits
 * (SC Scotland, NI Northern Ireland, OC/SO/NC LLPs, ...). Leading zeros kept.
 */
export const COMPANY_NUMBER = /^(\d{8}|[A-Z]{2}\d{6})$/;

export const registeredAddressSchema = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().max(80).nullable().optional(),
  postcode: z.string().trim().min(2).max(12),
  /** ISO 3166-1 alpha-2. Any country is accepted for a UK MOBILE number. */
  country: z.string().regex(/^[A-Z]{2}$/),
});

export const provisioningDetailsSchema = z.object({
  callingAsName: z.string().trim().min(1).max(80),
  legalEntityName: z.string().trim().min(1).max(160),
  identificationContact: z.string().trim().min(1).max(300),
  personaName: z.string().trim().max(40).nullable().optional(),
  companyNumber: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
    .pipe(z.string().regex(COMPANY_NUMBER, "Companies House number: 8 digits or 2 letters and 6 digits")),
  registrationAuthority: z.string().trim().min(1).default("Companies House"),
  websiteUrl: z.string().url(),
  registeredAddress: registeredAddressSchema,
  representative: z.object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(5),
    workEmail: z.string().email(),
  }),
  /** Where Twilio sends bundle status emails (a platform ops mailbox by default). */
  notificationEmail: z.string().email(),
  businessClassification: z.enum(["DIRECT_CUSTOMER", "ISV_RESELLER"]).default("DIRECT_CUSTOMER"),
});
export type ProvisioningDetails = z.infer<typeof provisioningDetailsSchema>;

export type DetailsProblem =
  | { field: string; problem: "INVALID"; message: string }
  | ({ source: "IDENTITY" } & IdentityProblem)
  | { field: "representative.phone"; problem: "INVALID_PHONE" };

export type DetailsReadiness = { ready: true; details: ProvisioningDetails } | { ready: false; problems: DetailsProblem[] };

export function provisioningReadiness(input: unknown): DetailsReadiness {
  const problems: DetailsProblem[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;
  const id = identityReadiness({
    callingAsName: obj.callingAsName as string | undefined,
    legalEntityName: obj.legalEntityName as string | undefined,
    identificationContact: obj.identificationContact as string | undefined,
    personaName: obj.personaName as string | undefined,
  });
  if (!id.ready) for (const p of id.problems) problems.push({ source: "IDENTITY", ...p });

  const parsed = provisioningDetailsSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      // Identity fields are already reported with a precise reason above.
      if (["callingAsName", "legalEntityName", "identificationContact", "personaName"].includes(field) && !id.ready) continue;
      problems.push({ field, problem: "INVALID", message: issue.message });
    }
  } else if (!normaliseE164(parsed.data.representative.phone).ok) {
    problems.push({ field: "representative.phone", problem: "INVALID_PHONE" });
  }
  if (problems.length || !parsed.success) return { ready: false, problems };
  return { ready: true, details: parsed.data };
}

/**
 * A stable fingerprint of the fields Twilio reviews. A rejected bundle is only
 * resubmitted once this changes (the customer fixed something), so a retry
 * loop never resubmits the same rejected data.
 */
export function detailsFingerprint(d: ProvisioningDetails): string {
  const reviewed = {
    legalEntityName: d.legalEntityName,
    companyNumber: d.companyNumber,
    registrationAuthority: d.registrationAuthority,
    websiteUrl: d.websiteUrl,
    registeredAddress: d.registeredAddress,
    representative: d.representative,
    businessClassification: d.businessClassification,
  };
  return createHash("sha256").update(JSON.stringify(reviewed)).digest("hex").slice(0, 32);
}

export function toBundleSubmission(
  d: ProvisioningDetails,
  ctx: { accountSid: string; businessId: string; statusCallbackUrl: string },
): BundleSubmission {
  const phone = normaliseE164(d.representative.phone);
  return {
    accountSid: ctx.accountSid,
    friendlyName: `ct-${ctx.businessId}-gb-mobile`,
    notificationEmail: d.notificationEmail,
    statusCallbackUrl: ctx.statusCallbackUrl,
    isoCountry: "GB",
    numberType: "mobile",
    endUserType: "business",
    endUser: {
      businessName: d.legalEntityName,
      registrationAuthority: d.registrationAuthority,
      businessRegistrationNumber: d.companyNumber,
      websiteUrl: d.websiteUrl,
      businessClassification: d.businessClassification,
      representative: {
        firstName: d.representative.firstName,
        lastName: d.representative.lastName,
        phoneE164: phone.ok ? phone.e164 : d.representative.phone,
        workEmail: d.representative.workEmail,
      },
    },
    address: {
      customerName: d.legalEntityName,
      street: d.registeredAddress.line1,
      streetSecondary: d.registeredAddress.line2 ?? null,
      city: d.registeredAddress.city,
      region: d.registeredAddress.region ?? null,
      postalCode: d.registeredAddress.postcode,
      isoCountry: d.registeredAddress.country,
    },
    documents: [],
  };
}
