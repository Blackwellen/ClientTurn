/**
 * Extra resolver hook for tests/stories/find-leads-engagement.test.ts: the
 * SMTP boundary (`nodemailer`) is replaced by fakes/nodemailer.mjs. Registered
 * after story-hooks.mjs, so it runs first and hands everything else on.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export function resolve(specifier, context, nextResolve) {
  if (specifier === "nodemailer") {
    return { shortCircuit: true, url: pathToFileURL(path.join(here, "fakes", "nodemailer.mjs")).href };
  }
  return nextResolve(specifier, context);
}
