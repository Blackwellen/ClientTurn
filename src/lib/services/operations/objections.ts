import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { LIBRARY_VERSION } from "@/lib/sales-library/types";
import {
  MAX_WORKSPACE_OBJECTIONS,
  REASSURANCE_KEY,
  reassuranceAssetSchema,
  workspaceObjectionKeySchema,
  workspaceObjectionPayloadSchema,
  parseWorkspaceObjectionRows,
  type WorkspaceObjectionSet,
} from "@/lib/sales-library/workspace-objections";
import { lintStyle } from "@/lib/agent/validate";
import { previewObjection } from "@/lib/agent/objection-preview";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Settings -> AI & selling -> Objections as service operations: the
 * objections a workspace hears most, its own approved answers, and the
 * reassurance facts it stands behind (elite-closer brief). Stored as
 * `workspace_sales_overrides` kind OBJECTION (0121; payload shapes in
 * sales-library/workspace-objections.ts, documented by 0147). Every write is
 * scoped to `context.businessId` on the write itself.
 *
 * The business's text is what the assistant will paraphrase to leads, so it
 * is held to the same rules as anything the assistant sends: no emojis, no
 * em or en dashes, no pressure wording (lintStyle). A claim the business
 * makes here is its own approved claim; the assistant never adds to it.
 */

async function readSet(businessId: string): Promise<WorkspaceObjectionSet> {
  const { data, error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .select("key, payload")
    .eq("business_id", businessId)
    .eq("kind", "OBJECTION");
  if (error) throw new ServiceError("UNAVAILABLE", "The objection library could not be read.");
  return parseWorkspaceObjectionRows(data ?? []);
}

/** The house rules on the business's own words, as one readable message. */
function textProblems(texts: string[]): string | null {
  for (const text of texts) {
    const failures = lintStyle(text).filter((f) =>
      ["STYLE_EMOJI", "STYLE_EM_DASHES", "STYLE_PRESSURE", "STYLE_LIST"].includes(f.code),
    );
    if (failures.length > 0) return `"${text.slice(0, 60)}": ${failures.map((f) => f.detail).join(" ")} ${failures[0].correction}`;
  }
  return null;
}

async function upsert(businessId: string, userId: string | null, key: string, payload: unknown) {
  const { error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .upsert(
      {
        business_id: businessId,
        kind: "OBJECTION",
        key,
        payload: payload as never,
        library_version: LIBRARY_VERSION,
        updated_by: userId,
      },
      { onConflict: "business_id,kind,key" },
    );
  if (error) throw new ServiceError("CONFLICT", "That could not be saved.");
}

defineOperation("sales_objections.list", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const set = await readSet(context.businessId);
    return { data: set, entityId: context.businessId };
  },
});

const saveSchema = z.object({
  key: workspaceObjectionKeySchema,
  payload: workspaceObjectionPayloadSchema,
});

defineOperation("sales_objections.save", {
  schema: saveSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof saveSchema>>) {
    const before = await readSet(context.businessId);
    const exists = before.objections.some((o) => o.key === args.key);
    if (!exists && before.objections.length >= MAX_WORKSPACE_OBJECTIONS) {
      throw new ServiceError("INVALID_INPUT", `A workspace can keep up to ${MAX_WORKSPACE_OBJECTIONS} objections.`);
    }
    if (args.key.startsWith("custom:") && args.payload.phrases.length === 0) {
      throw new ServiceError("INVALID_INPUT", "Add at least one phrase leads use, so the assistant can recognise it.");
    }
    const unknownAssets = args.payload.reassuranceIds.filter((id) => !before.assets.some((a) => a.id === id));
    if (unknownAssets.length) throw new ServiceError("INVALID_INPUT", `Unknown reassurance: ${unknownAssets.join(", ")}.`);
    const problem = textProblems([args.payload.response]);
    if (problem) throw new ServiceError("INVALID_INPUT", problem);

    await upsert(context.businessId, context.userId, args.key, args.payload);
    const after = await readSet(context.businessId);
    return {
      data: after,
      entityId: context.businessId,
      before: before.objections.find((o) => o.key === args.key) ?? null,
      after: after.objections.find((o) => o.key === args.key) ?? null,
    };
  },
});

const removeSchema = z.object({ key: workspaceObjectionKeySchema });

defineOperation("sales_objections.remove", {
  schema: removeSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof removeSchema>>) {
    const before = await readSet(context.businessId);
    const { error } = await createAdminClient()
      .from("workspace_sales_overrides")
      .delete()
      .eq("business_id", context.businessId)
      .eq("kind", "OBJECTION")
      .eq("key", args.key);
    if (error) throw new ServiceError("CONFLICT", "That could not be removed.");
    return {
      data: await readSet(context.businessId),
      entityId: context.businessId,
      before: before.objections.find((o) => o.key === args.key) ?? null,
      after: null,
    };
  },
});

const reassuranceSchema = z.object({ assets: z.array(reassuranceAssetSchema).max(20) });

defineOperation("sales_objections.save_reassurance", {
  schema: reassuranceSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof reassuranceSchema>>) {
    const ids = args.assets.map((a) => a.id);
    if (new Set(ids).size !== ids.length) throw new ServiceError("INVALID_INPUT", "Each reassurance needs its own name.");
    const problem = textProblems(args.assets.map((a) => a.text));
    if (problem) throw new ServiceError("INVALID_INPUT", problem);
    const before = await readSet(context.businessId);
    await upsert(context.businessId, context.userId, REASSURANCE_KEY, { assets: args.assets });
    return { data: await readSet(context.businessId), entityId: context.businessId, before: { assets: before.assets }, after: { assets: args.assets } };
  },
});

const previewSchema = z.object({
  message: z.string().trim().min(1).max(600),
  channel: z.enum(["sms", "whatsapp", "email"]).default("sms"),
});

defineOperation("sales_objections.preview", {
  schema: previewSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof previewSchema>>) {
    const set = await readSet(context.businessId);
    const { data: profile } = await createAdminClient()
      .from("business_profiles")
      .select("sales_motions")
      .eq("business_id", context.businessId)
      .maybeSingle();
    const motion = (profile?.sales_motions?.[0] ?? null) as Parameters<typeof previewObjection>[0]["motion"];
    return { data: previewObjection({ message: args.message, channel: args.channel, motion, workspace: set }), entityId: context.businessId };
  },
});
