import type { ActionResult } from "@/lib/leads/actions";

/**
 * The drawer receives its server actions as props rather than importing them,
 * so the presentational tree stays testable and the server-only module graph
 * is entered from exactly one place (`lead-drawer-host.tsx`).
 */
export type LeadDrawerActions = {
  assignLead: (input: { leadId: string; userId: string | null }) => Promise<ActionResult>;
  updateLeadStatus: (input: { leadId: string; status: string }) => Promise<ActionResult>;
  setQualificationResult: (input: {
    leadId: string;
    result: string;
  }) => Promise<ActionResult>;
  setNeedsAttention: (input: {
    leadId: string;
    needsAttention: boolean;
  }) => Promise<ActionResult>;
  humanTakeover: (leadId: string) => Promise<ActionResult>;
  resumeAutomation: (leadId: string) => Promise<ActionResult>;
  sendManualMessage: (input: {
    leadId: string;
    channel: string;
    body: string;
  }) => Promise<ActionResult>;
  sendBookingLink: (input: { leadId: string }) => Promise<ActionResult>;
  markWon: (leadId: string) => Promise<ActionResult>;
  markLost: (leadId: string) => Promise<ActionResult>;
};

/** Runs one action, surfaces the outcome as a toast, and reports success. */
export type RunAction = (
  key: string,
  fn: () => Promise<ActionResult>,
  successMessage: string,
) => Promise<boolean>;
