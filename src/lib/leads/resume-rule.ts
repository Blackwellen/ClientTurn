/**
 * When automated follow-up may be handed back to the assistant for a lead.
 *
 * This is the rule `lead.resume_follow_up` enforces. The lead page and the
 * lead drawer both import it to disable "Hand back" with the same reason the
 * server would give, so there is one rule, not three that drift apart.
 *
 * Pure: no `server-only`, no Supabase, so the client drawer and the tests can
 * import it directly.
 */

export type ResumeFollowUpState = {
  status: string;
  optedOut: boolean;
  archived: boolean;
};

export type ResumeFollowUpBlock = {
  code: "opted_out" | "archived" | "closed" | "booked";
  /** ServiceError code the operation throws for this block. */
  serviceCode: "POLICY_BLOCKED" | "CONFLICT";
  message: string;
};

/**
 * Why follow-up cannot resume for this lead, or null when it can.
 *
 * BOOKED is refused because the scheduler stops every non-reminder step on a
 * booked lead (`automation/scheduler.ts`): resuming would promise follow-up
 * that never sends.
 */
export function resumeFollowUpBlock(state: ResumeFollowUpState): ResumeFollowUpBlock | null {
  if (state.optedOut) {
    return {
      code: "opted_out",
      serviceCode: "POLICY_BLOCKED",
      message: "This lead opted out. Follow-up cannot resume.",
    };
  }
  if (state.archived) {
    return { code: "archived", serviceCode: "CONFLICT", message: "That lead is archived. Restore it first." };
  }
  if (state.status === "WON" || state.status === "LOST") {
    return { code: "closed", serviceCode: "CONFLICT", message: "Follow-up does not resume on a won or lost lead." };
  }
  if (state.status === "BOOKED") {
    return {
      code: "booked",
      serviceCode: "CONFLICT",
      message: "This lead is booked, so follow-up has done its job. Booking reminders still send.",
    };
  }
  return null;
}

/**
 * The UI's version: the same block, plus "nothing to hand back" when the
 * conversation was never taken over. The operation itself does not refuse
 * that case, because bulk "Start follow-up" uses it to start follow-up on
 * leads that were never running.
 */
export function handBackUnavailableReason(
  state: ResumeFollowUpState & { humanTakeover: boolean },
): string | null {
  const block = resumeFollowUpBlock(state);
  if (block) return block.message;
  if (!state.humanTakeover) return "Automated follow-up is already running for this lead.";
  return null;
}

/**
 * The words for taking a conversation from the assistant and giving it back.
 * Every surface that offers either act (lead page, lead drawer, lead row menu,
 * inbox assistant panel) uses these, so the same act has one name.
 */
export const HANDOVER_COPY = {
  takeOver: "Take over",
  takeOverHelp: "Automated follow-up stops. You reply yourself.",
  handBack: "Hand back",
  handBackHelp: "The assistant resumes follow-up. Each message is re-checked before it sends.",
} as const;
