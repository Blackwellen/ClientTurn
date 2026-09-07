"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { COMPANY_SIZES, LEAD_VOLUME_OPTIONS, USE_CASES, CURRENT_SYSTEMS } from "@/lib/marketing/sales-enquiry-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordMarketingEvent } from "@/lib/marketing/record";

/**
 * The sales enquiry form.
 *
 * Deliberately short. Security questionnaires, integration inventories and
 * procurement paperwork come after a conversation — asking for them on the
 * first screen costs more enquiries than the qualification is worth.
 *
 * The client cannot be trusted with any of this: every field is re-validated
 * here, the rate limit is keyed on a hash of the caller's address rather than
 * anything the form submits, and the bot checks are server-evaluated.
 */

export type EnquiryResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

/** How long a form must have been on screen before a submission is credible. */
const MIN_FILL_SECONDS = 3;

/** Submissions allowed from one address in the window below. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MINUTES = 60;

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(80),
  lastName: z.string().trim().min(1, "Enter your last name.").max(80),
  email: z
    .string()
    .trim()
    .max(200)
    .pipe(z.email("Enter a valid work email address.")),
  company: z.string().trim().min(2, "Enter your company name.").max(160),
  website: z.string().trim().max(300).optional(),
  companySize: z.enum(COMPANY_SIZES, {
    message: "Choose your company size.",
  }),
  leadVolume: z.enum(LEAD_VOLUME_OPTIONS, {
    message: "Choose an estimated monthly lead or prospect volume.",
  }),
  useCase: z.enum(USE_CASES, { message: "Choose a primary use case." }),
  currentSystems: z.array(z.enum(CURRENT_SYSTEMS)).max(CURRENT_SYSTEMS.length),
  message: z.string().trim().max(1000).optional(),
  marketingConsent: z.boolean(),
  anonymousId: z.string().trim().max(64).optional(),
  utmSource: z.string().trim().max(200).optional(),
  utmMedium: z.string().trim().max(200).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  referrer: z.string().trim().max(500).optional(),
  landingPath: z.string().trim().max(500).optional(),
});

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A stable, non-reversible key for the caller.
 *
 * We rate-limit on this rather than on an email address or a session id, both
 * of which a bot controls. The hash means the enquiry log never holds a raw IP.
 */
async function callerKey(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0]?.trim() || store.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`contact-sales:${address}`).digest("hex").slice(0, 32);
}

/** True when this caller has already submitted more than the window allows. */
async function overRateLimit(key: string): Promise<boolean> {
  const since = new Date(
    Date.now() - RATE_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("marketing_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "sales_enquiry")
      .eq("metadata->>caller", key)
      .gte("occurred_at", since);

    if (error) return false;
    return (count ?? 0) >= RATE_LIMIT;
  } catch {
    // A limiter that cannot read must not become an outage on the form. The
    // honeypot and timing checks still apply.
    return false;
  }
}

export async function submitSalesEnquiry(
  _previous: EnquiryResult | null,
  formData: FormData,
): Promise<EnquiryResult> {
  /*
   * Bot checks first, so an obvious bot never reaches validation or the
   * database. Both are silent successes: telling a script which check it
   * failed is telling it how to pass next time.
   */
  const honeypot = formData.get("company_website_confirm");
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { ok: true };
  }

  const startedAt = Number(formData.get("startedAt"));
  if (
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    Date.now() - startedAt < MIN_FILL_SECONDS * 1000
  ) {
    return { ok: true };
  }

  const parsed = schema.safeParse({
    firstName: text(formData, "firstName") ?? "",
    lastName: text(formData, "lastName") ?? "",
    email: text(formData, "email") ?? "",
    company: text(formData, "company") ?? "",
    website: text(formData, "website"),
    companySize: text(formData, "companySize") ?? "",
    leadVolume: text(formData, "leadVolume") ?? "",
    useCase: text(formData, "useCase") ?? "",
    currentSystems: formData
      .getAll("currentSystems")
      .filter((value): value is string => typeof value === "string"),
    message: text(formData, "message"),
    marketingConsent: formData.get("marketingConsent") === "on",
    anonymousId: text(formData, "anonymousId"),
    utmSource: text(formData, "utmSource"),
    utmMedium: text(formData, "utmMedium"),
    utmCampaign: text(formData, "utmCampaign"),
    utmContent: text(formData, "utmContent"),
    utmTerm: text(formData, "utmTerm"),
    referrer: text(formData, "referrer"),
    landingPath: text(formData, "landingPath"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Please check the form and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const input = parsed.data;
  const key = await callerKey();

  if (await overRateLimit(key)) {
    return {
      ok: false,
      error:
        "You have sent several enquiries recently. Email us directly and we will pick it up from there.",
    };
  }

  try {
    await recordMarketingEvent({
      eventName: "sales_enquiry",
      ctaPlacement: "contact_sales_form",
      metadata: {
        caller: key,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        company: input.company,
        website: input.website ?? null,
        company_size: input.companySize,
        lead_volume: input.leadVolume,
        use_case: input.useCase,
        current_systems: input.currentSystems,
        message: input.message ?? null,
        // Recorded separately from the enquiry itself. Consenting to be
        // contacted about this enquiry is not consenting to marketing.
        marketing_consent: input.marketingConsent,
      },
      session: {
        anonymousId: input.anonymousId,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        utmContent: input.utmContent,
        utmTerm: input.utmTerm,
        referrer: input.referrer,
        landingPath: input.landingPath,
      },
    });
  } catch {
    return {
      ok: false,
      error:
        "We could not submit your enquiry. Please try again, or email sales directly.",
    };
  }

  return { ok: true };
}
