import "server-only";
import { z } from "zod";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import { VOICE_TOOL_ARGS, type VoiceToolName } from "@/lib/voice/tools/definitions";
import type { PortOutcome } from "@/lib/voice/tools/core";

/**
 * The voice agent's tools as service operations (voice phase P3). Caller
 * AGENT only (registry.ts). Each handler is a thin shell over
 * `voice/tools/work.ts`, which reuses the text agent's own tool functions.
 *
 * The call id scopes everything: the handler refuses a call that is not this
 * workspace's. The deterministic gate (voice/tools/core.ts voiceToolGate) has
 * already run by the time a handler is reached.
 *
 * `work.ts` is imported lazily: it imports the agent's tools, which import
 * this service layer, and a lazy import keeps that cycle out of module
 * initialisation.
 */

const callId = z.object({ callId: z.uuid() });

type Tool = Exclude<VoiceToolName, "get_call_status">;

function schemaFor<N extends Tool>(name: N) {
  return (VOICE_TOOL_ARGS[name] as unknown as z.ZodObject<z.ZodRawShape>).extend(callId.shape);
}

async function ensureCall(businessId: string, id: string): Promise<void> {
  const { loadVoiceCall } = await import("@/lib/voice/tools/work");
  const call = await loadVoiceCall(businessId, id);
  if (!call) throw new ServiceError("NOT_FOUND", "That call could not be found.");
}

function define<N extends Tool>(name: N, run: (businessId: string, args: z.infer<ReturnType<typeof schemaFor<N>>>) => Promise<PortOutcome>) {
  const schema = schemaFor(name);
  defineOperation(`voice_agent.${name}`, {
    schema,
    async run({ args, context }: HandlerInput<z.infer<typeof schema>>) {
      const a = args as z.infer<typeof schema> & { callId: string };
      await ensureCall(context.businessId, a.callId);
      const outcome = await run(context.businessId, a as never);
      return {
        data: outcome,
        entityId: a.callId,
        after: { tool: name, ok: outcome.ok, operation: outcome.operation, ...(outcome.ok ? {} : { code: outcome.code }) },
      };
    },
  });
}

define("record_fact", async (b, a) => (await import("@/lib/voice/tools/work")).recordFact(b, a as never));
define("check_availability", async (b, a) => (await import("@/lib/voice/tools/work")).checkAvailability(b, a as never));
define("book_meeting", async (b, a) => (await import("@/lib/voice/tools/work")).bookMeeting(b, a as never));
define("calculate_quote", async (b, a) => (await import("@/lib/voice/tools/work")).calculateQuote(b, a as never));
define("send_quote", async (b, a) => (await import("@/lib/voice/tools/work")).sendQuote(b, a as never));
define("send_checkout_link", async (b, a) => (await import("@/lib/voice/tools/work")).sendCheckoutLink(b, a as never));
define("send_booking_link", async (b, a) => (await import("@/lib/voice/tools/work")).sendBookingLinkOnCall(b, a as never));
define("transfer_to_human", async (b, a) => (await import("@/lib/voice/tools/work")).transferToHuman(b, a as never));
define("schedule_callback", async (b, a) => (await import("@/lib/voice/tools/work")).scheduleCallback(b, a as never));
define("opt_out", async (b, a) => (await import("@/lib/voice/tools/work")).optOut(b, a as never));
define("log_objection", async (b, a) => (await import("@/lib/voice/tools/work")).logObjection(b, a as never));
define("end_call_summary", async (b, a) => (await import("@/lib/voice/tools/work")).endCallSummary(b, a as never));
