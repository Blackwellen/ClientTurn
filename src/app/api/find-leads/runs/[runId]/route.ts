import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveWorkspace } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { getRun } from "@/lib/find-leads/server/runs";

/**
 * Live run state for the run page.
 *
 * Polling rather than a socket: a sourcing run advances on the order of
 * seconds, the payload is small, and this works identically on every
 * deployment target the product supports. The client backs off once the run
 * reaches a terminal state, so a finished run costs nothing.
 *
 * The workspace comes from the session cookie. A run id in the URL is only
 * ever a filter — `getRun` scopes by `business_id`, so a foreign id returns
 * 404 rather than another tenant's run.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;

  const parsed = z.uuid().safeParse(runId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const entitlements = await getV4Entitlements(workspace.businessId);
  if (!entitlements.sourcingEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const run = await getRun(workspace.businessId, parsed.data, {
    canManage: hasRole(workspace.role, "admin"),
  });

  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    { run },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
