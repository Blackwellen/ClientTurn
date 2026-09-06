import * as React from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { getAffiliate } from "@/lib/affiliates/queries";
import { AffiliateShell } from "@/components/affiliates/affiliate-shell";

/**
 * Guards the whole partner portal.
 *
 * Two distinct redirects, because the two cases are genuinely different: a
 * signed-out visitor should sign in at the partner login and come back here,
 * while a signed-in user
 * with no affiliate account should be shown the programme and how to apply —
 * not an error telling them they lack permission for something they never
 * asked for.
 */
export default async function AffiliateAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/affiliates/login?redirect=/affiliates/app");

  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");

  return (
    <AffiliateShell
      status={affiliate.status}
      displayName={affiliate.displayName}
      code={affiliate.code}
    >
      {children}
    </AffiliateShell>
  );
}
