/**
 * The deployed-worker guard loop, on its own thread (README layer 6).
 *
 * On the main thread the loop stalls whenever the stories do synchronous work
 * (a first import compiles hundreds of TypeScript modules), and a job inserted
 * by SQL during a stall stays claimable for that long. Here it has its own
 * event loop, so it keeps sweeping every `intervalMs` whatever the stories do.
 *
 * It talks to exactly one host: the Supabase project's REST endpoint, passed
 * in by the parent. It sends one kind of request: the parking PATCH, scoped to
 * the test business's unparked pending jobs.
 */
import { parentPort, workerData } from "node:worker_threads";

const { supabaseUrl, serviceKey, businessId, parkAt, parkMark, intervalMs, concurrency } = workerData;
const url =
  `${supabaseUrl}/rest/v1/jobs?business_id=eq.${businessId}&state=eq.pending` +
  `&run_at=neq.${encodeURIComponent(parkAt)}&select=id,type,created_at`;

let inFlight = 0;
let stopped = false;
let lastTick = Date.now();
const stats = { sweeps: 0, failedSweeps: 0, maxTickGapMs: 0 };

async function sweep() {
  if (inFlight >= concurrency) return;
  inFlight += 1;
  try {
    const now = new Date().toISOString();
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ run_at: parkAt, last_error: `${parkMark}${now}` }),
    });
    stats.sweeps += 1;
    if (!response.ok) {
      stats.failedSweeps += 1;
      return;
    }
    const rows = await response.json();
    if (rows.length > 0) parentPort.postMessage({ kind: "parked", rows, at: Date.now() });
  } catch {
    stats.failedSweeps += 1;
  } finally {
    inFlight -= 1;
  }
}

const timer = setInterval(() => {
  const now = Date.now();
  stats.maxTickGapMs = Math.max(stats.maxTickGapMs, now - lastTick);
  lastTick = now;
  if (!stopped) void sweep();
}, intervalMs);

parentPort.on("message", async (message) => {
  if (message?.kind !== "stop") return;
  stopped = true;
  clearInterval(timer);
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 10));
  await sweep();
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 10));
  parentPort.postMessage({ kind: "stopped", stats });
});
