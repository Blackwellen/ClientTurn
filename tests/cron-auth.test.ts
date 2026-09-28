import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized, safeEqual } from "../src/lib/security/cron-auth.ts";

const url = "https://clientturn.com/api/cron/worker";

test("a bearer header with the right secret is authorised", () => {
  const request = new Request(url, { headers: { authorization: "Bearer s3cret" } });
  assert.equal(isCronAuthorized(request, "s3cret", "production"), true);
});

test("a wrong or missing secret is refused, and no configured secret refuses everything", () => {
  assert.equal(isCronAuthorized(new Request(url, { headers: { authorization: "Bearer nope" } }), "s3cret", "production"), false);
  assert.equal(isCronAuthorized(new Request(url), "s3cret", "production"), false);
  assert.equal(isCronAuthorized(new Request(url, { headers: { authorization: "Bearer x" } }), undefined, "production"), false);
});

test("the query-string secret works in development only", () => {
  const request = new Request(`${url}?secret=s3cret`);
  assert.equal(isCronAuthorized(request, "s3cret", "production"), false);
  assert.equal(isCronAuthorized(request, "s3cret", "development"), true);
});

test("safeEqual compares strings of different lengths without throwing", () => {
  assert.equal(safeEqual("a", "abc"), false);
  assert.equal(safeEqual("abc", "abc"), true);
});
