"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import {
  createPublicRequest,
  verifyRequestToken,
} from "@/lib/data-rights/privacy-requests";
import { PRIVACY_REQUEST_TYPES } from "@/lib/data-rights/types";

/**
 * The public data-subject request form (/privacy-request).
 *
 * Public by necessity -- the person asking has no account -- so everything a
 * public endpoint needs is here: server-side validation, a rate limit keyed on
 * the caller's address, a honeypot and a minimum fill time, and a verification
 * email before anything is acted on. Nothing about whether an address is known
 * to ClientTurn is ever revealed: every valid submission gets the same answer.
 */

export type PrivacyRequestFormResult =
  | { ok: true; reference: string }
  | { ok: false; error: string; field?: string };

const MIN_FILL_SECONDS = 3;

const schema = z.object({
  type: z.enum(PRIVACY_REQUEST_TYPES, { message: "Choose what you would like us to do." }),
  name: z.string().trim().min(1, "Enter your name.").max(200),
  email: z.string().trim().max(320).pipe(z.email("Enter a valid email address.")),
  phone: z.string().trim().max(40).optional(),
  context: z.string().trim().max(2000).optional(),
  details: z.string().trim().max(4000).optional(),
  confirm: z.literal(true, { message: "Confirm that this request is about your own data." }),
});

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function submitPrivacyRequest(
  _previous: PrivacyRequestFormResult | null,
  formData: FormData,
): Promise<PrivacyRequestFormResult> {
  // Bot checks answer with a plausible success so a script learns nothing.
  const honeypot = formData.get("website_confirm");
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { ok: true, reference: "DSR-PENDING" };
  }
  const startedAt = Number(formData.get("startedAt"));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < MIN_FILL_SECONDS * 1000) {
    return { ok: true, reference: "DSR-PENDING" };
  }

  const parsed = schema.safeParse({
    type: text(formData, "type") ?? "",
    name: text(formData, "name") ?? "",
    email: text(formData, "email") ?? "",
    phone: text(formData, "phone"),
    context: text(formData, "context"),
    details: text(formData, "details"),
    confirm: formData.get("confirm") === "on",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Please check the form and try again.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }

  const limit = await checkRateLimit("privacy:request", clientIdentifier(await headers()));
  if (!limit.allowed) {
    return {
      ok: false,
      error:
        "Several requests have come from here recently. Please try again later, or email privacy@clientturn.co.uk.",
    };
  }

  try {
    const { reference } = await createPublicRequest({
      type: parsed.data.type,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      context: parsed.data.context,
      details: parsed.data.details,
    });
    return { ok: true, reference };
  } catch {
    return {
      ok: false,
      error: "We could not record your request. Please try again, or email privacy@clientturn.co.uk.",
    };
  }
}

export type VerifyResult = { ok: true; reference: string } | { ok: false; error: string };

/**
 * Confirms a request from its emailed link. A button on the page calls this,
 * rather than the page acting on GET, because mail scanners open links.
 */
export async function confirmPrivacyRequest(token: string): Promise<VerifyResult> {
  const parsed = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/).safeParse(token);
  const invalid: VerifyResult = {
    ok: false,
    error:
      "This link is not valid or has expired. Submit the request again, or email privacy@clientturn.co.uk.",
  };
  if (!parsed.success) return invalid;

  const limit = await checkRateLimit("privacy:verify", clientIdentifier(await headers()));
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  }

  try {
    const result = await verifyRequestToken(parsed.data);
    return result.ok ? { ok: true, reference: result.reference } : invalid;
  } catch {
    return { ok: false, error: "We could not confirm your request just now. Please try the link again." };
  }
}
