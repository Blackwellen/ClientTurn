import "server-only";
import { recordAudit } from "@/lib/audit";
import { ingestLead } from "@/lib/ingest/service";
import { isWarmRelationship,
  REFERRAL_EVIDENCE_MESSAGE,
  referralEvidenceSufficient, type RelationshipType } from "@/lib/policy/types";
import type { AuthContext } from "./gateway";
import { suppressionRefusal } from "./guards";
import type { ToolDefinition } from "./tools";

/**
 * MCP tool implementations for the tools that are not service-layer
 * operations — today, only `create_lead` (see `MCP_TOOLS` in `tools.ts`).
 *
 * This file used to carry fifteen more cases (`search_leads`, `get_lead`,
 * `assign_lead`, `pause_campaign`, …) that wrote tables directly. They were
 * unreachable — `callTool` only routes a name here when it is in `MCP_TOOLS`,
 * and every one of them had been replaced by a registry operation — and they
 * were removed so that nobody re-lists a name and silently revives a write
 * path that skips the service layer. New capabilities go in the service
 * registry, never here.
 *
 * Every handler is workspace-scoped by `auth.businessId` — never by an id the
 * caller supplied.
 */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function runReadOrWriteTool(
  auth: AuthContext,
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool.name) {
    case "create_lead": {
      const relationship = str(args.relationshipType) as RelationshipType | null;
      if (!relationship) throw new Error("relationshipType is required.");

      // REFERRAL was advertised in the tool description and then refused as
      // "not warm". It is warm with evidence, the wizard's and the API's rule.
      if (relationship === "REFERRAL") {
        if (!referralEvidenceSufficient(str(args.evidence))) {
          throw new Error(REFERRAL_EVIDENCE_MESSAGE);
        }
      } else if (!isWarmRelationship(relationship)) {
        // The Prospect/Lead boundary, enforced at the API edge exactly as it
        // is in the wizard: a contact you merely found is not a lead.
        throw new Error(
          "That relationship does not describe a warm lead. A contact you found or imported must be added as a prospect and reviewed before contact.",
        );
      }

      /*
       * The one intake path (design 03 §1). ingestLead() is what makes this
       * tool idempotent and safe:
       *
       *   * identity resolution: an exact email or phone match is the same
       *     person, so a retried call -- the normal behaviour of every HTTP
       *     client and agent runtime on a timeout -- returns the existing lead
       *     (MERGED) instead of creating a second one that would be messaged
       *     twice;
       *   * suppression, checked before anything is written, in REFUSE mode:
       *     a suppressed address or number is someone who opted out, bounced
       *     or was blocked, the Add Lead wizard refuses them ("cannot be
       *     overridden here"), and an assistant must not be a way round that.
       *     A failed lookup throws, refusing the create rather than treating
       *     "unknown" as "not suppressed";
       *   * the permission record, the touch and lead.process.
       */
      const result = await ingestLead(
        {
          businessId: auth.businessId,
          source: {
            type: "MCP",
            provider: "mcp",
            caller: { type: "MCP_CLIENT", id: auth.clientId ?? auth.userId ?? undefined },
          },
          person: {
            firstName: str(args.firstName) ?? undefined,
            lastName: str(args.lastName) ?? undefined,
            email: str(args.email) ?? undefined,
            phone: str(args.phone) ?? undefined,
            companyName: str(args.companyName) ?? undefined,
          },
          relationship,
        },
        {
          onSuppressed: "REFUSE",
          // Never auto-started over MCP: a person chooses to message.
          insertExtras: { automation_active: false, created_by_user_id: auth.userId },
          permission: {
            source: "MCP",
            recordedBy: auth.userId,
            ...(relationship === "REFERRAL" ? { evidence: str(args.evidence) } : {}),
          },
        },
      );

      if (result.outcome === "INVALID") {
        throw new Error("A lead needs an email address or a phone number.");
      }

      if (result.outcome === "REJECTED" && (result.reasons.includes("plan_limit") || result.reasons.includes("subscription_inactive"))) {
        // The plan's lead cap (billing/lead-cap.ts): nothing was stored.
        throw new Error(
          result.reasons.includes("plan_limit")
            ? "This workspace has reached its plan's new-lead limit for this billing period, so the lead was not added."
            : "This workspace's subscription is not active, so the lead was not added.",
        );
      }

      if (result.outcome === "REJECTED") {
        await recordAudit({
          businessId: auth.businessId,
          actorUserId: auth.userId,
          action: "lead.opt_out_override_attempt",
          entityType: "lead",
          entityId: null,
          metadata: { via: "mcp", tool: "create_lead", relationship_type: relationship },
        });
        throw new Error(suppressionRefusal([{ reason: "SUPPRESSED" }]) ?? "That contact cannot be added.");
      }

      if (result.outcome === "MERGED" || result.outcome === "DUPLICATE") {
        // Same shape as the create path, so a caller that reads `created` can
        // tell a retry from a first attempt without parsing prose.
        return {
          leadId: result.leadId,
          created: false,
          outcome: result.outcome,
          message:
            "A lead with that email address or phone number already exists in this workspace, so nothing new was created. Its id is returned.",
        };
      }

      // The workspace audit trail, alongside the MCP call log: a lead that
      // appeared from an assistant should be explicable from `audit_log`
      // alone, like one added through the wizard.
      await recordAudit({
        businessId: auth.businessId,
        actorUserId: auth.userId,
        action: "lead.created_manually",
        entityType: "lead",
        entityId: result.leadId,
        metadata: {
          via: "mcp",
          tool: "create_lead",
          relationship_type: relationship,
          outcome: result.outcome,
        },
      });

      return { leadId: result.leadId, created: true, outcome: result.outcome };
    }

    default:
      throw new Error(`${tool.name} is not implemented.`);
  }
}
