import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BusinessRole = "owner" | "admin" | "member" | "viewer";

export type ActiveWorkspace = {
  userId: string;
  businessId: string;
  role: BusinessRole;
  businessName: string;
  businessStatus: string;
  onboardingStep: string;
  activatedAt: string | null;
  timezone: string;
};

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolves the workspace the signed-in user operates in. V1 is one workspace
 * per user; the membership row is still the authority, never a client value.
 *
 * This is the uncached read — use it after a write that changes membership
 * within the same request, where the memoised `getActiveWorkspace` below would
 * still return the pre-write result.
 */
export async function readActiveWorkspace(): Promise<ActiveWorkspace | null> {
    const user = await getUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data } = await supabase
      .from("business_members")
      .select(
        "business_id, role, businesses(name, status, onboarding_step, activated_at, timezone)",
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!data?.businesses) return null;

    return {
      userId: user.id,
      businessId: data.business_id,
      role: data.role as BusinessRole,
      businessName: data.businesses.name,
      businessStatus: data.businesses.status,
      onboardingStep: data.businesses.onboarding_step,
      activatedAt: data.businesses.activated_at,
      timezone: data.businesses.timezone,
  };
}

export const getActiveWorkspace = cache(readActiveWorkspace);

export async function requireWorkspace() {
  await requireUser();
  const workspace = await getActiveWorkspace();
  if (!workspace) redirect("/onboarding");
  return workspace;
}

const RANK: Record<BusinessRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function hasRole(role: BusinessRole, minimum: BusinessRole) {
  return RANK[role] >= RANK[minimum];
}

export async function requireRole(minimum: BusinessRole) {
  const workspace = await requireWorkspace();
  if (!hasRole(workspace.role, minimum)) {
    throw new Error("FORBIDDEN");
  }
  return workspace;
}

/** Platform admin is read from the database only — never a client-supplied value. */
export const isPlatformAdmin = cache(async () => {
  const user = await getUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("platform_role")
    .eq("id", user.id)
    .maybeSingle();

  return data?.platform_role === "platform_admin";
});
