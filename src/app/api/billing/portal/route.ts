import { NextResponse } from "next/server";
import { getActiveWorkspace, getUser } from "@/lib/auth/session";
import { workspaceCan } from "@/lib/auth/permissions";
import { createPortalSession } from "@/lib/billing/checkout";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The "update your card" link in failed-payment emails and banners. A stable
 * URL that mints a fresh, short-lived Stripe Billing Portal session on every
 * click -- the portal URL itself expires, so it cannot be put in an email.
 * Owner (or an admin with billing delegated, 0172); anyone else lands on Billing, which explains who can act.
 */
export async function GET() {
  const site = serverEnv.siteUrl.replace(/\/$/, "");
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${site}/login?redirect=/api/billing/portal`);

  const workspace = await getActiveWorkspace();
  if (!workspace || !(await workspaceCan(workspace, "manage_billing"))) {
    return NextResponse.redirect(`${site}/app/settings?section=billing`);
  }

  const portal = await createPortalSession(workspace.businessId, "/app/settings?section=billing");
  if (!portal.ok) {
    return NextResponse.redirect(`${site}/app/settings?section=billing&portal=unavailable`);
  }
  return NextResponse.redirect(portal.url);
}
