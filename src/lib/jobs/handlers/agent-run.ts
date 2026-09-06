import "server-only";

/**
 * `agent.run` -- one bounded agent turn, executed off the request path.
 *
 * A provider webhook is acknowledged the moment the inbound message is stored;
 * the thinking happens here. That separation is what keeps Twilio and Meta
 * from retrying (and therefore duplicating) because a model call was slow.
 *
 * Retry safety: `runAgentTurn` re-reads live state and opens an idempotent run
 * row keyed on the event, so a retried job either resumes a crashed turn or
 * finds the work already done and does nothing.
 */

import type { ClaimedJob } from "@/lib/jobs/queue";
import { PermanentJobError } from "@/lib/jobs/registry";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { agentRunPayload } from "@/lib/agent/events";
import type { AgentEvent } from "@/lib/agent/types";
import { parsePayload } from "./parse";

export async function handleAgentRun(job: ClaimedJob) {
  const payload = parsePayload(agentRunPayload, job.payload);

  // A job whose business no longer matches its payload is a programming
  // error, not a transient one -- retrying it would only repeat the mistake.
  if (job.business_id && job.business_id !== payload.businessId) {
    throw new PermanentJobError("Agent job business does not match its payload.");
  }

  await runAgentTurn(payload as AgentEvent);
}
