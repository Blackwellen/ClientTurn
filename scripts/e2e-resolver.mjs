/**
 * A Node resolver hook that lets the real server code run under `node --test`.
 *
 * The application is written for Next's resolver: it imports `@/lib/...` by
 * alias and omits file extensions. Bare Node does neither, so end-to-end tests
 * against a real database could not import the service layer at all — which is
 * exactly the code most worth testing that way.
 *
 * Three mappings, and nothing else:
 *
 *   1. `@/x` → `<repo>/src/x`, matching the `paths` entry in tsconfig.
 *   2. An extensionless specifier resolves to `.ts`, `.tsx`, or `/index.ts`.
 *   3. `server-only` becomes a no-op. It is a build-time guard that makes a
 *      bundler fail if server code reaches a client bundle; under Node there is
 *      no bundle and no client, so the guard has nothing to protect and its
 *      absence changes no behaviour under test.
 *
 * Deliberately not a transform: Node compiles the TypeScript itself. This only
 * answers "which file", so a test cannot accidentally exercise a different
 * build of the code from the one that ships.
 *
 * Usage: node --import ./scripts/e2e-resolver.mjs --test tests/whatever.test.ts
 */

import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".mjs"];

/** The first candidate that exists on disk, or null. */
function firstExisting(basePath) {
  if (existsSync(basePath) && path.extname(basePath)) return basePath;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  // `server-only` is a bundler assertion. Under Node it has nothing to assert.
  if (specifier === "server-only" || specifier === "client-only") {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(repoRoot, "scripts", "e2e-noop.mjs")).href,
    };
  }

  if (specifier.startsWith("@/")) {
    const resolved = firstExisting(path.join(srcRoot, specifier.slice(2)));
    if (resolved) {
      return { shortCircuit: true, url: pathToFileURL(resolved).href };
    }
  }

  // A relative import with no extension, from a file we already resolved.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = firstExisting(path.resolve(parentDir, specifier));
    if (resolved) {
      return { shortCircuit: true, url: pathToFileURL(resolved).href };
    }
  }

  return nextResolve(specifier, context);
}

register(import.meta.url, pathToFileURL("./"));
