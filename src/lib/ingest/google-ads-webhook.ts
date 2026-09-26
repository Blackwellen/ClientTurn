/**
 * The Google Ads lead-form webhook payload (01-evidence-register §4, Google's
 * implementation guide of 5 May 2026) and its mapping onto IngestInput. Pure,
 * so the mapping and the key comparison are unit-tested.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { IngestInput } from "./types.ts";

const idLike = z.union([z.string().trim().min(1).max(100), z.number().int().nonnegative()]);

export const googleAdsWebhookSchema = z.object({
  lead_id: z.string().trim().min(1).max(200),
  api_version: z.string().max(20).optional(),
  form_id: idLike.optional(),
  campaign_id: idLike.optional(),
  adgroup_id: idLike.optional(),
  creative_id: idLike.optional(),
  google_key: z.string().max(500),
  is_test: z.boolean().optional(),
  gcl_id: z.string().max(300).optional(),
  lead_submit_time: z.string().max(60).optional(),
  user_column_data: z
    .array(
      z.object({
        column_id: z.string().max(100).optional(),
        column_name: z.string().max(200).optional(),
        string_value: z.string().max(2000).optional(),
      }),
    )
    .max(100)
    .default([]),
});

export type GoogleAdsWebhook = z.infer<typeof googleAdsWebhookSchema>;

/**
 * Constant-time comparison of the `google_key` in the body with the key
 * stored for the integration. Both sides are hashed first so the comparison
 * is over equal-length buffers and a length difference leaks nothing.
 */
export function googleKeyMatches(supplied: string, stored: string | null | undefined): boolean {
  if (!stored || !supplied) return false;
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(stored, "utf8").digest();
  return timingSafeEqual(a, b);
}

const PERSON_COLUMNS: Record<string, "firstName" | "lastName" | "fullName" | "email" | "phone" | "postcode" | "companyName" | "roleTitle"> = {
  FULL_NAME: "fullName",
  FIRST_NAME: "firstName",
  LAST_NAME: "lastName",
  EMAIL: "email",
  WORK_EMAIL: "email",
  PHONE_NUMBER: "phone",
  WORK_PHONE: "phone",
  POSTAL_CODE: "postcode",
  ZIP_CODE: "postcode",
  COMPANY_NAME: "companyName",
  JOB_TITLE: "roleTitle",
};

function stringId(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

export function googleAdsWebhookToIngest(businessId: string, integrationId: string, body: GoogleAdsWebhook): IngestInput {
  const person: Record<string, string> = {};
  const answers: Record<string, string> = {};

  for (const column of body.user_column_data) {
    const value = column.string_value?.trim();
    if (!value) continue;
    const mapped = column.column_id ? PERSON_COLUMNS[column.column_id.toUpperCase()] : undefined;
    if (mapped) {
      person[mapped] ??= value;
    } else {
      const key = (column.column_name || column.column_id || `Answer ${Object.keys(answers).length + 1}`).slice(0, 200);
      answers[key] = value;
    }
  }

  if (person.fullName && !person.firstName && !person.lastName) {
    const [first, ...rest] = person.fullName.split(/\s+/);
    person.firstName = first;
    if (rest.length) person.lastName = rest.join(" ");
  }

  return {
    businessId,
    source: {
      type: "AD_FORM",
      provider: "google_ads",
      providerRecordId: body.lead_id,
      formId: stringId(body.form_id),
      campaignId: stringId(body.campaign_id),
      adsetId: stringId(body.adgroup_id),
      adId: stringId(body.creative_id),
      gclid: body.gcl_id,
      submittedAt: body.lead_submit_time,
      caller: { type: "SYSTEM", id: `google_ads_webhook:${integrationId}` },
    },
    person: {
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      phone: person.phone,
      postcode: person.postcode,
      companyName: person.companyName,
      roleTitle: person.roleTitle,
    },
    ...(Object.keys(answers).length ? { answers } : {}),
  };
}
