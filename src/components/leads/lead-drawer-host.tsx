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
  initialTab,
  focus,
}: {
  detail: LeadDetail;
  capabilities: LeadCapabilities;
  canWrite: boolean;
  initialTab?: string;
  focus?: string;
}) {
  const { closeLead } = useLeadParams();

  return (
    <LeadDrawer
      detail={detail}
      capabilities={capabilities}
      canWrite={canWrite}
      initialTab={initialTab}
      focus={focus}
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
      }}
    />
  );
}
