/**
 * Every provider the UI offers a Connect button for must be connectable.
 *
 * The bug this replaces: adapter modules register themselves on import, and the
 * only module importing them was `lib/jobs/register.ts`. Background jobs saw a
 * full registry; `/api/integrations/[provider]/connect` imported
 * `providers/registry` directly and saw an empty one, so it answered
 * `{"error":"Unknown provider."}` for every provider on the generic OAuth flow.
 *
 * Nothing failed loudly. The catalogue rendered a Connect button, the customer
 * clicked it, and their own app returned a 404 — the whole integration dead
 * behind a control that looked live.
 *
 * These tests tie the two halves together: the catalogue's promise, and the
 * registry's ability to keep it.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// `env.ts` is read at import time by the adapters. These are irrelevant to
// registration but must exist for the modules to load at all.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";
process.env.STRIPE_SECRET_KEY_TEST ??= "sk_test_placeholder";

type Registry = typeof import("../src/lib/integrations/providers/registry.ts");
type Catalog = typeof import("../src/lib/integrations/catalog.ts");

let registry: Registry;
let catalog: Catalog;

before(async () => {
  // Deliberately importing the barrel, exactly as the routes do. Importing the
  // adapters individually here would test the test, not the product.
  await import("../src/lib/integrations/providers/all.ts");
  registry = await import("../src/lib/integrations/providers/registry.ts");
  catalog = await import("../src/lib/integrations/catalog.ts");
});

describe("the OAuth provider registry", () => {
  test("knows every provider the catalogue offers a connect route for", () => {
    const promised = catalog.PROVIDERS.filter(
      (provider) => provider.connectionMethod === "oauth" && provider.connectPath,
    );

    assert.ok(promised.length > 0, "no provider offers an OAuth connect route");

    for (const provider of promised) {
      assert.equal(
        registry.isOAuthProvider(provider.id),
        true,
        `${provider.id} has connectPath ${provider.connectPath} but no registered adapter — its Connect button 404s`,
      );
    }
  });

  test("Meta specifically is registered", () => {
    // Named on its own because it is the headline lead source, and because it
    // is the one that was broken.
    assert.equal(registry.isOAuthProvider("meta"), true);
  });

  test("a connect route exists for the path the catalogue advertises", () => {
    // The route is `/api/integrations/[provider]/connect`, so the advertised
    // path must carry the provider id the registry was keyed with — a mismatch
    // here is the same 404 by a different route.
    for (const provider of catalog.PROVIDERS) {
      if (!provider.connectPath) continue;
      assert.equal(
        provider.connectPath,
        `/api/integrations/${provider.id}/connect`,
        provider.id,
      );
    }
  });

  test("a registered adapter can produce its authorize config", () => {
    // `getConfig()` returning null is legitimate — it means the deployment
    // lacks the credentials — but it must not throw, because the route reads it
    // before it has anything to catch with.
    for (const provider of catalog.PROVIDERS) {
      if (!registry.isOAuthProvider(provider.id)) continue;
      assert.doesNotThrow(() => registry.getOAuthProviderConfig(provider.id), provider.id);
    }
  });
});
