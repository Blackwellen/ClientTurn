/**
 * Seeds a throwaway workspace with a real API key, for driving the HTTP
 * surfaces by hand.
 *
 * The key is minted by the real `createApiKey`, not hand-inserted, so what the
 * subsequent curl calls exercise is the same credential path a customer's key
 * takes. It prints the key once, exactly as the product does.
 *
 * Local Supabase only, and it refuses to run against anything else — this
 * creates auth users and a business, which has no business happening in a
 * deployment.
 *
 *   npx supabase start
 *   node --env-file=.env.e2e --import ./scripts/e2e-resolver.mjs \
 *     scripts/seed-developer-fixture.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(
    `Refusing to seed fixtures into ${url}. This script is for a local Supabase only.`,
  );
}

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();

const { data: user, error: userError } = await admin.auth.admin.createUser({
  email: `devfixture-${stamp}@example.test`,
  password: "DevFixture!2026pw",
  email_confirm: true,
});
if (userError) throw userError;

const { data: business, error: businessError } = await admin
  .from("businesses")
  .insert({
    name: "Developer Fixture Ltd",
    slug: `devfixture-${stamp}`,
    status: "active",
  })
  .select("id")
  .single();
if (businessError) throw businessError;

await admin.from("business_members").insert({
  business_id: business.id,
  user_id: user.user.id,
  role: "admin",
  status: "active",
});

const { data: lead } = await admin
  .from("leads")
  .insert({
    business_id: business.id,
    first_name: "Priya",
    last_name: "Shah",
    email: `priya-${stamp}@example.co.uk`,
    phone: "+447700900123",
    postcode: "M1 2AB",
    status: "NEW",
  })
  .select("id")
  .single();

const { createApiKey } = await import("../src/lib/api-keys/service.ts");
const key = await createApiKey({
  businessId: business.id,
  userId: user.user.id,
  createdBy: user.user.id,
  name: "Local HTTP fixture",
  environment: "live",
  scopes: ["leads:read", "leads:write", "business:read"],
});

if (!key) throw new Error("the key could not be created");

console.log(
  JSON.stringify(
    {
      businessId: business.id,
      userId: user.user.id,
      leadId: lead?.id ?? null,
      apiKey: key.key,
    },
    null,
    2,
  ),
);
