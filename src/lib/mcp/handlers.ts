import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAllChannels } from "@/lib/policy/service";
import { getOverview, rangeBounds, type AnalyticsRange } from "@/lib/analytics/v4-queries";
import { isWarmRelationship, type RelationshipType } from "@/lib/policy/types";
import { recordPermission } from "@/lib/policy/service";
import { normalisePhone } from "@/lib/messaging/types";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import type { AuthContext } from "./gateway";
import type { ToolDefinition } from "./tools";

/**
 * MCP tool implementations.
 *
 * Every handler is workspace-scoped by `auth.businessId` — never by an id the
 * caller supplied — so a valid token for one workspace cannot read another's
 * data even if it guesses a lead id.
 *
 * Reads return shaped, human-readable objects rather than raw rows: an
 * assistant does not need `business_id`, and returning it leaks the tenancy
 * model for no benefit.
 */

function clampLimit(value: unknown, fallback = 20): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function runReadOrWriteTool(
  auth: AuthContext,
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<unknown> {
  const db = createAdminClient();

  switch (tool.name) {
    /* ------------------------------------------------------------- leads */
    case "search_leads": {
      let query = db
        .from("leads")
        .select("id, first_name, last_name, email, phone, status, qualification_state, created_at")
        .eq("business_id", auth.businessId)
        .eq("is_test", false)
        .order("created_at", { ascending: false })
        .limit(clampLimit(args.limit));

      const status = str(args.status);
      if (status) query = query.eq("status", status.toUpperCase());

      const search = str(args.query);
      if (search) {
        const term = search.replace(/[,()\\]/g, " ");
        query = query.or(
          `first_name.ilike.*${term}*,last_name.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${term}*`,
        );
      }

      const { data } = await query;
      return {
        leads: (data ?? []).map((row) => ({
          id: row.id,
          name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
          email: row.email,
          phone: row.phone,
          status: row.status,
          qualification: row.qualification_state,
          createdAt: row.created_at,
        })),
      };
    }

    case "get_lead": {
      const leadId = str(args.leadId);
      if (!leadId) throw new Error("leadId is required.");

      const { data: lead } = await db
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, company_name, status, qualification_state, needs_attention, attention_reason, created_at, booked_at, won_at, lost_at",
        )
        .eq("business_id", auth.businessId)
        .eq("id", leadId)
        .maybeSingle();

      if (!lead) throw new Error("That lead was not found in this workspace.");

      const { data: messages } = await db
        .from("messages")
        .select("direction, channel, body, created_at")
        .eq("business_id", auth.businessId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(10);

      return {
        lead: {
          id: lead.id,
          name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
          email: lead.email,
          phone: lead.phone,
          company: lead.company_name,
          status: lead.status,
          qualification: lead.qualification_state,
          needsAttention: lead.needs_attention,
          attentionReason: lead.attention_reason,
          createdAt: lead.created_at,
        },
        recentMessages: (messages ?? []).reverse().map((row) => ({
          direction: row.direction,
          channel: row.channel,
          body: row.body,
          at: row.created_at,
        })),
      };
    }

    case "create_lead": {
      const relationship = str(args.relationshipType) as RelationshipType | null;
      if (!relationship) throw new Error("relationshipType is required.");

      // The Prospect/Lead boundary, enforced at the API edge exactly as it is
      // in the wizard: a contact you merely found is not a lead.
      if (!isWarmRelationship(relationship)) {
        throw new Error(
          "That relationship does not describe a warm lead. A contact you found or imported must be added as a prospect and reviewed before contact.",
        );
      }

      const email = normaliseEmail(str(args.email));
      const phone = str(args.phone) ? normalisePhone(String(args.phone)) : null;
      if (!email && !phone) throw new Error("A lead needs an email address or a phone number.");

      const { data: lead, error } = await db
        .from("leads")
        .insert({
          business_id: auth.businessId,
          first_name: str(args.firstName),
          last_name: str(args.lastName),
          company_name: str(args.companyName),
          email,
          phone,
          phone_normalized: phone,
          intake_method: "API",
          relationship_type: relationship,
          created_via: "API",
          created_by_user_id: auth.userId,
          // Never auto-started over the API: a person chooses to message.
          automation_active: false,
        })
        .select("id")
        .single();

      if (error || !lead) throw new Error("The lead could not be created.");

      await recordPermission({
        businessId: auth.businessId,
        subject: { type: "LEAD", id: lead.id },
        relationshipType: relationship,
        consentSource: "MCP",
        email,
        phone,
        recordedBy: auth.userId,
      });

      return { leadId: lead.id, created: true };
    }

    case "assign_lead": {
      const leadId = str(args.leadId);
      if (!leadId) throw new Error("leadId is required.");
      const userId = str(args.userId);

      if (userId) {
        const { data: member } = await db
          .from("business_members")
          .select("user_id")
          .eq("business_id", auth.businessId)
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle();
        if (!member) throw new Error("That user is not a member of this workspace.");
      }

      const { error } = await db
        .from("leads")
        .update({ assigned_user_id: userId })
        .eq("business_id", auth.businessId)
        .eq("id", leadId);

      if (error) throw new Error("The lead could not be assigned.");
      return { leadId, assignedTo: userId };
    }

    case "update_lead_status": {
      const leadId = str(args.leadId);
      const status = str(args.status)?.toUpperCase();
      if (!leadId || !status) throw new Error("leadId and status are required.");

      const allowed = ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"];
      if (!allowed.includes(status)) {
        throw new Error(`status must be one of: ${allowed.join(", ")}.`);
      }

      const { error } = await db
        .from("leads")
        .update({ status })
        .eq("business_id", auth.businessId)
        .eq("id", leadId);

      if (error) throw new Error("The lead status could not be changed.");
      return { leadId, status };
    }

    /* --------------------------------------------------------- prospects */
    case "search_prospects": {
      let query = db
        .from("prospects")
        .select(
          "id, first_name, last_name, role_title, email, status, grade, score, outreach_eligibility",
        )
        .eq("business_id", auth.businessId)
        .eq("is_test", false)
        .is("promoted_to_lead_id", null)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(clampLimit(args.limit));

      const grade = str(args.grade);
      if (grade) {
        const order = ["D", "C", "B", "A", "A+"];
        const index = order.indexOf(grade.toUpperCase());
        if (index >= 0) query = query.in("grade", order.slice(index));
      }

      const search = str(args.query);
      if (search) {
        const term = search.replace(/[,()\\]/g, " ");
        query = query.or(
          `first_name.ilike.*${term}*,last_name.ilike.*${term}*,email.ilike.*${term}*,role_title.ilike.*${term}*`,
        );
      }

      const { data } = await query;
      return {
        prospects: (data ?? []).map((row) => ({
          id: row.id,
          name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
          role: row.role_title,
          email: row.email,
          status: row.status,
          grade: row.grade,
          score: row.score,
          // Stated on every prospect so an assistant cannot treat a sourced
          // record as someone it may contact.
          contactable: row.outreach_eligibility === "ELIGIBLE",
          eligibility: row.outreach_eligibility,
        })),
      };
    }

    case "get_prospect": {
      const prospectId = str(args.prospectId);
      if (!prospectId) throw new Error("prospectId is required.");

      const { data: prospect } = await db
        .from("prospects")
        .select(
          "id, first_name, last_name, role_title, email, status, grade, score, outreach_eligibility, eligibility_reason, prospect_companies ( name, domain, industry )",
        )
        .eq("business_id", auth.businessId)
        .eq("id", prospectId)
        .maybeSingle();

      if (!prospect) throw new Error("That prospect was not found in this workspace.");

      const { data: score } = await db
        .from("prospect_scores")
        .select("total_score, grade, explanation, factor_json")
        .eq("business_id", auth.businessId)
        .eq("prospect_id", prospectId)
        .eq("is_current", true)
        .maybeSingle();

      const company = prospect.prospect_companies as unknown as {
        name: string;
        domain: string | null;
        industry: string | null;
      } | null;

      return {
        prospect: {
          id: prospect.id,
          name: [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || null,
          role: prospect.role_title,
          email: prospect.email,
          company: company?.name ?? null,
          domain: company?.domain ?? null,
          industry: company?.industry ?? null,
          status: prospect.status,
          grade: prospect.grade,
          score: prospect.score,
          contactable: prospect.outreach_eligibility === "ELIGIBLE",
          eligibility: prospect.outreach_eligibility,
          eligibilityReason: prospect.eligibility_reason,
        },
        scoreExplanation: score?.explanation ?? null,
        scoreFactors: score?.factor_json ?? null,
      };
    }

    case "approve_prospect": {
      const prospectId = str(args.prospectId);
      if (!prospectId) throw new Error("prospectId is required.");

      const { data: prospect } = await db
        .from("prospects")
        .select("id, email, status")
        .eq("business_id", auth.businessId)
        .eq("id", prospectId)
        .maybeSingle();

      if (!prospect) throw new Error("That prospect was not found in this workspace.");

      // Approval is not an override. The policy engine decides, and it is
      // re-run here rather than trusting whatever was stored earlier.
      const { eligibility } = await evaluateAllChannels(
        auth.businessId,
        { type: "PROSPECT", id: prospectId, email: prospect.email },
        "COLD",
        { record: true },
      );

      if (eligibility !== "ELIGIBLE") {
        throw new Error(
          `This prospect cannot be approved: contact rules currently return ${eligibility}.`,
        );
      }

      await db
        .from("prospects")
        .update({
          status: "APPROVED",
          approved_by: auth.userId,
          approved_at: new Date().toISOString(),
        })
        .eq("business_id", auth.businessId)
        .eq("id", prospectId);

      return { prospectId, approved: true };
    }

    /* --------------------------------------------------------- campaigns */
    case "list_campaigns": {
      const { data } = await db
        .from("outreach_campaigns")
        .select("id, name, status, minimum_grade, launched_at")
        .eq("business_id", auth.businessId)
        .order("updated_at", { ascending: false })
        .limit(50);

      const { data: results } = await db.rpc("outreach_campaign_results", {
        p_business_id: auth.businessId,
      });

      const byId = new Map((results ?? []).map((row) => [row.campaign_id, row]));

      return {
        campaigns: (data ?? []).map((row) => {
          const funnel = byId.get(row.id);
          return {
            id: row.id,
            name: row.name,
            status: row.status,
            minimumGrade: row.minimum_grade,
            launchedAt: row.launched_at,
            audience: funnel?.audience_count ?? 0,
            contacted: funnel?.contacted_count ?? 0,
            replies: funnel?.reply_count ?? 0,
            promotedToLeads: funnel?.promoted_count ?? 0,
          };
        }),
      };
    }

    case "pause_campaign": {
      const campaignId = str(args.campaignId);
      if (!campaignId) throw new Error("campaignId is required.");

      const { error } = await db
        .from("outreach_campaigns")
        .update({ status: "PAUSED", paused_at: new Date().toISOString() })
        .eq("business_id", auth.businessId)
        .eq("id", campaignId)
        .in("status", ["ACTIVE", "OPTIMIZING", "READY"]);

      if (error) throw new Error("The campaign could not be paused.");
      return { campaignId, status: "PAUSED" };
    }

    /* -------------------------------------------------- business/analytics */
    case "get_business_profile": {
      const [profile, services, icps, goals] = await Promise.all([
        db
          .from("business_profiles")
          .select("website_url, business_type, sales_model, summary")
          .eq("business_id", auth.businessId)
          .maybeSingle(),
        db.from("services").select("name").eq("business_id", auth.businessId),
        db
          .from("icp_profiles")
          .select("name, industries, locations, roles")
          .eq("business_id", auth.businessId)
          .eq("active", true),
        db
          .from("conversion_goals")
          .select("name, type")
          .eq("business_id", auth.businessId)
          .eq("active", true),
      ]);

      return {
        website: profile.data?.website_url ?? null,
        businessType: profile.data?.business_type ?? null,
        salesModel: profile.data?.sales_model ?? null,
        summary: profile.data?.summary ?? null,
        services: (services.data ?? []).map((row) => row.name),
        idealCustomerProfiles: icps.data ?? [],
        conversionGoals: goals.data ?? [],
      };
    }

    case "get_dashboard_metrics": {
      const range = (str(args.range) ?? "30d") as AnalyticsRange;
      const valid: AnalyticsRange[] = ["7d", "30d", "90d", "12m"];
      const bounds = rangeBounds(valid.includes(range) ? range : "30d");
      const overview = await getOverview(auth.businessId, bounds);

      return {
        range,
        metrics: overview.metrics.map((metric) => ({
          key: metric.key,
          value: metric.value,
          changeVsPreviousPeriod: metric.change,
        })),
        funnel: overview.funnel.map((stage) => ({
          stage: stage.label,
          count: stage.count,
        })),
      };
    }

    case "get_status": {
      const [integrations, senders, jobs] = await Promise.all([
        db
          .from("integrations")
          .select("provider_type, status")
          .eq("business_id", auth.businessId),
        db
          .from("sender_identities")
          .select("email, status")
          .eq("business_id", auth.businessId)
          .eq("active", true),
        db
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("business_id", auth.businessId)
          .eq("state", "pending"),
      ]);

      return {
        integrations: (integrations.data ?? []).map((row) => ({
          provider: row.provider_type,
          status: row.status,
        })),
        senders: (senders.data ?? []).map((row) => ({
          email: row.email,
          status: row.status,
        })),
        pendingBackgroundJobs: jobs.count ?? 0,
      };
    }

    default:
      throw new Error(`${tool.name} is not implemented.`);
  }
}
