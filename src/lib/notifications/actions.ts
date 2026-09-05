"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/session";

const idSchema = z.uuid();

export type NotificationActionResult = { ok: boolean; error?: string };

export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationActionResult> {
  const parsed = idSchema.safeParse(notificationId);
  if (!parsed.success) return { ok: false, error: "Invalid notification." };

  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId)
    .eq("user_id", workspace.userId)
    .is("read_at", null);

  if (error) return { ok: false, error: "Could not update the notification." };

  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const workspace = await requireWorkspace();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("business_id", workspace.businessId)
    .eq("user_id", workspace.userId)
    .is("read_at", null);

  if (error) return { ok: false, error: "Could not update notifications." };

  revalidatePath("/app", "layout");
  return { ok: true };
}
