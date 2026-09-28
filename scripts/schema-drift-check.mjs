#!/usr/bin/env node
/**
 * READ-ONLY schema/code drift check against the live project.
 *
 *   node scripts/schema-drift-check.mjs [--json]      against the live project
 *   node scripts/schema-drift-check.mjs --offline     against src/lib/supabase/database.types.ts
 *                                                     (generated from live; used by the test suite)
 *
 * Many query sites use an untyped client (`as unknown as SupabaseClient`), so
 * `tsc` cannot see a column the code reads or writes that does not exist in
 * the database. This scans every `.from("table")` chain under src/ and checks,
 * against information_schema (through the Management API, inside a read-only
 * transaction):
 *
 *   - the table or view exists;
 *   - columns named in `.select("...")` (top level; embedded relations are
 *     skipped), in filters (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is`,
 *     `not`, `like`, `ilike`, `contains`, `order`), in `onConflict`, and the
 *     top-level keys of object literals passed to `insert`/`update`/`upsert`;
 *   - `.rpc("name")` functions exist in public.
 *
 * Heuristic by design: strings built at runtime are skipped, and `const X =
 * "..."` column lists in the same file are resolved. Code that deliberately
 * tolerates a missing column (a schema-lag fallback on 42703/PGRST204) shows
 * up too; each finding says where, so it can be read in context.
 */
import fs from "node:fs";
import path from "node:path";

const read = (file) => {
  try {
    return Object.fromEntries(
      fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
      }),
    );
  } catch {
    return {};
  }
};
const env = { ...read(".env"), ...read(".env.local") };

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `begin transaction read only; ${query};` }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

/** The public schema as `database.types.ts` describes it (Tables/Views Row keys, Functions). */
function offlineSchema() {
  const text = fs.readFileSync("src/lib/supabase/database.types.ts", "utf8").replace(/\r/g, "");
  const pub = text.slice(text.indexOf("  public: {"));
  const section = (name, next) => pub.slice(pub.indexOf(`    ${name}: {`), pub.indexOf(`    ${next}: {`));
  const cols = [];
  for (const part of [section("Tables", "Views"), section("Views", "Functions")]) {
    for (const m of part.matchAll(/\n {6}([a-z_][a-z0-9_]*): \{\n {8}Row: \{\n((?: {10}[a-z_][a-z0-9_]*\??: .*\n)*)/g)) {
      for (const c of m[2].matchAll(/ {10}([a-z_][a-z0-9_]*)\??:/g)) cols.push({ t: m[1], c: c[1] });
    }
  }
  const fns = [...section("Functions", "Enums").matchAll(/\n {6}([a-z_][a-z0-9_]*):/g)].map((m) => ({ n: m[1] }));
  return [cols, fns];
}

const offline = process.argv.includes("--offline");
if (!offline && (!env.SUPABASE_PROJECT_REF || !env.SUPABASE_PAT)) {
  console.error("SUPABASE_PROJECT_REF and SUPABASE_PAT are required (or pass --offline).");
  process.exit(2);
}
const [cols, fns] = offline
  ? offlineSchema()
  : await Promise.all([
      sql(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'`),
      sql(`select p.proname n from pg_proc p where p.pronamespace = 'public'::regnamespace`),
    ]);
const schema = new Map();
for (const { t, c } of cols) {
  if (!schema.has(t)) schema.set(t, new Set());
  schema.get(t).add(c);
}
const functions = new Set(fns.map((f) => f.n));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") && e.name !== "database.types.ts") out.push(p);
  }
  return out;
}

/** Comments blanked out (length and newlines kept), strings and regex-free code left as is. */
function stripComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      out += src[i] ?? "";
      continue;
    }
    if (ch === "/" && next === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

/** The rest of the expression starting at `i`: up to `;`, or a `,`/closer at depth 0. */
function chainAt(src, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length && j < i + 6000; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth < 0) return src.slice(i, j);
    } else if ((ch === ";" || ch === ",") && depth === 0) return src.slice(i, j);
  }
  return src.slice(i, i + 6000);
}

/** The balanced `{...}` starting at src[i] === "{". */
function objectAt(src, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

function topLevelKeys(obj) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let token = "";
  for (let j = 0; j < obj.length; j++) {
    const ch = obj[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if ("([{".includes(ch)) {
      depth++;
      if (depth === 1) token = "";
      continue;
    }
    if (")]}".includes(ch)) {
      if (depth === 1 && /^[a-z_][a-z0-9_]*$/.test(token.trim())) keys.push(token.trim()); // shorthand before `}`
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ":") {
      const k = token.trim().replace(/^["']|["']$/g, "");
      if (/^[a-z_][a-z0-9_]*$/.test(k)) keys.push(k);
      token = "";
      // skip the value to the next top-level comma
      let d = 0;
      let q = null;
      for (j = j + 1; j < obj.length; j++) {
        const c = obj[j];
        if (q) {
          if (c === "\\") j++;
          else if (c === q) q = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") q = c;
        else if ("([{".includes(c)) d++;
        else if (")]}".includes(c)) {
          if (d === 0) {
            j--;
            break;
          }
          d--;
        } else if (c === "," && d === 0) break;
      }
      continue;
    }
    if (ch === ",") {
      if (/^[a-z_][a-z0-9_]*$/.test(token.trim())) keys.push(token.trim()); // shorthand
      token = "";
      continue;
    }
    token += ch;
  }
  return keys.filter((k) => !k.startsWith("..."));
}

function selectColumns(list) {
  // Drop embedded relations `rel(...)` / `rel!fk(...)` / `alias:rel(...)`.
  let s = list;
  for (let guard = 0; guard < 20 && /\(/.test(s); guard++) s = s.replace(/[A-Za-z0-9_:!.]*\s*\([^()]*\)/g, "");
  return s
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c.includes(":") && !c.includes("::") ? c.split(":")[1] : c))
    .map((c) => c.split("::")[0].split("->")[0].trim())
    .filter((c) => c && c !== "*" && /^[a-z_][a-z0-9_]*$/.test(c));
}

function constStrings(src) {
  const map = new Map();
  const re = /const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*((?:"[^"]*"|'[^']*'|`[^`$]*`)(?:\s*\+\s*(?:"[^"]*"|'[^']*'|`[^`$]*`))*)/g;
  for (const m of src.matchAll(re)) {
    const value = [...m[2].matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((x) => x[1] ?? x[2] ?? x[3]).join("");
    map.set(m[1], value);
  }
  return map;
}

const findings = [];
let chains = 0;
for (const file of walk("src")) {
  const raw = fs.readFileSync(file, "utf8");
  const consts = constStrings(raw);
  const src = stripComments(raw);
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
    if (!functions.has(m[1])) findings.push({ file, line: lineOf(m.index), kind: "rpc", table: null, column: m[1] });
  }
  for (const m of src.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
    const table = m[1];
    const at = m.index;
    const chain = chainAt(src, at + m[0].length);
    // Storage buckets (`storage.from("bucket")`) are not tables.
    if (/storage\s*$/.test(src.slice(Math.max(0, at - 12), at))) continue;
    chains++;
    const known = schema.get(table);
    if (!known) {
      findings.push({ file, line: lineOf(at), kind: "table", table, column: null });
      continue;
    }
    const used = new Set();
    for (const s of chain.matchAll(/\.select\(\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`|([A-Z][A-Z0-9_]*))/g)) {
      const list = s[1] ?? s[2] ?? s[3] ?? consts.get(s[4] ?? "") ?? "";
      for (const c of selectColumns(list)) used.add(c);
    }
    for (const f of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|is|not|like|ilike|contains|containedBy|order)\(\s*["']([a-z_][a-z0-9_]*)["']/g)) used.add(f[1]);
    for (const o of chain.matchAll(/onConflict:\s*["']([a-z0-9_, ]+)["']/g)) for (const c of o[1].split(",")) used.add(c.trim());
    for (const w of chain.matchAll(/\.(insert|update|upsert)\(\s*(\[\s*)?\{/g)) {
      const start = w.index + w[0].length - 1;
      const obj = objectAt(chain, start);
      if (obj) for (const k of topLevelKeys(obj)) used.add(k);
    }
    for (const c of used) {
      if (!known.has(c)) findings.push({ file, line: lineOf(at), kind: "column", table, column: c });
    }
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ chains, findings }, null, 2));
} else {
  console.log(`Scanned ${chains} query chains. Findings: ${findings.length}`);
  for (const f of findings) {
    const rel = path.relative(process.cwd(), f.file).replaceAll("\\", "/");
    console.log(`  ${f.kind.padEnd(6)} ${rel}:${f.line}  ${f.table ?? ""}${f.column ? (f.table ? "." : "") + f.column : ""}`);
  }
}
process.exit(findings.length ? 1 : 0);
