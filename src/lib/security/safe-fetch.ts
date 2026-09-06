import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-hardened outbound fetch for customer-supplied URLs.
 *
 * The website analyser takes a URL from a form and fetches it from inside our
 * own network. Without this module that is a request-forgery primitive: a
 * customer could point it at `http://169.254.169.254/` and read cloud instance
 * credentials, or at an internal service that trusts network position.
 *
 * The defence has to survive three tricks, and each one has a specific answer:
 *
 *   1. A private literal (`http://10.0.0.5/`) — rejected by parsing the host.
 *   2. A hostname that *resolves* to a private address — rejected by resolving
 *      DNS ourselves and checking every returned address before connecting.
 *   3. A public URL that redirects to a private one — rejected by following
 *      redirects manually, re-validating each hop rather than letting `fetch`
 *      follow them for us.
 *
 * A DNS rebinding race (the name resolving to a public address for our check
 * and a private one for the connection) remains theoretically open; closing it
 * needs a pinned-IP connect agent. It is documented rather than hidden.
 */

export type SafeFetchError =
  | "INVALID_URL"
  | "BLOCKED_SCHEME"
  | "BLOCKED_HOST"
  | "BLOCKED_PORT"
  | "DNS_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "TIMEOUT"
  | "FETCH_FAILED";

export type SafeFetchResult =
  | { ok: true; url: string; contentType: string; body: string }
  | { ok: false; code: SafeFetchError };

const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_500_000; // 1.5 MB — a marketing page, not a download.
const TIMEOUT_MS = 10_000;

/** Only the two ports a public website is actually served on. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
]);

/**
 * Every reserved IPv4 and IPv6 range that must never be reachable from a
 * customer-supplied URL, including the cloud metadata endpoints that are the
 * usual target.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;

    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  if (version === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true; // unspecified, loopback
    if (value.startsWith("fe80")) return true; // link-local
    if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
    if (value.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:10.0.0.1) must be judged as the IPv4 address it is.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // Not an IP literal at all: the caller resolves it first.
  return true;
}

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; code: SafeFetchError };

/** Synchronous checks: scheme, port and host literals. No DNS. */
export function checkUrlShape(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "BLOCKED_SCHEME" };
  }

  // Host before port, deliberately. Both refuse, but "that address cannot be
  // reached" is the true reason for http://127.0.0.1:3000 — reporting the port
  // instead would send someone off changing a port that was never the problem.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal")) {
    return { ok: false, code: "BLOCKED_HOST" };
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    return { ok: false, code: "BLOCKED_HOST" };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, code: "BLOCKED_PORT" };
  }

  return { ok: true, url };
}

/** Resolves the host and rejects it if *any* address it maps to is private. */
async function checkResolvesPublic(hostname: string): Promise<SafeFetchError | null> {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(bare)) return isPrivateAddress(bare) ? "BLOCKED_HOST" : null;

  try {
    const addresses = await lookup(bare, { all: true });
    if (addresses.length === 0) return "DNS_FAILED";
    // All, not some: a host with one public and one private A record must not
    // be reachable, because we do not control which one connect() picks.
    if (addresses.some((entry) => isPrivateAddress(entry.address))) return "BLOCKED_HOST";
    return null;
  } catch {
    return "DNS_FAILED";
  }
}

/** Full validation, including DNS. Use before any outbound request. */
export async function assertSafeUrl(raw: string): Promise<UrlCheck> {
  const shape = checkUrlShape(raw);
  if (!shape.ok) return shape;

  const dnsProblem = await checkResolvesPublic(shape.url.hostname);
  if (dnsProblem) return { ok: false, code: dnsProblem };

  return shape;
}

const ALLOWED_CONTENT = ["text/html", "application/xhtml+xml", "text/plain"];

/**
 * Fetches a public page, re-validating every redirect hop.
 *
 * `redirect: "manual"` is the important part: letting the platform follow a
 * redirect would skip every check above for the hop that actually matters.
 */
export async function safeFetchText(raw: string): Promise<SafeFetchResult> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await assertSafeUrl(target);
    if (!check.ok) return { ok: false, code: check.code };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(check.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Identifying the crawler is the polite minimum, and lets a site
          // block us deliberately rather than by guessing.
          "user-agent": "ClientTurnBot/1.0 (+https://clientturn.com/bot)",
          accept: "text/html,application/xhtml+xml",
        },
        cache: "no-store",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, code: "FETCH_FAILED" };
        target = new URL(location, check.url).toString();
        continue;
      }

      if (!response.ok) return { ok: false, code: "FETCH_FAILED" };

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!ALLOWED_CONTENT.some((allowed) => contentType.includes(allowed))) {
        return { ok: false, code: "UNSUPPORTED_CONTENT_TYPE" };
      }

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) return { ok: false, code: "RESPONSE_TOO_LARGE" };

      const body = await readBounded(response);
      if (body === null) return { ok: false, code: "RESPONSE_TOO_LARGE" };

      return { ok: true, url: check.url.toString(), contentType, body };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { ok: false, code: aborted ? "TIMEOUT" : "FETCH_FAILED" };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, code: "TOO_MANY_REDIRECTS" };
}

/**
 * Reads at most MAX_BYTES.
 *
 * A server that lies in `content-length`, or omits it, must not be able to
 * stream unbounded data into our memory — so the cap is enforced on the actual
 * bytes read, not on the header.
 */
async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
