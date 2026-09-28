"use client";

import * as React from "react";
import type { LeadCapabilities, LeadDetail } from "@/lib/leads/types";
import {
  assignLead,
  humanTakeover,
  markLost,
  markWon,
  resumeAutomation,
  sendBookingLink,
  sendManualMessage,
  setNeedsAttention,
  setQualificationResult,
  updateLeadStatus,
} from "@/lib/leads/actions";
import {
  anonymiseLeadAction,
  deleteLeadAction,
  exportLeadAction,
  leadCrmSystemsAction,
  suppressLeadAction,
} from "@/lib/data-rights/actions";
import type { BusinessRole } from "@/lib/auth/session";
import type { DrawerCallState } from "@/lib/voice/call-button-state";
import { LeadDrawer } from "./lead-drawer";
import { useLeadParams } from "./use-lead-params";

/**
 * The single place the leads UI touches the server-action module. The drawer
 * itself takes its actions as props, so nothing below this file needs to know
 * whether an action is local or remote.
 */
export function LeadDrawerHost({
  detail,
  capabilities,
  canWrite,
  role,
  initialTab,
  focus,
  call,
}: {
  detail: LeadDetail;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  /** The viewer's workspace role; the server re-checks every action anyway. */
  role?: BusinessRole;
  initialTab?: string;
  focus?: string;
  /** "Call with AI" state, computed on the server (loadDrawerCallState). */
  call?: DrawerCallState | null;
}) {
  const { closeLead } = useLeadParams();

  return (
    <LeadDrawer
      detail={detail}
      capabilities={capabilities}
      canWrite={canWrite}
      role={role}
      initialTab={initialTab}
      focus={focus}
      call={call}
      onClose={closeLead}
      actions={{
        assignLead,
        updateLeadStatus,
        setQualificationResult,
        setNeedsAttention,
        humanTakeover,
        resumeAutomation,
        sendManualMessage,
        sendBookingLink,
        markWon,
        markLost,
        dataRights: {
          suppress: suppressLeadAction,
          anonymise: anonymiseLeadAction,
          erase: deleteLeadAction,
          exportData: exportLeadAction,
          crmSystems: leadCrmSystemsAction,
        },
      }}
    />
  );
}
