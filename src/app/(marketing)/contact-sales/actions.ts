"use server";

import { z } from "zod";
import { recordMarketingEvent } from "@/lib/marketing/record";

export type EnquiryResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export const LEAD_VOLUME_OPTIONS = [
  "Under 250",
  "250 – 750",
  "750 – 2,000",
  "2,000 – 5,000",
  "More than 5,000",
] as const;

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .pipe(z.email("Enter a valid work email address.")),
  company: z.string().trim().min(2, "Enter your company name.").max(160),
  phone: z.string().trim().min(6, "Enter a contact number.").max(40),
  leadVolume: z.enum(LEAD_VOLUME_OPTIONS, {
    message: "Choose an estimated monthly lead volume.",
  }),
  message: z.string().trim().max(2000).optional(),
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

export async function submitEnterpriseEnquiry(
  _previous: EnquiryResult | null,
  formData: FormData,
): Promise<EnquiryResult> {
  const parsed = schema.safeParse({
    name: text(formData, "name") ?? "",
    email: text(formData, "email") ?? "",
    company: text(formData, "company") ?? "",
    phone: text(formData, "phone") ?? "",
    leadVolume: text(formData, "leadVolume") ?? "",
    message: text(formData, "message"),
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

  try {
    await recordMarketingEvent({
      eventName: "enterprise_enquiry",
      ctaPlacement: "contact_sales_form",
      metadata: {
        name: input.name,
        email: input.email,
        company: input.company,
        phone: input.phone,
        lead_volume: input.leadVolume,
        message: input.message ?? null,
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
