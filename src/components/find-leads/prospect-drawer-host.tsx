import * as React from "react";
import { getProspectDetail } from "@/lib/prospects/queries";
import { ProspectDrawer } from "./prospect-drawer";

/**
 * Server half of the Prospect Drawer.
 *
 * The detail is fetched on the server for the one prospect the URL names, so
 * opening a drawer costs a single round trip and the list query never
 * over-fetches detail for rows nobody opened.
 */
export async function ProspectDrawerHost({
  businessId,
  prospectId,
  canManage,
}: {
  businessId: string;
  prospectId: string | null;
  canManage: boolean;
}) {
  if (!prospectId) return null;

  const detail = await getProspectDetail(businessId, prospectId);
  if (!detail) return null;

  return <ProspectDrawer detail={detail} canManage={canManage} />;
}
