/**
 * Network egress guard for the help-centre demo scripts.
 *
 * Loaded with `node --import ./scripts/lib/egress-guard.mjs` (the seed script,
 * and the dev server the screenshot capture starts, through NODE_OPTIONS). It
 * refuses every outbound connection except:
 *
 *   - the Supabase project in NEXT_PUBLIC_SUPABASE_URL (the demo workspace's
 *     own database), and the Supabase Management API host (read-only checks);
 *   - loopback (the dev server talking to itself);
 *   - Google Fonts (next/font downloads the app's typeface in development);
 *   - anything listed in EGRESS_GUARD_ALLOW (comma-separated host names).
 *
 * So no page render, server action or job handler reached from these scripts
 * can call Twilio, Retell, Stripe, Meta, Google Ads, Azure OpenAI, Resend or any
 * other provider, whatever the environment holds. A refused attempt throws
 * `BLOCKED_EGRESS <kind> <host>` and is appended to EGRESS_GUARD_LOG (when set)
 * so the capture run can report every call that was stopped.
 *
 * Same technique as tests/stories/safety.ts: socket-level `net.connect` /
 * `tls.connect` (which Node's own fetch uses), `http(s).request`, and fetch.
 */
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Read at call time: Next loads .env files after this preload has run.
function supabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

const ALLOWED = new Set(
  [
    "api.supabase.com",
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    ...(process.env.EGRESS_GUARD_ALLOW ?? "").split(",").map((h) => h.trim()),
  ].filter(Boolean),
);

function allowed(host) {
  if (!host) return true; // an IPC path (named pipe / unix socket), not the network
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  const project = supabaseHost();
  return ALLOWED.has(h) || h.endsWith(".localhost") || (project !== "" && h === project);
}

function record(kind, host) {
  const line = `${new Date().toISOString()} BLOCKED ${kind} ${host} pid=${process.pid}\n`;
  if (process.env.EGRESS_GUARD_LOG) {
    try {
      appendFileSync(process.env.EGRESS_GUARD_LOG, line);
    } catch {
      /* the throw below is what matters */
    }
  }
  if (process.env.EGRESS_GUARD_QUIET !== "1") process.stderr.write(`[egress-guard] ${line}`);
}

function deny(kind, host) {
  record(kind, host);
  throw new Error(`BLOCKED_EGRESS ${kind} ${host}`);
}

function socketHost(args) {
  const first = args[0];
  if (first && typeof first === "object") {
    if (first.path) return "";
    return first.servername || first.host || first.hostname || "localhost";
  }
  if (typeof first === "number") return String(args[1] ?? "localhost");
  if (typeof first === "string" && !/^\d+$/.test(first)) return ""; // an IPC path
  return String(first ?? "localhost");
}

const realTls = tls.connect;
const realNet = net.connect;
tls.connect = function (...args) {
  const host = socketHost(args);
  if (!allowed(host)) deny("tls", host);
  return realTls.apply(this, args);
};
const netConnect = function (...args) {
  const host = socketHost(args);
  if (!allowed(host)) deny("net", host);
  return realNet.apply(this, args);
};
net.connect = netConnect;
net.createConnection = netConnect;

for (const [name, mod] of [["http", http], ["https", https]]) {
  const realRequest = mod.request;
  const realGet = mod.get;
  const hostOf = (target) => {
    if (typeof target === "string") {
      try {
        return new URL(target).hostname;
      } catch {
        return target;
      }
    }
    if (target instanceof URL) return target.hostname;
    if (target && typeof target === "object") {
      if (target.socketPath) return "";
      return target.hostname ?? (target.host ? String(target.host).split(":")[0] : "localhost");
    }
    return "localhost";
  };
  mod.request = function (...args) {
    const host = hostOf(args[0]);
    if (!allowed(host)) deny(name, host);
    return realRequest.apply(this, args);
  };
  mod.get = function (...args) {
    const host = hostOf(args[0]);
    if (!allowed(host)) deny(name, host);
    return realGet.apply(this, args);
  };
}

if (typeof globalThis.fetch === "function") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    let host = "";
    try {
      const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      host = url.hostname;
    } catch {
      /* a relative URL: let the real fetch reject it */
    }
    if (host && !allowed(host)) {
      record("fetch", host);
      return Promise.reject(new Error(`BLOCKED_EGRESS fetch ${host}`));
    }
    return realFetch.call(this, input, init);
  };
}

syncBuiltinESMExports();

export const EGRESS_ALLOWED_HOSTS = () => [...ALLOWED, supabaseHost()].filter(Boolean);
