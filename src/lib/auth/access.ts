import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Has this person been let in by us, rather than by themselves?
 *
 * Every legitimate account leaves one of two traces. Customer and partner
 * signup both write a `profiles` row; a workspace invitation writes a
 * `business_members` row against the placeholder account Supabase creates for
 * the invitee, before that person has ever signed in. Nothing writes either
 * row on a bare OAuth exchange.
 *
 * So an account with neither is someone who has just registered themselves
 * through the identity provider — the one registration path that does not pass
 * through a server action we control, and therefore the one the invite-only
 * gate has to close in the callback.
 */
export async function hasGrantedAccess(userId: string): Promise<boolean> {
  const admin = createAdminClient();

  const [profile, membership] = await Promise.all([
    admin.from("profiles").select("id").eq("id", userId).maybeSingle(),
    admin
      .from("business_members")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  return Boolean(profile.data || membership.data);
}
