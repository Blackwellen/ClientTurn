import "server-only";
import { emitAutomationEvent } from "./events";
import { withVoiceAutomationEvents, type VoiceEmit } from "./voice-events";

/**
 * Server wiring for the voice automation triggers (see ./voice-events.ts).
 * `serverVoiceDeps()` wraps its repo with `voiceRepoWithAutomationEvents`, and
 * the minute settlement calls `emitVoiceBudgetEvents` when a call takes the
 * workspace across 75%, 90% or 100% of its minutes.
 */

export const voiceAutomationEmit: VoiceEmit = (input) =>
  emitAutomationEvent({
    businessId: input.businessId,
    leadId: input.leadId,
    eventType: input.eventType,
    payload: input.payload,
  });

export function voiceRepoWithAutomationEvents<R extends Parameters<typeof withVoiceAutomationEvents>[0]>(repo: R): R {
  return withVoiceAutomationEvents(repo, voiceAutomationEmit);
}

/** Never throws: the settlement already happened. */
export async function emitVoiceBudgetEvents(businessId: string, threshold: 75 | 90 | 100, remainingSec: number): Promise<void> {
  await emitAutomationEvent({
    businessId,
    eventType: "voice.budget_threshold",
    payload: { percentUsed: threshold, remainingMinutes: Math.floor(Math.max(0, remainingSec) / 60) },
  });
  if (threshold === 100) {
    await emitAutomationEvent({ businessId, eventType: "usage.exhausted", payload: { metric: "voice_minutes" } });
  }
}
