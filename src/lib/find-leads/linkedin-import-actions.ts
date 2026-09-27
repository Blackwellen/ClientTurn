"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { LINKEDIN_SURFACES, type LinkedinSurface } from "./linkedin-import";

export type LinkedinImportActionResult =
  | {
      ok: true;
      imported: number;
      duplicates: number;
      rejected: number;
      withoutWebsite: number;
      surface: LinkedinSurface;
      firstErrors: { row: number; message: string }[];
      warning: string | null;
    }
  | { ok: false; error: string };

/**
 * Imports the customer's own list (their LinkedIn Connections export, or any
 * CSV they own) as prospects.
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
  sessionId?: string | null;
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
    {
      csv: input.csv,
      fileName: input.fileName?.slice(0, 200) ?? null,
      surface,
      sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    },
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
    withoutWebsite: number;
    surface: LinkedinSurface;
    errors: { row: number; message: string }[];
  };

  revalidatePath("/app/find-leads");
  return {
    ok: true,
    imported: data.imported,
    duplicates: data.duplicates,
    rejected: data.rejected,
    withoutWebsite: data.withoutWebsite,
    surface: data.surface,
    firstErrors: data.errors.slice(0, 5),
    warning: result.warnings[0]?.message ?? null,
  };
}

export type AddWebsiteActionResult =
  | { ok: true; domain: string; emailFound: boolean; intentMatched: number; warning: string | null }
  | { ok: false; error: string };

/**
 * "Add website" on a prospect whose company has none. The write is the
 * registry operation `prospect.set_company_website`, which then runs the
 * email waterfall and the free intent checks for the new domain.
 */
export async function addProspectWebsiteAction(input: {
  prospectId: string;
  website: string;
}): Promise<AddWebsiteActionResult> {
  if (typeof input?.prospectId !== "string" || typeof input?.website !== "string") {
    return { ok: false, error: "Enter the company's website." };
  }

  let workspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return { ok: false, error: "Only owners and admins can add a website, because it looks for a work email." };
  }
  try {
    await assertCapability(workspace.businessId, "sourcing");
  } catch (error) {
    return { ok: false, error: error instanceof EntitlementError ? error.message : "Find Leads is unavailable right now." };
  }

  const result = await runOperation(
    "prospect.set_company_website",
    { prospectId: input.prospectId, website: input.website },
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      caller: "UI",
      correlationId: randomUUID(),
    },
  );
  if (!result.success) return { ok: false, error: result.message };

  const data = result.data as { domain: string; emailFound: boolean; intentMatched: number };
  revalidatePath("/app/find-leads");
  return {
    ok: true,
    domain: data.domain,
    emailFound: data.emailFound,
    intentMatched: data.intentMatched,
    warning: result.warnings[0]?.message ?? null,
  };
}
