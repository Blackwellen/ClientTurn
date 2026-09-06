import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDownloadUrl } from "@/lib/storage/r2";
import { getAffiliate } from "@/lib/affiliates/queries";

/**
 * Hands an active partner a short-lived link to one published asset.
 *
 * The R2 key never reaches the browser: it is resolved here and exchanged for a
 * signed URL that expires in five minutes. A partner who is later suspended
 * cannot replay an old page to fetch new assets, because the check below runs
 * on every request rather than at render time.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const affiliate = await getAffiliate();
  if (!affiliate || affiliate.status !== "ACTIVE") {
    // A partner who should not be here is redirected rather than told what
    // exists at this address.
    return NextResponse.redirect(new URL("/affiliates", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  }

  const { id } = await context.params;
  const db = createAdminClient();

  const { data: resource } = await db
    .from("affiliate_resources")
    .select("id, storage_key, status")
    .eq("id", id)
    .maybeSingle();

  // Only published assets, whatever the id says.
  if (!resource || resource.status !== "PUBLISHED" || !resource.storage_key) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const url = await createDownloadUrl(resource.storage_key, 300);

  // Recorded before the redirect so the count reflects intent even if the
  // fetch itself is abandoned. Best effort: a logging failure must not stop
  // someone downloading a logo.
  await db
    .from("affiliate_resource_downloads")
    .insert({ affiliate_id: affiliate.id, resource_id: resource.id })
    .then(
      () => undefined,
      () => undefined,
    );

  return NextResponse.redirect(url, 302);
}
