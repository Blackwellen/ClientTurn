/**
 * Development helper: mints a one-time sign-in link for a workspace member so
 * a local dev server can be driven through the product's real auth flow.
 *
 *   node scripts/dev-login-link.mjs <email> [origin]
 *
 * The link points at the app's own /auth/callback, which exchanges the code and
 * sets the session cookies — nothing here forges or injects a session. `origin`
 * must be on the project's auth redirect allow-list (see auth-redirects.mjs).
 *
 * Refuses to run against a production origin, and prints only the URL.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file, key) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* file may not exist */
  }
  return null;
}

const email = process.argv[2];
const origin = process.argv[3] ?? "http://localhost:3001";
if (!email) throw new Error("Usage: node scripts/dev-login-link.mjs <email> [origin]");

const host = new URL(origin).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error("Refusing to mint a login link for a non-local origin.");
}

const url = readEnv(".env.local", "NEXT_PUBLIC_SUPABASE_URL");
const key = readEnv(".env.local", "SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("Supabase URL / service role key not found in .env.local");

const response = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "magiclink",
    email,
    redirect_to: `${origin}/auth/callback?next=/app/leads`,
  }),
});
const body = await response.json();
if (!response.ok) {
  throw new Error(`generate_link failed (${response.status}): ${JSON.stringify(body).slice(0, 200)}`);
}
console.log(body.action_link ?? body.properties?.action_link);
