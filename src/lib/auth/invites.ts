import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";

/**
 * Turns pending invitations into real memberships once the invited person has
 * actually signed in and proved they control the address.
 *
 * Matching is on the verified auth email rather than the membership row's
 * user_id alone, so an invitation raised against a placeholder account cannot
 * hand a workspace to someone who never confirmed that address.
 */
export async function activatePendingInvites(
  userId: string,
  email: string | null | undefined,
  emailConfirmed: boolean,
): Promise<number> {
  if (!email || !emailConfirmed) return 0;

  const admin = createAdminClient();
  const normalised = email.trim().toLowerCase();

  const { data: pending } = await admin
    .from("business_members")
    .select("id, business_id, role, invited_email")
    .eq("user_id", userId)
    .eq("status", "invited");

  if (!pending || pending.length === 0) return 0;

  const matching = pending.filter(
    (row) => (row.invited_email ?? "").trim().toLowerCase() === normalised,
  );
  if (matching.length === 0) return 0;

  const { error } = await admin
    .from("business_members")
    .update({ status: "active", accepted_at: new Date().toISOString() })
    .in(
      "id",
      matching.map((row) => row.id),
    );

  if (error) return 0;

  for (const row of matching) {
    await recordAudit({
      businessId: row.business_id,
      actorUserId: userId,
      action: "member.invite_accepted",
      entityType: "business_member",
      entityId: row.id,
      metadata: { role: row.role },
    });
  }

  return matching.length;
}
