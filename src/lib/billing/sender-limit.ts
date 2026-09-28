import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "./v4-entitlements";
import { senderIdentityGate, sendersWithinLimit } from "./allowance-gates";

/**
 * The plan's sender-identity allowance (`plan_entitlements.sender_identity`:
 * Starter 1, Growth 3, Pro 10, Enterprise 50). It used to be capped only by
 * how many mailboxes happened to be connected (gap audit 15 §9).
 *
 *   * creating a NEW identity (a new address) is refused at the limit;
 *   * re-saving an existing one is an update and always allowed;
 *   * launching a campaign is refused while the workspace has more active
 *     identities than the plan allows (after a downgrade), with what to do.
 *
 * Returns the sentence to show, or null. A failed read refuses: unknown usage
 * is never "room left".
 */

async function activeSenderEmails(businessId: string): Promise<string[] | null> {
  const { data, error } = await createAdminClient()
    .from("sender_identities")
    .select("email")
    .eq("business_id", businessId)
    .eq("active", true);
  if (error) return null;
  return ((data ?? []) as { email: string | null }[]).map((row) => row.email ?? "").filter(Boolean);
}

export async function senderIdentityCreateProblem(businessId: string, email: string): Promise<string | null> {
  const [entitlements, emails] = await Promise.all([getV4Entitlements(businessId), activeSenderEmails(businessId)]);
  if (!emails) return "Your sender allowance could not be confirmed. Try again.";
  const limit = entitlements.allowances.sender_identity.hardLimit;
  const gate = senderIdentityGate({ activeEmails: emails, email, limit });
  if (gate.allowed) return null;
  return `Your plan includes ${limit} sender identit${limit === 1 ? "y" : "ies"}, and ${gate.used} ${gate.used === 1 ? "is" : "are"} active. Deactivate one, or upgrade, to add another.`;
}

export async function senderLimitLaunchProblem(businessId: string): Promise<string | null> {
  const [entitlements, emails] = await Promise.all([getV4Entitlements(businessId), activeSenderEmails(businessId)]);
  if (!emails) return "Your sender allowance could not be confirmed. Try again.";
  const limit = entitlements.allowances.sender_identity.hardLimit;
  if (sendersWithinLimit({ activeSenders: emails.length, limit })) return null;
  const over = emails.length - limit;
  return `Your plan includes ${limit} sender identit${limit === 1 ? "y" : "ies"}, but ${emails.length} are active. Deactivate ${over} before launching a campaign.`;
}
