import "server-only";
import { serverEnv } from "@/lib/env";
import { existingAccountInviteEmail, type AssignableRole } from "./rules";

/**
 * Sends the invitation email to someone who already has a ClientTurn account.
 * Supabase Auth only emails addresses it has not confirmed, so without this an
 * existing user was added as "Invited" and never told. Resend, transactional,
 * with a short timeout; false when it could not be sent.
 */
export async function sendExistingAccountInvite(input: {
  to: string;
  workspaceName: string;
  role: AssignableRole;
  invitedAt: Date;
}): Promise<boolean> {
  const key = serverEnv.resend.apiKey;
  if (!key) return false;

  const email = existingAccountInviteEmail({
    workspaceName: input.workspaceName,
    role: input.role,
    invitedAt: input.invitedAt,
    siteUrl: serverEnv.siteUrl,
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: serverEnv.resend.from,
        to: [input.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
