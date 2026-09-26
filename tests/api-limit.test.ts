import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLimit } from "../src/lib/api/limit.ts";

test("an absent or empty limit uses the default, not a single row", () => {
  assert.equal(parseLimit(null, 25, 50), 25);
  assert.equal(parseLimit("", 25, 50), 25);
  assert.equal(parseLimit("   ", 25, 100), 25);
});

test("explicit limits are clamped to 1..max", () => {
  assert.equal(parseLimit("10", 25, 50), 10);
  assert.equal(parseLimit("0", 25, 50), 1);
  assert.equal(parseLimit("500", 25, 50), 50);
  assert.equal(parseLimit("abc", 25, 50), 25);
});
