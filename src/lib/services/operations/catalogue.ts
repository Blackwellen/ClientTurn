import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { can } from "@/lib/billing/capabilities";
import { parseBundle, parseItem, validateCatalogue } from "@/lib/catalogue/validate";
import { rowFromItem, toPublicItem } from "@/lib/catalogue/rows";
import { idSchema } from "@/lib/catalogue/types";
import { loadQuoteSettings, loadWorkspaceCatalogue } from "@/lib/quotes/store";
import {
  baseRowFromSettings,
  extendedRowFromSettings,
  quoteSettingsInputSchema,
  type QuoteSettings,
} from "@/lib/quotes/settings";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * The priced catalogue and the quote settings (P2). Owner/admin writes,
 * enforced by each declaration's `minimumRole`; prices and cost are written
 * with the service role only (0152 grants the browser no write, and no read
 * of cost). Every write validates the WHOLE catalogue as it would be after
 * the change, so a write that would make other quotes unpriceable (a
 * dangling add-on, a bundle dearer than its parts) is refused up front.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function isInternal(role: string) {
  return role === "owner" || role === "admin";
}

function refuseIssues(issues: { path: (string | number)[]; message: string }[]): never {
  const first = issues[0];
  throw new ServiceError("INVALID_INPUT", first ? `${first.path.join(".") || "item"}: ${first.message}` : "That catalogue entry is not valid.");
}

defineOperation("catalogue.list", {
  schema: z.object({ includeArchived: z.boolean().optional() }),
  async run({ args, context }: HandlerInput<{ includeArchived?: boolean }>) {
    const settings = await loadQuoteSettings(context.businessId);
    const catalogue = await loadWorkspaceCatalogue(context.businessId, settings.currency);
    const internal = isInternal(context.role);
    const items = catalogue.items.filter((item) => args.includeArchived || item.active).map((item) => (internal ? item : toPublicItem(item)));
    const bundles = catalogue.bundles.filter((bundle) => args.includeArchived || bundle.active);
    const check = validateCatalogue(catalogue);
    return {
      data: { currency: catalogue.currency, items, bundles, problems: check.ok ? [] : check.issues.map((issue) => issue.message) },
      entityId: null,
    };
  },
});

const upsertItemSchema = z.object({
  item: z.record(z.string(), z.unknown()),
  /** commercial_authority.approved_checkout_links[].id: the payment step after acceptance. */
  checkoutLinkId: z.string().trim().min(1).max(64).nullable().optional(),
});

defineOperation("catalogue.upsert_item", {
  schema: upsertItemSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof upsertItemSchema>>) {
    const settings = await loadQuoteSettings(context.businessId);
    const parsed = parseItem({ currency: settings.currency, ...args.item });
    if (!parsed.ok) refuseIssues(parsed.issues);
    const item = parsed.item;
    if (item.currency !== settings.currency) throw new ServiceError("INVALID_INPUT", `Catalogue prices are in ${settings.currency}.`);

    const current = await loadWorkspaceCatalogue(context.businessId, settings.currency);
    const before = current.items.find((candidate) => candidate.id === item.id) ?? null;
    const next = { ...current, items: [...current.items.filter((candidate) => candidate.id !== item.id), item] };
    const check = validateCatalogue(next);
    if (!check.ok) refuseIssues(check.issues);

    const client = db();
    const row = rowFromItem(item, context.businessId, args.checkoutLinkId ?? null);
    const { data, error } = await client
      .from("catalogue_items")
      .upsert({ ...row, archived_at: item.active ? null : new Date().toISOString() }, { onConflict: "business_id,key" })
      .select("id")
      .single();
    if (error || !data) throw new ServiceError("CONFLICT", "That catalogue item could not be saved.");
    const itemId = (data as { id: string }).id;
    const del = await client.from("catalogue_price_tiers").delete().eq("business_id", context.businessId).eq("item_id", itemId);
    if (del.error) throw new ServiceError("CONFLICT", "The price tiers could not be saved.");
    if (item.tiers.length > 0) {
      const ins = await client.from("catalogue_price_tiers").insert(
        item.tiers.map((tier, position) => ({
          business_id: context.businessId,
          item_id: itemId,
          position,
          up_to: tier.upTo,
          unit_price_minor: tier.unitPriceMinor,
          flat_fee_minor: tier.flatFeeMinor,
        })),
      );
      if (ins.error) throw new ServiceError("CONFLICT", "The price tiers could not be saved.");
    }
    return {
      data: { item: isInternal(context.role) ? item : toPublicItem(item), created: before === null },
      entityId: itemId,
      before: before ? { unitPriceMinor: before.unitPriceMinor, vatRate: before.vatRate, active: before.active } : null,
      after: { unitPriceMinor: item.unitPriceMinor, vatRate: item.vatRate, active: item.active },
      warnings: [{ code: "sent_quotes_unchanged", message: "Quotes already sent keep the price they were sent with." }],
    };
  },
});

const upsertBundleSchema = z.object({ bundle: z.record(z.string(), z.unknown()) });

defineOperation("catalogue.upsert_bundle", {
  schema: upsertBundleSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof upsertBundleSchema>>) {
    const settings = await loadQuoteSettings(context.businessId);
    const parsed = parseBundle({ currency: settings.currency, ...args.bundle });
    if (!parsed.ok) refuseIssues(parsed.issues);
    const bundle = parsed.bundle;
    const current = await loadWorkspaceCatalogue(context.businessId, settings.currency);
    const next = { ...current, bundles: [...current.bundles.filter((candidate) => candidate.id !== bundle.id), bundle] };
    const check = validateCatalogue(next);
    if (!check.ok) refuseIssues(check.issues);

    const client = db();
    const { data: itemRows } = await client
      .from("catalogue_items")
      .select("id, key")
      .eq("business_id", context.businessId)
      .in("key", bundle.components.map((component) => component.itemId));
    const idByKey = new Map(((itemRows ?? []) as { id: string; key: string }[]).map((row) => [row.key, row.id]));
    const { data, error } = await client
      .from("catalogue_bundles")
      .upsert(
        {
          business_id: context.businessId,
          key: bundle.id,
          name: bundle.name,
          description: bundle.description ?? null,
          currency: bundle.currency,
          pricing_type: bundle.pricing.type,
          fixed_price_minor: bundle.pricing.type === "FIXED" ? bundle.pricing.priceMinor : null,
          percent_off_bps: bundle.pricing.type === "PERCENT_OFF" ? bundle.pricing.bps : null,
          active: bundle.active,
        },
        { onConflict: "business_id,key" },
      )
      .select("id")
      .single();
    if (error || !data) throw new ServiceError("CONFLICT", "That bundle could not be saved.");
    const bundleId = (data as { id: string }).id;
    await client.from("catalogue_bundle_items").delete().eq("business_id", context.businessId).eq("bundle_id", bundleId);
    const ins = await client.from("catalogue_bundle_items").insert(
      bundle.components.map((component, position) => ({
        bundle_id: bundleId,
        item_id: idByKey.get(component.itemId),
        business_id: context.businessId,
        position,
        quantity: component.quantity,
      })),
    );
    if (ins.error) throw new ServiceError("CONFLICT", "The bundle's items could not be saved.");
    return { data: { bundle }, entityId: bundleId, after: { pricing: bundle.pricing, components: bundle.components.length } };
  },
});

const archiveSchema = z.object({ kind: z.enum(["item", "bundle"]), key: idSchema });

defineOperation("catalogue.archive", {
  schema: archiveSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof archiveSchema>>) {
    const client = db();
    const table = args.kind === "item" ? "catalogue_items" : "catalogue_bundles";
    const patch = args.kind === "item" ? { active: false, archived_at: new Date().toISOString() } : { active: false };
    const { data, error } = await client.from(table).update(patch).eq("business_id", context.businessId).eq("key", args.key).select("id");
    if (error) throw new ServiceError("CONFLICT", "That could not be archived.");
    const row = ((data ?? []) as { id: string }[])[0];
    if (!row) throw new ServiceError("NOT_FOUND", "That catalogue entry could not be found.");
    return {
      data: { key: args.key, archived: true },
      entityId: row.id,
      before: { active: true },
      after: { active: false },
      warnings: [{ code: "sent_quotes_unchanged", message: "Quotes already sent keep it. It can be restored by saving it as active again." }],
    };
  },
});

/* ------------------------------------------------------------ quote settings */

defineOperation("quote_settings.get", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    return { data: { settings: await loadQuoteSettings(context.businessId) }, entityId: context.businessId };
  },
});

defineOperation("quote_settings.update", {
  schema: quoteSettingsInputSchema,
  async run({ args, context }: HandlerInput<QuoteSettings>) {
    const approvals = await can(context.businessId, "quote_approval_enabled");
    const settings: QuoteSettings = args;
    if (!approvals.allowed && (settings.discountPolicy.approvalRules.length > 0 || settings.discountPolicy.marginFloorBps !== null)) {
      throw new ServiceError("PLAN_LIMIT", approvals.message ?? "Approval rules are not on your plan.");
    }
    const before = await loadQuoteSettings(context.businessId);
    const client = db();
    const { error } = await client
      .from("quote_settings")
      .upsert({ business_id: context.businessId, ...baseRowFromSettings(settings), updated_by: context.userId }, { onConflict: "business_id" });
    if (error) throw new ServiceError("INVALID_INPUT", "Those settings could not be saved. Check the VAT and company numbers.");

    const warnings: { code: string; message: string }[] = [];
    const extended = await client.from("quote_settings").update(extendedRowFromSettings(settings)).eq("business_id", context.businessId);
    if (extended.error) {
      if (!isSchemaLag(extended.error)) throw new ServiceError("CONFLICT", "Those settings could not be saved.");
      warnings.push({ code: "pending_migration", message: "Saved. The signature and reminder switches take effect after database update 0156." });
    }

    const counters = await client.from("document_counters").upsert(
      [
        { business_id: context.businessId, kind: "QUOTE", prefix: settings.prefixes.quote },
        { business_id: context.businessId, kind: "INVOICE", prefix: settings.prefixes.invoice },
        { business_id: context.businessId, kind: "CREDIT_NOTE", prefix: settings.prefixes.creditNote },
      ],
      { onConflict: "business_id,kind" },
    );
    if (counters.error) throw new ServiceError("CONFLICT", "The numbering prefixes could not be saved.");

    return {
      data: { settings },
      entityId: context.businessId,
      before: { vatRegistered: before.vatRegistered, validityDays: before.validityDays, prefixes: before.prefixes, approvalRules: before.discountPolicy.approvalRules.length },
      after: { vatRegistered: settings.vatRegistered, validityDays: settings.validityDays, prefixes: settings.prefixes, approvalRules: settings.discountPolicy.approvalRules.length },
      warnings,
    };
  },
});
