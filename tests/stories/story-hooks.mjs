/**
 * Resolver hooks for the business stories, registered at runtime by the story
 * file (after scripts/e2e-resolver.mjs, so these run first).
 *
 * Only two boundaries are substituted, both outside ClientTurn's own logic:
 *
 *   - `@/lib/auth/session`: the signed-in user comes from Next's request
 *     cookies, which do not exist under `node --test`. The fake returns the
 *     story's owner membership, read from a global the story sets. Every
 *     role check the server actions make still runs against that answer.
 *   - `next/cache`: `revalidatePath` needs a Next render context; a no-op here.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

const SUBSTITUTES = {
  "@/lib/auth/session": path.join(here, "fakes", "session.ts"),
  "next/cache": path.join(here, "fakes", "next-cache.mjs"),
  "@/lib/supabase/server": path.join(here, "fakes", "supabase-server.ts"),
};

export function resolve(specifier, context, nextResolve) {
  // Next's package has no exports map for these subpaths; Node's ESM resolver
  // needs the file name. Same module, just addressed the way Node can find it.
  if (specifier === "next/server" || specifier === "next/headers") {
    return nextResolve(`${specifier}.js`, context);
  }
  const target = SUBSTITUTES[specifier];
  if (target) return { shortCircuit: true, url: pathToFileURL(target).href };
  return nextResolve(specifier, context);
}
