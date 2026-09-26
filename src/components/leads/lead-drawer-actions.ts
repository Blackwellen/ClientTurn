import type { ActionResult } from "@/lib/leads/actions";
import type {
  DataRightsActionResult,
  ErasureActionData,
} from "@/lib/data-rights/actions";

/**
 * The drawer receives its server actions as props rather than importing them,
 * so the presentational tree stays testable and the server-only module graph
 * is entered from exactly one place (`lead-drawer-host.tsx`).
 */
export type LeadDrawerActions = {
  assignLead: (input: { leadId: string; userId: string | null }) => Promise<ActionResult>;
  /** WON and LOST need a `reason`; the server refuses them without one. */
  updateLeadStatus: (input: {
    leadId: string;
    status: string;
    reason?: string;
  }) => Promise<ActionResult>;
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
    /** One per composed message; makes the server's duplicate check exact. */
    clientNonce?: string;
  }) => Promise<ActionResult>;
  sendBookingLink: (input: { leadId: string }) => Promise<ActionResult>;
  markWon: (leadId: string, reason: string) => Promise<ActionResult>;
  markLost: (leadId: string, reason: string) => Promise<ActionResult>;
  /**
   * Data rights (Phase 6): suppress, restrict, export, anonymise, erase.
   * Optional so a host that does not offer them simply shows no menu items.
   */
  dataRights?: {
    suppress: (input: {
      leadId: string;
      channel: string;
      reason: string;
    }) => Promise<DataRightsActionResult>;
    anonymise: (input: {
      leadId: string;
      alsoRemoveFromCrm?: boolean;
    }) => Promise<DataRightsActionResult<ErasureActionData>>;
    erase: (input: {
      leadId: string;
      alsoRemoveFromCrm?: boolean;
    }) => Promise<DataRightsActionResult<ErasureActionData>>;
    exportData: (input: {
      leadId: string;
    }) => Promise<DataRightsActionResult<{ filename: string; json: string }>>;
    crmSystems: (input: { leadId: string }) => Promise<string[]>;
  };
};

/** Runs one action, surfaces the outcome as a toast, and reports success. */
export type RunAction = (
  key: string,
  fn: () => Promise<ActionResult>,
  successMessage: string,
) => Promise<boolean>;
