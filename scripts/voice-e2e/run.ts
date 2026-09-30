/**
 * CLI for the voice wiring harness.
 *
 *   node --env-file=.env --env-file=.env.local \
 *     --import ./scripts/lib/egress-guard.mjs --import ./scripts/lib/voice-e2e-fakes.mjs \
 *     --import ./scripts/e2e-resolver.mjs scripts/voice-e2e/run.ts [--base http://localhost:3107] [--only google,calendly,none,optout] [-v]
 *
 * With --base the steps go over HTTP to a local server started with the same
 * two preloads and RETELL_SECRET_KEY=voice-e2e-fake-retell-key (see
 * scripts/voice-e2e-wiring.mjs); without it the route handlers run in-process.
 */
import { register } from "node:module";
import { VoiceHarness, FAKE_RETELL_KEY } from "./harness.ts";
import { latencySummary, optOutCall, qualificationCall } from "./scenarios.ts";

register("./hooks.mjs", import.meta.url);

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
if (process.env.RETELL_SECRET_KEY !== FAKE_RETELL_KEY) {
  console.error(`Set RETELL_SECRET_KEY=${FAKE_RETELL_KEY} (the harness signs with the fake key; the real one is never used).`);
  process.exit(2);
}
if (!process.env.VOICE_E2E_STATE) {
  console.error("Set VOICE_E2E_STATE (and VOICE_E2E_LOG) so the provider fakes answer.");
  process.exit(2);
}
const only = (flag("--only") ?? "google,calendly,none,optout").split(",");
const h = new VoiceHarness({
  baseUrl: flag("--base"),
  statePath: process.env.VOICE_E2E_STATE,
  logPath: process.env.VOICE_E2E_LOG ?? `${process.env.VOICE_E2E_STATE}.log`,
  verbose: argv.includes("-v"),
});

let crashed: unknown = null;
try {
  await h.setup();
  // Dev-mode compiles a route on its first request: warm both up (unsigned, 401) so latency is the handler's.
  if (h.opts.baseUrl) {
    for (const path of ["/api/voice/tools/get_call_status", "/api/webhooks/retell"]) await fetch(`${h.opts.baseUrl}${path}`, { method: "POST", body: "{}" }).catch(() => null);
  }
  await h.grantMinutes();
  for (const cal of ["google", "calendly", "none"] as const) if (only.includes(cal)) await qualificationCall(h, cal);
  if (only.includes("optout")) await optOutCall(h);
} catch (error) {
  crashed = error;
  console.error("HARNESS CRASHED", error);
} finally {
  try {
    await h.cleanup();
  } catch (error) {
    console.error("CLEANUP FAILED", error);
  }
}
const report = h.report();
console.log("\n=== latency (ms) ===");
console.table(latencySummary(h));
console.log(`\n=== ${report.checks.length - report.failures.length}/${report.checks.length} checks passed ===`);
for (const f of report.failures) console.log(`FAIL [${f.step}] ${f.name} :: ${f.detail ?? ""}`);
for (const n of report.notes) console.log(`note: ${n}`);
process.exit(crashed || report.failures.length ? 1 : 0);
