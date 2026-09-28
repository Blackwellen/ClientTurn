import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseCompaniesHouseKey } from "../src/lib/find-leads/companies-house-key.ts";

/**
 * Companies House keys copied without their dashes were rejected with 401
 * (found live 2026-09-28); the provider now restores the UUID form.
 */
test("a bare 32-hex Companies House key is restored to UUID form", () => {
  assert.equal(
    normaliseCompaniesHouseKey("0123456789abcdef0123456789ABCDEF"),
    "01234567-89ab-cdef-0123-456789ABCDEF",
  );
});

test("a UUID key, surrounding whitespace and a missing key are handled", () => {
  assert.equal(
    normaliseCompaniesHouseKey(" 01234567-89ab-cdef-0123-456789abcdef "),
    "01234567-89ab-cdef-0123-456789abcdef",
  );
  assert.equal(normaliseCompaniesHouseKey(""), undefined);
  assert.equal(normaliseCompaniesHouseKey(undefined), undefined);
  assert.equal(normaliseCompaniesHouseKey("not-a-hex-key"), "not-a-hex-key");
});
