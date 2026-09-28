"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runOperation } from "@/lib/services";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * The platform kill switch for one workspace's AI calling (voice P2). Admin
 * shell only: platform_role checked server-side, step-up required (resolved
 * conflict 4), and the change runs through the `voice.admin_disable_workspace`
 * service operation as SYSTEM, so it is audited under its own name and
 * queued calls are cancelled.
 */

const schema = z.object({
  businessId: z.uuid(),
  disabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export async function setWorkspaceVoiceKillSwitch(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.voice_kill_switch", async (operator) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Give a workspace, on or off, and a reason." };
    const result = await runOperation(
      "voice.admin_disable_workspace",
      { disabled: parsed.data.disabled, reason: parsed.data.reason },
      {
        businessId: parsed.data.businessId,
        userId: operator.id,
        role: "owner",
        caller: "SYSTEM",
        correlationId: randomUUID(),
      },
    );
    if (!result.success) return { ok: false, error: result.message };
    return { ok: true, message: parsed.data.disabled ? "AI calling is paused for this workspace." : "AI calling is resumed for this workspace." };
  });
}
