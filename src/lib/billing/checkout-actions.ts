"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createCreditCheckout, createSubscriptionCheckout, type UrlOutcome } from "./checkout";

/**
 * Buying things. Owner-only: each of these can put a charge on the card.
 * Nothing here grants anything -- Stripe's confirmation (webhook, or the
 * Checkout return page reading the session back) is what does.
 */

const trialSchema = z.object({
  plan: z.enum(["starter", "growth", "pro"]),
  interval: z.enum(["month", "year"]),
});

export async function startTrialCheckout(input: unknown): Promise<UrlOutcome> {
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan to continue." };

  const workspace = await requireRole("owner").catch(() => null);
  if (!workspace) return { ok: false, error: "Only the workspace owner can start the subscription." };

  return createSubscriptionCheckout(workspace, parsed.data.plan, parsed.data.interval);
}

const creditSchema = z.object({ bundleKey: z.string().min(1).max(40) });

export async function startCreditPurchase(input: unknown): Promise<UrlOutcome> {
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a bundle to continue." };

  const workspace = await requireRole("owner").catch(() => null);
  if (!workspace) return { ok: false, error: "Only the workspace owner can buy credits." };

  return createCreditCheckout(workspace, parsed.data.bundleKey);
}
