import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_QUOTE_SETTINGS,
  baseRowFromSettings,
  canEditCatalogue,
  canEditQuoteSettings,
  canWorkQuotes,
  quoteSettingsInputSchema,
  settingsFromRow,
  settingsGaps,
} from "../src/lib/quotes/settings.ts";
import { serviceOperation } from "../src/lib/services/registry.ts";
import { roleMeets } from "../src/lib/services/types.ts";
import { SETTINGS_SECTIONS, parseSettingsSection } from "../src/lib/settings/types.ts";

/**
 * Settings -> Quotes & invoices: RBAC (owners and admins change pricing and
 * legal settings; members and viewers read), the one validated shape, and
 * the section's place in the Settings IA.
 */

const valid = {
  vatRegistered: true,
  vatNumber: "gb 123 456 789",
  legalName: "Studio North Ltd",
  companyNumber: "01234567",
  addressLines: ["1 High Street", "", "Leeds LS1 1AA"],
  validityDays: 30,
  paymentTermsDays: 14,
  defaultDepositBps: 5000,
  termsText: "Payment within 14 days.",
  prefixes: { quote: "q-", invoice: "INV-", creditNote: "CN-" },
};

describe("RBAC", () => {
  test("only owners and admins edit pricing, legal settings and the catalogue", () => {
    for (const role of ["owner", "admin"]) {
      assert.equal(canEditQuoteSettings(role), true);
      assert.equal(canEditCatalogue(role), true);
    }
    for (const role of ["member", "viewer"]) {
      assert.equal(canEditQuoteSettings(role), false);
      assert.equal(canEditCatalogue(role), false);
    }
    assert.equal(canWorkQuotes("member"), true);
    assert.equal(canWorkQuotes("viewer"), false);
  });

  test("the server enforces the same: the operations are admin-minimum and UI-only for settings", () => {
    const update = serviceOperation("quote_settings.update")!;
    assert.equal(update.minimumRole, "admin");
    assert.deepEqual(update.callers, ["UI"]);
    assert.equal(roleMeets("member", update.minimumRole), false);
    assert.equal(roleMeets("viewer", update.minimumRole), false);
    assert.equal(roleMeets("admin", update.minimumRole), true);
    assert.equal(serviceOperation("quote_settings.get")!.minimumRole, "viewer");
  });

  test("the settings action goes through the operation, not a direct write", () => {
    const actions = readFileSync("src/lib/quotes/settings-actions.ts", "utf8");
    assert.match(actions, /"use server"/);
    assert.match(actions, /runOperation\(\s*"quote_settings\.update"/);
    assert.doesNotMatch(actions, /\.from\("quote_settings"\)/);
  });
});

describe("the settings shape", () => {
  test("normalises the VAT number, prefixes and blank address lines", () => {
    const parsed = quoteSettingsInputSchema.parse(valid);
    assert.equal(parsed.vatNumber, "GB123456789");
    assert.equal(parsed.prefixes.quote, "Q-");
    assert.deepEqual(parsed.addressLines, ["1 High Street", "Leeds LS1 1AA"]);
  });

  test("VAT registration and number agree", () => {
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, vatNumber: null }).success, false);
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, vatNumber: "123" }).success, false);
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, vatRegistered: false }).success, false, "a number without registration");
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, vatRegistered: false, vatNumber: null }).success, true);
  });

  test("prefixes must differ and validity is bounded", () => {
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, prefixes: { quote: "X-", invoice: "X-", creditNote: "CN-" } }).success, false);
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, validityDays: 0 }).success, false);
    assert.equal(quoteSettingsInputSchema.safeParse({ ...valid, validityDays: 400 }).success, false);
  });

  test("a missing row reads as the defaults; the row round-trips", () => {
    assert.deepEqual(settingsFromRow(null), DEFAULT_QUOTE_SETTINGS);
    const parsed = quoteSettingsInputSchema.parse(valid);
    const back = settingsFromRow(baseRowFromSettings(parsed), [
      { kind: "QUOTE", prefix: "Q-" },
      { kind: "INVOICE", prefix: "INV-" },
    ]);
    assert.equal(back.vatNumber, "GB123456789");
    assert.equal(back.defaultDepositBps, 5000);
  });

  test("gaps are named in plain words", () => {
    assert.deepEqual(settingsGaps(DEFAULT_QUOTE_SETTINGS, "Studio"), ["Your business address", "Your quote terms"]);
  });
});

describe("the Settings IA", () => {
  test("Quotes & invoices is a section of Settings (one of the 5 destinations), not a new destination", () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === "quotes");
    assert.ok(section);
    assert.equal(section!.label, "Quotes & invoices");
    assert.equal(parseSettingsSection("quotes"), "quotes");
  });
});
