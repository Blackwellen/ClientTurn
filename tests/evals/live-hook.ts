/**
 * Live-model eval hook (EVAL_LIVE=1). Scaffold only.
 *
 * The deterministic runner never calls a model. A live run needs a runner that
 * drives the real agent turn for a case -- server env, Azure credentials, a
 * seeded workspace -- and returns what it would have sent. That runner is not
 * wired yet; until it is, a live run fails loudly rather than passing vacuously.
 *
 * To wire it: export a `LiveRunner` from a module that imports the agent
 * orchestrator's compose path (run under scripts/e2e-resolver.mjs with an
 * .env.e2e), and return it from `loadLiveRunner`.
 */

import type { EvalCase } from "./types.ts";

export type LiveResult = {
  /** The outbound message the agent would have sent, or null for none. */
  reply: string | null;
  handedOver: boolean;
  /** Optional quality score 0-1 from a grader, recorded not asserted. */
  qualityScore?: number | null;
};

export type LiveRunner = (evalCase: EvalCase) => Promise<LiveResult>;

export const LIVE_MODE = process.env.EVAL_LIVE === "1";

export async function loadLiveRunner(): Promise<LiveRunner | null> {
  return null;
}
