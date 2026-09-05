import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const ADMIN_LOGIN_PATH = "/admin/login";

export type PlatformOperator = {
  id: string;
  email: string;
  name: string;
};

/**
 * The only authority on platform-admin status is `profiles.platform_role` read
 * server-side with the caller's own session. No cookie flag, header, query
 * parameter or client value is ever consulted.
 */
export const getPlatformOperator = cache(
  async (): Promise<PlatformOperator | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("profiles")
      .select("id, email, first_name, last_name, platform_role")
      .eq("id", user.id)
      .maybeSingle();

    if (!data || data.platform_role !== "platform_admin") return null;

    const name =
      [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
      data.email ||
      "Operator";

    return { id: data.id, email: data.email ?? user.email ?? "", name };
  },
);

/**
 * A signed-in customer who is not a platform admin is treated exactly like a
 * signed-out visitor, so /admin never confirms that it exists.
 */
export async function requirePlatformAdmin(): Promise<PlatformOperator> {
  const operator = await getPlatformOperator();
  if (!operator) redirect(ADMIN_LOGIN_PATH);
  return operator;
}
