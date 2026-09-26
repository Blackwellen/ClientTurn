import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import type { EmailOrigin } from "../email-origin";

/**
 * Writes and reads `email_origin` (0131) on prospects and leads.
 *
 * A separate statement from the row's own insert on purpose: before 0131 is
 * applied the column does not exist, and folding it into the insert would
 * stop every sourcing run and every ingest. Here a lagging schema is a no-op
 * and any other failure is logged, never thrown: the origin is evidence for
 * the cold-send rule, and a missing origin is treated as "not guessed".
 */

/** 0131 post-dates the generated types. */
type Untyped = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function recordEmailOrigin(input: {
  table: "prospects" | "leads";
  businessId: string;
  id: string;
  origin: EmailOrigin;
}): Promise<void> {
  try {
    const db = createAdminClient() as unknown as Untyped;
    const result = await db
      .from(input.table)
      .update({ email_origin: input.origin })
      .eq("business_id", input.businessId)
      .eq("id", input.id);
    if (result.error && isSchemaLag(result.error)) return;
    logWriteError(result, `${input.table}.email_origin update`, { businessId: input.businessId, id: input.id });
  } catch (error) {
    console.error("[email-origin] write threw", { table: input.table, id: input.id, error });
  }
}

/**
 * Origins by prospect id. Empty on a lagging schema (no origin is recorded
 * anywhere yet); **null** on any other failure, so a send path can stop rather
 * than read "unknown" as "not guessed".
 */
export async function loadProspectEmailOrigins(
  businessId: string,
  prospectIds: string[],
): Promise<Map<string, string | null> | null> {
  const out = new Map<string, string | null>();
  if (prospectIds.length === 0) return out;
  try {
    const db = createAdminClient() as unknown as Untyped;
    const { data, error } = await db
      .from("prospects")
      .select("id, email_origin")
      .eq("business_id", businessId)
      .in("id", prospectIds);
    if (error) {
      if (isSchemaLag(error)) return out;
      console.error("[email-origin] read failed", { businessId, message: error.message });
      return null;
    }
    for (const row of (data ?? []) as { id: string; email_origin: string | null }[]) out.set(row.id, row.email_origin);
  } catch (error) {
    console.error("[email-origin] read threw", { businessId, error });
    return null;
  }
  return out;
}

/** One prospect's origin, for promotion to a lead. Null when unknown. */
export async function prospectEmailOrigin(businessId: string, prospectId: string): Promise<string | null> {
  return (await loadProspectEmailOrigins(businessId, [prospectId]))?.get(prospectId) ?? null;
}
