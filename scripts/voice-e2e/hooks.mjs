/**
 * Resolver hooks for the voice wiring harness, registered after
 * scripts/e2e-resolver.mjs. Only Next's own boundaries are addressed:
 *   - `next/server` and `next/headers` have no exports map for Node's ESM
 *     resolver: the same files, by their `.js` name;
 *   - `next/cache` needs a Next render context: the business stories' no-op.
 * No ClientTurn module is substituted.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEXT_CACHE = pathToFileURL(path.join(root, "tests", "stories", "fakes", "next-cache.mjs")).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server" || specifier === "next/headers" || specifier === "next/navigation") return nextResolve(`${specifier}.js`, context);
  if (specifier === "next/cache") return { shortCircuit: true, url: NEXT_CACHE };
  return nextResolve(specifier, context);
}
