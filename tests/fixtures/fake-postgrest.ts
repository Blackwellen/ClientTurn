/**
 * A tiny in-memory PostgREST, served through `globalThis.fetch`, so the real
 * server code (supabase-js + postgrest-js) can run end to end under
 * `node --test` without a database or a network (affiliate audit 17).
 *
 * It understands exactly what the affiliate ledger uses: select with
 * one-level embeds (`affiliates ( ... )`), eq / neq / in / is / not.is /
 * gte / lt filters (including `metadata->>key`), order, limit, count=exact
 * (HEAD), insert with unique keys (409 / 23505), upsert, update, delete, and
 * the ledger RPCs re-implemented in JS. Anything else throws, loudly, so a
 * test can never pass by accident on an unsupported query.
 */

type Row = Record<string, unknown>;
type Rpc = (db: FakeDb, args: Record<string, unknown>) => unknown;

export type FakeDb = {
  tables: Map<string, Row[]>;
  unique: Map<string, string[][]>;
  rpcs: Map<string, Rpc>;
  calls: { method: string; table: string }[];
};

let idCounter = 0;
export function fakeId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

export function createFakeDb(): FakeDb {
  return { tables: new Map(), unique: new Map(), rpcs: new Map(), calls: [] };
}

export function table(db: FakeDb, name: string): Row[] {
  if (!db.tables.has(name)) db.tables.set(name, []);
  return db.tables.get(name)!;
}

function read(row: Row, key: string): unknown {
  const arrow = key.indexOf("->>");
  if (arrow >= 0) {
    const obj = row[key.slice(0, arrow)] as Record<string, unknown> | null | undefined;
    const value = obj?.[key.slice(arrow + 3)];
    return value === undefined || value === null ? null : String(value);
  }
  return row[key];
}

function parseList(value: string): string[] {
  return value.replace(/^\(/, "").replace(/\)$/, "").split(",").map((part) => part.replace(/^"|"$/g, ""));
}

function matches(row: Row, key: string, raw: string): boolean {
  const value = read(row, key);
  const [op, ...rest] = raw.split(".");
  const arg = rest.join(".");
  const str = value === null || value === undefined ? null : String(value);
  switch (op) {
    case "eq":
      return str === arg;
    case "neq":
      return str !== null && str !== arg;
    case "in":
      return str !== null && parseList(arg).includes(str);
    case "is":
      return arg === "null" ? value === null || value === undefined : String(value) === arg;
    case "not": {
      const [innerOp, ...innerRest] = arg.split(".");
      return !matches(row, key, `${innerOp}.${innerRest.join(".")}`);
    }
    case "gte":
      return str !== null && (typeof value === "number" ? value >= Number(arg) : str >= arg);
    case "lt":
      return str !== null && (typeof value === "number" ? value < Number(arg) : str < arg);
    case "lte":
      return str !== null && (typeof value === "number" ? value <= Number(arg) : str <= arg);
    default:
      throw new Error(`fake-postgrest: unsupported filter ${key}=${raw}`);
  }
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (RESERVED.has(key)) continue;
    out = out.filter((row) => matches(row, key, raw));
  }
  return out;
}

function embeds(select: string | null): { name: string }[] {
  if (!select) return [];
  const found: { name: string }[] = [];
  const pattern = /([a-z_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(select)) !== null) found.push({ name: match[1] });
  return found;
}

function withEmbeds(db: FakeDb, rows: Row[], select: string | null): Row[] {
  const list = embeds(select);
  if (list.length === 0) return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    const copy: Row = { ...row };
    for (const embed of list) {
      const fk = `${embed.name.replace(/s$/, "")}_id`;
      const related = table(db, embed.name).find((candidate) => candidate.id === row[fk]) ?? null;
      copy[embed.name] = related ? { ...related } : null;
    }
    return copy;
  });
}

function ordered(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const [col, dir] = order.split(",")[0].split(".");
  return [...rows].sort((a, b) => {
    const x = String(a[col] ?? "");
    const y = String(b[col] ?? "");
    return dir === "desc" ? y.localeCompare(x) : x.localeCompare(y);
  });
}

function uniqueViolation(db: FakeDb, name: string, candidate: Row, ignoreId?: unknown): boolean {
  for (const cols of db.unique.get(name) ?? []) {
    if (cols.some((col) => candidate[col] === null || candidate[col] === undefined)) continue;
    const clash = table(db, name).some(
      (row) => row.id !== ignoreId && cols.every((col) => row[col] === candidate[col]),
    );
    if (clash) return true;
  }
  return false;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

export function installFakeFetch(db: FakeDb): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const prefer = headers.get("Prefer") ?? "";
    const path = url.pathname.replace(/^\/rest\/v1\//, "");

    if (path.startsWith("rpc/")) {
      const name = path.slice(4);
      const fn = db.rpcs.get(name);
      if (!fn) throw new Error(`fake-postgrest: no rpc ${name}`);
      const args = init?.body ? JSON.parse(String(init.body)) : {};
      db.calls.push({ method: "RPC", table: name });
      return json(fn(db, args));
    }

    const name = path;
    const rows = table(db, name);
    const params = url.searchParams;
    db.calls.push({ method, table: name });

    if (method === "GET" || method === "HEAD") {
      let found = filterRows(rows, params);
      found = ordered(found, params.get("order"));
      const limit = params.get("limit");
      if (limit) found = found.slice(0, Number(limit));
      const total = found.length;
      if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": `0-${Math.max(0, total - 1)}/${total}` } });
      const body = withEmbeds(db, found, params.get("select"));
      if ((headers.get("Accept") ?? "").includes("vnd.pgrst.object+json")) {
        if (body.length !== 1) return json({ code: "PGRST116", message: "not one row" }, 406);
        return json(body[0]);
      }
      return json(body, 200, { "content-range": `0-${Math.max(0, total - 1)}/${total}` });
    }

    if (method === "POST") {
      const payload = JSON.parse(String(init?.body ?? "null"));
      const list: Row[] = Array.isArray(payload) ? payload : [payload];
      const upsert = /resolution=(merge|ignore)-duplicates/.exec(prefer);
      const conflict = params.get("on_conflict")?.split(",") ?? null;
      const written: Row[] = [];
      for (const item of list) {
        const candidate: Row = { id: fakeId(), created_at: new Date().toISOString(), ...item };
        if (upsert && conflict) {
          const existing = rows.find((row) => conflict.every((col) => row[col] === candidate[col]));
          if (existing) {
            if (upsert[1] === "merge") Object.assign(existing, item);
            written.push(existing);
            continue;
          }
        }
        if (uniqueViolation(db, name, candidate)) {
          return json({ code: "23505", message: `duplicate key value violates unique constraint on ${name}` }, 409);
        }
        rows.push(candidate);
        written.push(candidate);
      }
      if (prefer.includes("return=representation")) {
        const body = withEmbeds(db, written, params.get("select"));
        if ((headers.get("Accept") ?? "").includes("vnd.pgrst.object+json")) return json(body[0], 201);
        return json(body, 201);
      }
      return new Response(null, { status: 201 });
    }

    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body ?? "{}")) as Row;
      const found = filterRows(rows, params);
      for (const row of found) {
        const next = { ...row, ...patch };
        if (uniqueViolation(db, name, next, row.id)) return json({ code: "23505", message: "duplicate" }, 409);
        Object.assign(row, patch);
      }
      if (prefer.includes("return=representation")) return json(withEmbeds(db, found, params.get("select")));
      return new Response(null, { status: 204 });
    }

    if (method === "DELETE") {
      const found = new Set(filterRows(rows, params));
      db.tables.set(name, rows.filter((row) => !found.has(row)));
      return new Response(null, { status: 204 });
    }

    throw new Error(`fake-postgrest: unsupported ${method} ${url.pathname}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
