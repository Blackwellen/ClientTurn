/**
 * Reads and updates the Supabase Auth redirect allow-list for the linked
 * project, through the Management API.
 *
 *   node scripts/auth-redirects.mjs --list           # show site URL + allow-list
 *   node scripts/auth-redirects.mjs --add <url> ...  # add entries (idempotent)
 *   node scripts/auth-redirects.mjs --remove <url>   # drop entries
 *
 * `uri_allow_list` is what Supabase checks a magic-link / OAuth `redirect_to`
 * against. A redirect that is not on it is silently rewritten to the project's
 * Site URL, which is why a local sign-in link appears to "work" but lands on
 * production.
 *
 * Entries are always merged, never replaced — the existing list is read first
 * and printed before and after, so a change is reviewable. Credentials come
 * from .env / .env.local and are never printed.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file, key) {
  try {
    const text = readFileSync(join(root, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* file may not exist */
  }
  return null;
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? readEnv(".env", "SUPABASE_PAT");
const REF = process.env.SUPABASE_PROJECT_REF ?? readEnv(".env.local", "SUPABASE_PROJECT_REF");

if (!TOKEN) throw new Error("SUPABASE_PAT not found in .env");
if (!REF) throw new Error("SUPABASE_PROJECT_REF not found in .env.local");

const ENDPOINT = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function getConfig() {
  const response = await fetch(ENDPOINT, { headers });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`GET failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** Supabase stores the allow-list as a single comma-separated string. */
function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function show(label, entries) {
  console.log(`${label} (${entries.length}):`);
  for (const entry of entries) console.log(`  ${entry}`);
}

const args = process.argv.slice(2);
const mode = args[0];
const values = args.slice(1);

const config = await getConfig();
const current = splitList(config.uri_allow_list);

if (mode === "--list" || !mode) {
  console.log(`site_url: ${config.site_url}`);
  show("uri_allow_list", current);
  process.exit(0);
}

if (mode !== "--add" && mode !== "--remove") {
  throw new Error("Usage: --list | --add <url>... | --remove <url>...");
}
if (values.length === 0) throw new Error(`${mode} needs at least one URL`);

const next =
  mode === "--add"
    ? [...current, ...values.filter((value) => !current.includes(value))]
    : current.filter((entry) => !values.includes(entry));

if (next.length === current.length && mode === "--add") {
  show("unchanged — already present", current);
  process.exit(0);
}

show("before", current);

const response = await fetch(ENDPOINT, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ uri_allow_list: next.join(",") }),
});
const body = await response.json();
if (!response.ok) {
  throw new Error(`PATCH failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
}

show("after", splitList(body.uri_allow_list));
