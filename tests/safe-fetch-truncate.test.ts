/**
 * safeFetchText's `truncate` option (surface QA 2026-09-30): onboarding's
 * "Fill in from website" refused ordinary marketing home pages over 1.5 MB.
 * With `truncate` the first 1.5 MB is kept; without it a large page is still
 * refused, so no other caller changed behaviour.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { safeFetchText } from "../src/lib/security/safe-fetch.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function bigPage(bytes: number): Response {
  const head = "<html><head><title>Acme Digital</title></head><body>";
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(head));
    },
    pull(controller) {
      if (sent >= bytes) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

// A public IP literal: assertSafeUrl accepts it without a DNS lookup.
const URL_ = "https://93.184.216.34/";

describe("safeFetchText truncate", () => {
  test("a page over the cap is refused by default", async () => {
    globalThis.fetch = (async () => bigPage(2_000_000)) as typeof fetch;
    const result = await safeFetchText(URL_);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "RESPONSE_TOO_LARGE");
  });

  test("with truncate the top of the page is kept, bounded to the cap", async () => {
    globalThis.fetch = (async () => bigPage(2_000_000)) as typeof fetch;
    const result = await safeFetchText(URL_, { truncate: true });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.body, /<title>Acme Digital<\/title>/);
      assert.ok(result.body.length <= 1_500_000);
    }
  });
});
