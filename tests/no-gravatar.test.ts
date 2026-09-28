import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * No avatar lookup by email address.
 *
 * Lead avatars used to be requested from Gravatar with an MD5 hash of the
 * lead's email: personal data about a third party, sent to a service the
 * privacy policy does not name, on every render. Avatars are now initials, or
 * an image held in our own storage (R2 uploads, the same-origin avatar proxy).
 *
 * This guard reads every source file and fails on:
 *   - any reference to gravatar.com (or a lookalike avatar-by-email service);
 *   - any file that hashes something and also builds an avatar URL, which is
 *     what an avatar-from-email-hash helper looks like whatever it is called.
 */

const root = path.resolve(import.meta.dirname, "..");
const SOURCE_DIRS = ["src"];
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [
  ...SOURCE_DIRS.flatMap((dir) => walk(path.join(root, dir))),
  path.join(root, "next.config.ts"),
];

const REMOTE_AVATAR_SERVICES = /gravatar\.com|libravatar\.org|unavatar\.io|avatars\.io/i;
const HASHING = /createHash\s*\(|crypto\.subtle\.digest\s*\(|\bmd5\s*\(/;
const AVATAR_URL = /avatar[^\n]{0,80}(https?:\/\/|`\$\{)|\/avatar\/\$\{/i;

describe("no remote avatar lookup by email", () => {
  test("the guard actually read the source tree", () => {
    assert.ok(files.length > 100, `only ${files.length} files found`);
  });

  test("no source file references gravatar.com or a similar service", () => {
    const hits = files
      .filter((file) => REMOTE_AVATAR_SERVICES.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    assert.deepEqual(hits, [], `remote avatar service referenced in: ${hits.join(", ")}`);
  });

  test("no source file builds an avatar URL from a hash", () => {
    const hits = files
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return HASHING.test(source) && AVATAR_URL.test(source);
      })
      .map((file) => path.relative(root, file));
    assert.deepEqual(hits, [], `avatar URL built from a hash in: ${hits.join(", ")}`);
  });

  test("the lead list no longer attaches an email-derived avatar", () => {
    const queries = readFileSync(path.join(root, "src/lib/leads/queries.ts"), "utf8");
    assert.doesNotMatch(queries, /avatarUrl\s*:\s*\w+\(\s*row\.email/);
  });

  test("the avatar proxy does not allow a Gravatar host", () => {
    const route = readFileSync(
      path.join(root, "src/app/api/avatar/[scope]/[id]/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(route, /gravatar/i);
  });
});
