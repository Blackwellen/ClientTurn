import { test } from "node:test";
import assert from "node:assert/strict";
import { googleCallbackUri } from "../src/lib/auth/google-callback-uri.ts";

const SITE = "https://clientturn.com";

test("the callback follows the origin the person is actually on", () => {
  assert.equal(googleCallbackUri("https://clientturn.com", SITE), "https://clientturn.com/api/auth/google/callback");
  assert.equal(googleCallbackUri("https://www.clientturn.com", SITE), "https://www.clientturn.com/api/auth/google/callback");
  assert.equal(googleCallbackUri("https://clientturn.vercel.app", SITE), "https://clientturn.vercel.app/api/auth/google/callback");
});

test("any local dev port works, whatever NEXT_PUBLIC_SITE_URL says", () => {
  assert.equal(googleCallbackUri("http://localhost:3001", "http://localhost:3000"), "http://localhost:3001/api/auth/google/callback");
  assert.equal(googleCallbackUri("http://127.0.0.1:3000", SITE), "http://127.0.0.1:3000/api/auth/google/callback");
});

test("an unknown or spoofed host falls back to the configured site URL", () => {
  assert.equal(googleCallbackUri("https://evil.example", SITE), "https://clientturn.com/api/auth/google/callback");
  assert.equal(googleCallbackUri("http://clientturn.com", SITE), "https://clientturn.com/api/auth/google/callback");
  assert.equal(googleCallbackUri("not a url", SITE), "https://clientturn.com/api/auth/google/callback");
  assert.equal(googleCallbackUri(null, "https://clientturn.com/"), "https://clientturn.com/api/auth/google/callback");
});

test("the configured site URL's own origin is honoured", () => {
  assert.equal(googleCallbackUri("https://staging.clientturn.com", "https://staging.clientturn.com"), "https://staging.clientturn.com/api/auth/google/callback");
});
