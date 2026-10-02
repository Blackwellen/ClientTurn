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

/*
 * REAL mode (owner, 2026-09-30: "make all providers real, no faked"):
 *
 *   node --env-file=.env --env-file=.env.local --import ./scripts/e2e-resolver.mjs  *     scripts/voice-e2e/run.ts --real --base http://localhost:3401 [--business <id>] [-v]
 *
 * No egress guard and no provider fakes (refused if they are loaded). It
 *   1. probes the live providers read-only (real-probes.ts): Retell agent, LLM,
 *      tools, number import; each calendar connection of the workspace through
 *      the app's refresh-aware accessor and health ping;
 *   2. proves the signed path end to end with the REAL Retell key against the
 *      running server: a synthetic DIALLING call on the paused demo workspace,
 *      get_call_status and record_fact signed like Retell (accepted), the same
 *      body under a forged key (refused), then cleans up.
 * A synthetic call id does not exist at Retell, so the post-call chain (which
 * reads the call back from Retell) and a real conversation are proven only by
 * a real call: see the owner call script. The fake mode below is unchanged and
 * is what tests/voice-e2e-wiring.test.ts uses.
 */
if (argv.includes("--real")) {
  const { probeCalendars, probeRetell, OWNER_WORKSPACE } = await import("./real-probes.ts");
  const key = process.env.RETELL_SECRET_KEY ?? process.env.RETELL_API_KEY ?? "";
  if (!key || key === FAKE_RETELL_KEY) {
    console.error("REAL mode needs the real RETELL_SECRET_KEY (never the fake one).");
    process.exit(2);
  }
  if (process.env.VOICE_E2E_STATE) {
    console.error("REAL mode refuses to run with the provider fakes loaded (unset VOICE_E2E_STATE, drop the fakes preload).");
    process.exit(2);
  }
  const base = flag("--base");
  const business = flag("--business") ?? OWNER_WORKSPACE;
  const h = new VoiceHarness({ baseUrl: base, statePath: "", logPath: "", verbose: argv.includes("-v"), retellKey: key });
  let crashedReal: unknown = null;
  try {
    await probeRetell(h, business);
    await probeCalendars(h, business);
    if (base) {
      await h.setup();
      h.step = "real:signed-tools";
      const lead = await h.createLead("real");
      const call = await h.createCall(lead);
      const status = await h.tool(call, "get_call_status", {});
      h.check("real key: signed get_call_status accepted", status.status === 200 && status.json?.ok === true, status.json);
      const fact = await h.tool(call, "record_fact", { dimension: "budget", value: "about ten thousand pounds", confirmed: true });
      h.check("real key: signed record_fact accepted", fact.status === 200, fact.json);
      const forged = await h.tool(call, "get_call_status", {}, { key: "forged-key", toolCallId: "forged-1" });
      h.check("forged key refused", forged.status === 401, forged.status);
      const hook = await h.webhook("call_started", { call_id: call.providerCallId, call_status: "ongoing", metadata: { voice_call_id: call.id }, start_timestamp: Date.now() });
      h.check("real key: signed call webhook accepted", hook === 204, hook);
    } else {
      h.notes.push("no --base: the signed-endpoint step was skipped");
    }
  } catch (error) {
    crashedReal = error;
    console.error("REAL HARNESS CRASHED", error);
  } finally {
    if (base) {
      try {
        await h.cleanup();
      } catch (error) {
        console.error("CLEANUP FAILED", error);
      }
    }
  }
  const rep = h.report();
  for (const c of rep.checks) console.log(`${c.ok ? " ok " : "FAIL"} [${c.step}] ${c.name}${c.ok ? "" : ` :: ${c.detail ?? ""}`}`);
  for (const n of rep.notes) console.log(`note: ${n}`);
  console.log(`
=== REAL: ${rep.checks.length - rep.failures.length}/${rep.checks.length} checks passed ===`);
  process.exit(crashedReal || rep.failures.length ? 1 : 0);
}

// FAKE mode (the default; what tests/voice-e2e-wiring.test.ts uses).
if (process.env.RETELL_SECRET_KEY !== FAKE_RETELL_KEY) {
  console.error(`Set RETELL_SECRET_KEY=${FAKE_RETELL_KEY} (the harness signs with the fake key; the real one is never used). For the real providers, pass --real.`);
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
