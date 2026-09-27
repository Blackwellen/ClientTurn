import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { systemEmailDailyCap } from "@/lib/billing/plans";

/**
 * Daily per-workspace budget for SYSTEM email -- the owner alerts and
 * notification copies ClientTurn sends through Resend, which we pay for
 * (economics.md U12). Campaign, follow-up and agent email never come here:
 * they go through the customer's own connected mailbox (`messaging/
 * email-provider.ts` -> `email/smtp.ts`), which costs ClientTurn nothing.
 *
 * Backed by the same Postgres fixed-window counter as the rate limiter, so it
 * holds across serverless instances. At the cap the caller skips the email
 * copy; the in-app notification is still written, so nothing is lost.
 *
 * Fails OPEN on a limiter error, like the rate limiter: a missed owner alert
 * is worse than a few extra fractions of a penny.
 */
export async function consumeSystemEmail(input: {
  businessId: string;
  plan: string;
}): Promise<{ allowed: boolean; cap: number }> {
  const cap = systemEmailDailyCap(input.plan);
  try {
    const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
      p_bucket: "system_email:daily",
      p_identifier: input.businessId,
      p_limit: cap,
      p_window_seconds: 24 * 60 * 60,
    });
    if (error || !data || data.length === 0) return { allowed: true, cap };
    return { allowed: Boolean(data[0].allowed), cap };
  } catch {
    return { allowed: true, cap };
  }
}
