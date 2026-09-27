"use server";

import { revalidatePath } from "next/cache";
import { runOperation } from "@/lib/services";
import { requireWorkspace } from "@/lib/auth/session";
import { randomUUID } from "node:crypto";
import type { QuoteActionResult } from "./action-result";
import { runForUser } from "./run-action";

/**
 * Settings -> Quotes & invoices actions. Every write is a service operation
 * (quote_settings.update, catalogue.*), so the role check (owner/admin), the
 * validation and the audit row are the same as for the API and MCP. Nothing
 * here writes a table directly.
 */

export async function saveQuoteSettings(input: unknown): Promise<QuoteActionResult> {
  const workspace = await requireWorkspace();
  const result = await runOperation("quote_settings.update", input, {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI",
    correlationId: randomUUID(),
  });
  if (!result.success) return { ok: false, error: result.message, code: result.code };
  revalidatePath("/app/settings");
  return { ok: true, data: result.data, warnings: result.warnings.map((w) => w.message) };
}

export async function saveCatalogueItem(input: { item: Record<string, unknown>; checkoutLinkId: string | null }): Promise<QuoteActionResult> {
  const result = await runForUser("catalogue.upsert_item", input);
  if (result.ok) revalidatePath("/app/settings");
  return result;
}

export async function saveCatalogueBundle(input: { bundle: Record<string, unknown> }): Promise<QuoteActionResult> {
  const result = await runForUser("catalogue.upsert_bundle", input);
  if (result.ok) revalidatePath("/app/settings");
  return result;
}

export async function archiveCatalogueEntry(input: { kind: "item" | "bundle"; key: string }): Promise<QuoteActionResult> {
  const result = await runForUser("catalogue.archive", input);
  if (result.ok) revalidatePath("/app/settings");
  return result;
}
