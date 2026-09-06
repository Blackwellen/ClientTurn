import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env";
import { getAffiliate, listLinks } from "@/lib/affiliates/queries";
import { LinksView } from "@/components/affiliates/links-view";

export const metadata: Metadata = {
  title: "Links | ClientTurn partners",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AffiliateLinksPage() {
  const affiliate = await getAffiliate();
  if (!affiliate) redirect("/affiliates");

  // A partner who is not active has no links to manage, and the nav does not
  // offer this page to them. Someone arriving by URL goes back to Overview,
  // which explains their actual status.
  if (affiliate.status !== "ACTIVE") redirect("/affiliates/app");

  const { links, campaigns } = await listLinks(affiliate.id);

  // The configured site URL, not the request host: a partner copies these
  // links into emails and ads, so they must be the real public address even
  // when the portal is reached through a preview or internal hostname.
  return (
    <LinksView links={links} campaigns={campaigns} origin={serverEnv.siteUrl} />
  );
}
