"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runForUser } from "@/lib/quotes/run-action";
import type { QuoteActionResult } from "@/lib/quotes/action-result";
import { DISMISS_RESOLUTIONS, type DismissResolution } from "./payment-review";

/**
 * Settings -> Quotes & invoices -> Payments to review. Each is one service
 * operation for the signed-in person: the runtime re-checks the role (owner or
 * admin), validates, requires the confirmation the apply dialog gives, and
 * audits. Inputs are validated here too so a malformed call never reaches it.
 */

const applyInput = z.object({ paymentId: z.string().uuid(), invoiceId: z.string().uuid() });
const dismissInput = z.object({
  paymentId: z.string().uuid(),
  resolution: z.enum(DISMISS_RESOLUTIONS as [DismissResolution, ...DismissResolution[]]),
  note: z.string().trim().max(500).optional(),
});

function refresh() {
  revalidatePath("/app/settings");
}

/** Called from the apply confirmation dialog. */
export async function applyReviewPaymentAction(input: unknown): Promise<QuoteActionResult> {
  const parsed = applyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the invoice this payment is for.", code: "INVALID_INPUT" };
  const result = await runForUser("invoice.review_apply_payment", parsed.data, { confirmed: true });
  if (result.ok) refresh();
  return result;
}

export async function dismissReviewPaymentAction(input: unknown): Promise<QuoteActionResult> {
  const parsed = dismissInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose what happened to this payment.", code: "INVALID_INPUT" };
  const result = await runForUser("invoice.review_dismiss_payment", parsed.data);
  if (result.ok) refresh();
  return result;
}
