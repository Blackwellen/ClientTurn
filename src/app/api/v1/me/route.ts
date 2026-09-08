import { createAdminClient } from "@/lib/supabase/admin";
import { apiSuccess, withApiKey } from "@/lib/api/public";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/me` — what this key can see and do.
 *
 * The first call a developer makes, and the one that answers "is my key wired
 * up correctly" without them having to guess at another endpoint. It returns
 * the workspace, the key's own scopes and the live role behind it — so if a
 * later call is refused, this says which of the three is the reason.
 */
export const GET = withApiKey({ scope: "business:read" }, async (_request, context) => {
  const db = createAdminClient();

  const { data: business } = await db
    .from("businesses")
    .select("id, name, timezone, status, industry, created_at")
    .eq("id", context.businessId)
    .maybeSingle();

  return apiSuccess({
    workspace: {
      id: context.businessId,
      name: business?.name ?? null,
      timezone: business?.timezone ?? null,
      industry: business?.industry ?? null,
      status: business?.status ?? null,
    },
    key: {
      name: context.keyName,
      environment: context.environment,
      scopes: context.scopes,
    },
    // The live role, re-read on this request. A key whose owner was demoted
    // shows the lower role here immediately, which is what makes the refusal of
    // a later write explicable rather than mysterious.
    acting_as: { role: context.userRole },
  });
});
