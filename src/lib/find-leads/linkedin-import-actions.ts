"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import { LINKEDIN_SURFACES, type LinkedinSurface } from "./linkedin-import";

export type LinkedinImportActionResult =
  | {
      ok: true;
      imported: number;
      duplicates: number;
      rejected: number;
      surface: LinkedinSurface;
      firstErrors: { row: number; message: string }[];
      warning: string | null;
    }
  | { ok: false; error: string };

/**
 * Imports the customer's own Sales Navigator / LinkedIn export.
 *
 * The write is the registry operation `prospect.import_linkedin_list`, the
 * same one the API uses: same validation, same phone-discarding, same audit.
 * The role is checked here only so the message is clear; the runtime checks it
 * again.
 */
export async function importLinkedinListAction(input: {
  csv: string;
  fileName: string | null;
  surface: LinkedinSurface | null;
}): Promise<LinkedinImportActionResult> {
  if (typeof input?.csv !== "string" || input.csv.length === 0) {
    return { ok: false, error: "Choose a CSV file to import." };
  }
  const surface =
    input.surface && (LINKEDIN_SURFACES as readonly string[]).includes(input.surface)
      ? input.surface
      : null;

  let workspace;
  try {
    workspace = await requireRole("member");
  } catch {
    return { ok: false, error: "You do not have permission to import lists." };
  }

  const result = await runOperation(
    "prospect.import_linkedin_list",
    { csv: input.csv, fileName: input.fileName?.slice(0, 200) ?? null, surface },
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      caller: "UI",
      correlationId: randomUUID(),
    },
  );
  if (!result.success) return { ok: false, error: result.message };

  const data = result.data as {
    imported: number;
    duplicates: number;
    rejected: number;
    surface: LinkedinSurface;
    errors: { row: number; message: string }[];
  };

  revalidatePath("/app/find-leads");
  return {
    ok: true,
    imported: data.imported,
    duplicates: data.duplicates,
    rejected: data.rejected,
    surface: data.surface,
    firstErrors: data.errors.slice(0, 5),
    warning: result.warnings[0]?.message ?? null,
  };
}
