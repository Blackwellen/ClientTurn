"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { unsuppress, REVERSIBLE_REASONS } from "@/lib/policy/suppression";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * Admin → Compliance writes (V4 §44).
 *
 * Two rules shape everything here:
 *
 *   1. **A published policy version is never edited.** Changing a live rule
 *      means creating a new version and publishing it, so the pack that decided
 *      a past send stays readable exactly as it was.
 *   2. **A suppression is not an inconvenience to be cleared.** Only reasons the
 *      policy module itself marks reversible can ever be lifted, and the check
 *      is `REVERSIBLE_REASONS` — the same constant the send path trusts.
 */

/* -------------------------------------------------------- policy versions --- */

const createVersionInput = z.object({
  /** Semantic-ish, operator-chosen: "v2.4". Uniqueness is enforced by the DB. */
  version: z.string().trim().min(2).max(24),
  name: z.string().trim().min(2).max(120),
  countryCodes: z.array(z.string().trim().length(2)).max(60).default([]),
  channels: z.array(z.string().trim().max(20)).max(10).default([]),
  notes: z.string().trim().max(4000).optional(),
  /** Copied from an existing version so a new pack starts from the live rules. */
  basedOnVersionId: z.string().uuid().optional(),
});

export async function createPolicyVersion(input: {
  version: string;
  name: string;
  countryCodes?: string[];
  channels?: string[];
  notes?: string;
  basedOnVersionId?: string;
}): Promise<AdminActionResult> {
  return guarded("admin.policy_version_created", async (operator) => {
    const parsed = createVersionInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Give the version a number and a name." };
    }

    const db = createAdminClient();

    let rules: unknown = {};
    if (parsed.data.basedOnVersionId) {
      const { data: source } = await db
        .from("compliance_policy_versions")
        .select("rules_json")
        .eq("id", parsed.data.basedOnVersionId)
        .maybeSingle();
      rules = source?.rules_json ?? {};
    }

    const { data, error } = await db
      .from("compliance_policy_versions")
      .insert({
        version: parsed.data.version,
        name: parsed.data.name,
        country_codes: parsed.data.countryCodes.map((code) => code.toUpperCase()),
        channels: parsed.data.channels,
        rules_json: rules as never,
        // Always a draft. Nothing reaches the send path until it is published.
        status: "DRAFT",
        notes: parsed.data.notes ?? null,
      })
      .select("id")
      .single();

    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "That version number already exists."
            : "The policy version could not be created.",
      };
    }

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.policy_version_created",
      entityType: "compliance_policy_version",
      entityId: data.id,
      metadata: {
        version: parsed.data.version,
        based_on: parsed.data.basedOnVersionId ?? null,
        summary: `Created draft ${parsed.data.version} (${parsed.data.name})`,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: `Draft ${parsed.data.version} created.` };
  });
}

/**
 * Publishing retires the versions this one supersedes rather than deleting
 * them, so the historical pack that governed a past decision remains loadable.
 */
export async function publishPolicyVersion(input: {
  policyId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.policy_version_published", async (operator) => {
    const parsed = z.object({ policyId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That policy reference is not valid." };

    const db = createAdminClient();
    const { data: version } = await db
      .from("compliance_policy_versions")
      .select("id, version, name, status, country_codes, rules_json")
      .eq("id", parsed.data.policyId)
      .maybeSingle();

    if (!version) return { ok: false, error: "That policy version no longer exists." };
    if (version.status !== "DRAFT") {
      return {
        ok: false,
        error: "Only a draft can be published. Create a new version to change a live rule.",
      };
    }

    const rules = (version.rules_json ?? {}) as Record<string, unknown>;
    if (Object.keys(rules).length === 0) {
      // Publishing an empty pack would make `canSend` fall back to the
      // fail-closed pack for these countries and silently stop outreach.
      return {
        ok: false,
        error:
          "This draft carries no rules. Publishing it would block every channel in its scope.",
      };
    }

    const now = new Date().toISOString();
    const countries = (version.country_codes ?? []) as string[];

    // Retire the active packs covering the same scope, so two active packs can
    // never both claim a country and make the resolution order decide policy.
    const { data: siblings } = await db
      .from("compliance_policy_versions")
      .select("id, country_codes")
      .eq("status", "ACTIVE");

    const supersede = (siblings ?? [])
      .filter((row) => sameScope((row.country_codes ?? []) as string[], countries))
      .map((row) => row.id);

    if (supersede.length > 0) {
      await db
        .from("compliance_policy_versions")
        .update({ status: "RETIRED", retired_at: now })
        .in("id", supersede);
    }

    await db
      .from("compliance_policy_versions")
      .update({ status: "ACTIVE", activated_at: now })
      .eq("id", version.id)
      .eq("status", "DRAFT");

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.policy_version_published",
      entityType: "compliance_policy_version",
      entityId: version.id,
      metadata: {
        version: version.version,
        superseded: supersede,
        summary: `Published ${version.version} (${version.name})`,
      },
    });

    revalidatePath("/admin/system");
    return {
      ok: true,
      message:
        supersede.length > 0
          ? `${version.version} is live. ${supersede.length} previous version${supersede.length === 1 ? "" : "s"} archived.`
          : `${version.version} is live.`,
    };
  });
}

function sameScope(a: string[], b: string[]): boolean {
  const left = new Set(a.map((code) => code.toUpperCase()));
  const right = new Set(b.map((code) => code.toUpperCase()));
  if (left.size !== right.size) return false;
  for (const code of left) if (!right.has(code)) return false;
  return true;
}

export async function archivePolicyVersion(input: {
  policyId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.policy_version_archived", async (operator) => {
    const parsed = z.object({ policyId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That policy reference is not valid." };

    const db = createAdminClient();
    const { data: version } = await db
      .from("compliance_policy_versions")
      .select("id, version, status, country_codes")
      .eq("id", parsed.data.policyId)
      .maybeSingle();

    if (!version) return { ok: false, error: "That policy version no longer exists." };
    if (version.status === "RETIRED") {
      return { ok: false, error: "That version is already archived." };
    }

    // Archiving the last active pack covering a country means every send there
    // falls to the fail-closed pack. That may be intended, but never by accident.
    if (version.status === "ACTIVE") {
      const { data: others } = await db
        .from("compliance_policy_versions")
        .select("id, country_codes")
        .eq("status", "ACTIVE")
        .neq("id", version.id);

      const covered = new Set(
        (others ?? []).flatMap((row) =>
          ((row.country_codes ?? []) as string[]).map((code) => code.toUpperCase()),
        ),
      );
      const orphaned = ((version.country_codes ?? []) as string[]).filter(
        (code) => !covered.has(code.toUpperCase()),
      );

      if (orphaned.length > 0) {
        return {
          ok: false,
          error: `Archiving this would leave ${orphaned.join(", ")} with no active policy, which blocks all outreach there. Publish a replacement first.`,
        };
      }
    }

    await db
      .from("compliance_policy_versions")
      .update({ status: "RETIRED", retired_at: new Date().toISOString() })
      .eq("id", version.id);

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.policy_version_archived",
      entityType: "compliance_policy_version",
      entityId: version.id,
      metadata: { version: version.version, summary: `Archived ${version.version}` },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: `${version.version} archived.` };
  });
}

/* ----------------------------------------------------------- suppression --- */

export async function removeSuppression(input: {
  entryId: string;
  reason: string;
}): Promise<AdminActionResult> {
  return guarded("admin.suppression_removed", async (operator) => {
    const parsed = z
      .object({
        entryId: z.string().uuid(),
        reason: z.string().trim().min(8).max(500),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Record why this suppression is being lifted." };
    }

    const db = createAdminClient();
    const { data: entry } = await db
      .from("suppression_entries")
      .select("id, business_id, email, phone_e164, channel, reason")
      .eq("id", parsed.data.entryId)
      .maybeSingle();

    if (!entry) return { ok: false, error: "That suppression entry no longer exists." };

    // The gate. Consult the policy module rather than a local list, so a change
    // to what is reversible can never take effect on one side only.
    if (!(REVERSIBLE_REASONS as readonly string[]).includes(entry.reason)) {
      return {
        ok: false,
        error:
          entry.reason === "OPT_OUT"
            ? "This contact unsubscribed. That cannot be undone from an admin screen."
            : entry.reason === "COMPLAINT"
              ? "This contact reported a message as spam. The suppression is permanent."
              : "This suppression was set by policy and cannot be lifted here.",
      };
    }

    // A platform-wide entry (no business_id) is not one workspace's to lift,
    // and `unsuppress` enforces tenant ownership itself — it is called rather
    // than reimplemented so both paths obey the same rule.
    if (!entry.business_id) {
      return {
        ok: false,
        error:
          "This is a platform-wide suppression. It is not scoped to a workspace and cannot be lifted here.",
      };
    }

    const removal = await unsuppress(entry.business_id, entry.id);
    if (!removal.ok) return { ok: false, error: removal.error };

    await recordAudit({
      businessId: entry.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.suppression_removed",
      entityType: "suppression_entry",
      entityId: entry.id,
      metadata: {
        suppression_reason: entry.reason,
        channel: entry.channel,
        reason: parsed.data.reason,
        summary: `Lifted a ${entry.reason} suppression`,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: "Suppression lifted and recorded." };
  });
}

/* ------------------------------------------------------ privacy requests --- */

export async function updatePrivacyRequest(input: {
  requestId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
  note?: string;
}): Promise<AdminActionResult> {
  return guarded("admin.privacy_request_updated", async (operator) => {
    const parsed = z
      .object({
        requestId: z.string().uuid(),
        status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"]),
        note: z.string().trim().max(1000).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "That request could not be updated." };

    // Closing a request is an assertion that the subject was actually answered,
    // so it has to carry a note saying how.
    if (
      (parsed.data.status === "COMPLETED" || parsed.data.status === "REJECTED") &&
      !parsed.data.note
    ) {
      return {
        ok: false,
        error: "Record how this request was resolved before closing it.",
      };
    }

    const db = createAdminClient();
    const closing =
      parsed.data.status === "COMPLETED" || parsed.data.status === "REJECTED";

    const { data, error } = await db
      .from("privacy_requests")
      .update({
        status: parsed.data.status,
        resolution_note: parsed.data.note ?? null,
        completed_at: closing ? new Date().toISOString() : null,
        handled_by: operator.id,
      })
      .eq("id", parsed.data.requestId)
      .select("id, reference, business_id")
      .maybeSingle();

    if (error || !data) return { ok: false, error: "That request could not be updated." };

    await recordAudit({
      businessId: data.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.privacy_request_updated",
      entityType: "privacy_request",
      entityId: data.id,
      metadata: {
        status: parsed.data.status,
        summary: `${data.reference} set to ${parsed.data.status.toLowerCase().replace("_", " ")}`,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: `${data.reference} updated.` };
  });
}

/* ---------------------------------------------------------- audit export --- */

/**
 * Exports the compliance audit trail. Returns the rows rather than a file so
 * the browser can render or download them; the point of the action is that the
 * export itself is authorised, bounded and — as required — audited.
 */
export async function exportComplianceAudit(input: {
  from: string;
  to: string;
  actions?: string[];
}): Promise<AdminActionResult & { rows?: Record<string, unknown>[] }> {
  return guarded("admin.compliance_export", async (operator) => {
    const parsed = z
      .object({
        from: z.string().min(4),
        to: z.string().min(4),
        actions: z.array(z.string().max(60)).max(20).optional(),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Choose a valid date range." };

    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return { ok: false, error: "Choose a valid date range." };
    }
    // Bounded so an export cannot become an unbounded dump of the audit log.
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      return { ok: false, error: "Export at most one year at a time." };
    }

    const db = createAdminClient();
    let query = db
      .from("audit_log")
      .select("id, created_at, action, actor_type, entity_type, entity_id, metadata")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);

    if (parsed.data.actions?.length) query = query.in("action", parsed.data.actions);

    const { data } = await query;

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.compliance_export",
      metadata: {
        from: from.toISOString(),
        to: to.toISOString(),
        rows: (data ?? []).length,
        summary: `Exported ${(data ?? []).length} audit rows`,
      },
    });

    return {
      ok: true,
      message: `${(data ?? []).length} rows exported.`,
      rows: (data ?? []) as unknown as Record<string, unknown>[],
    };
  }) as Promise<AdminActionResult & { rows?: Record<string, unknown>[] }>;
}
