import Link from "next/link";
import type { Entitlements } from "@/lib/billing/entitlements";
import type { BusinessRole } from "@/lib/auth/session";
import { getLinkedInAssistBoard, type LinkedInAssistBoard } from "@/lib/linkedin-assist/queries";
import {
  ErrorState,
  IntegrationRequiredState,
  PermissionDeniedState,
  PlanLimitState,
} from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { LinkedInAssistBoardView } from "./linkedin-assist-board";

/**
 * Follow-Up -> LinkedIn Assist.
 *
 * The AI drafts; the person sends from their own LinkedIn account. Nothing on
 * this page touches LinkedIn. Every state the route contract asks for is here:
 * loading (the route's loading.tsx), permission denied (viewers), plan limit
 * (an inactive subscription), "integration required" (the person has not told
 * us their LinkedIn account type and pacing yet), error, empty, and the list.
 */
export async function LinkedInAssistView({
  businessId,
  userId,
  role,
  timezone,
  entitlements,
}: {
  businessId: string;
  userId: string;
  role: BusinessRole;
  timezone: string;
  entitlements: Entitlements;
}) {
  if (role === "viewer") {
    return (
      <PermissionDeniedState
        title="LinkedIn Assist is for team members who reach out"
        description="Viewers can read leads but do not have a LinkedIn list. Ask an admin to change your role."
      />
    );
  }

  if (!entitlements.active) {
    return (
      <PlanLimitState
        title="Your subscription is not active"
        description="LinkedIn Assist plans and drafts work for an active plan. Your existing list is kept."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/app/settings?section=billing">Open billing</Link>
          </Button>
        }
      />
    );
  }

  let board: LinkedInAssistBoard;
  try {
    board = await getLinkedInAssistBoard({ businessId, userId, timezone });
  } catch (error) {
    console.error("[linkedin-assist] board failed to load", {
      businessId,
      message: error instanceof Error ? error.message : String(error),
    });
    return (
      <ErrorState
        title="LinkedIn Assist could not be loaded"
        description="Nothing was lost. Try again in a moment."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!board.configured && (
        <IntegrationRequiredState
          title="Set up LinkedIn Assist for your account"
          description="Tell us which LinkedIn plan you are on so the daily list stays well under LinkedIn's limits. Nothing connects to LinkedIn: you send every message yourself."
        />
      )}
      {!board.aiEnabled && (
        <IntegrationRequiredState
          title="AI drafting is off"
          description="You will see our standard messages until AI assist is on for this workspace and your plan includes it (Settings, AI and selling). Replies are drafted by the assistant when it is switched on for LinkedIn."
        />
      )}
      <LinkedInAssistBoardView board={board} />
    </div>
  );
}
