"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { ReactivationCampaignDetail } from "@/lib/campaigns/reactivation-types";
import { ReactivationDetailDrawer } from "./reactivation-detail-drawer";
import { useReactivationParams } from "./use-reactivation-params";

const TABS = ["overview", "audience", "messages", "results", "activity"];

/**
 * The drawer is URL-driven (`?campaign=<id>&tab=<tab>`), mirroring the
 * `?lead=<id>` convention on `/app/leads`. That makes a campaign linkable,
 * survives a refresh without a dedicated `/reactivation/[id]` route, and
 * means Back closes the drawer while leaving the view, filters and sort
 * exactly as they were.
 */
export function ReactivationDetailDrawerHost({
  campaign,
  canManage,
}: {
  campaign: ReactivationCampaignDetail;
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const { setParams, closeCampaign } = useReactivationParams();

  const requested = searchParams.get("tab") ?? "overview";
  const tab = TABS.includes(requested) ? requested : "overview";

  return (
    <ReactivationDetailDrawer
      campaign={campaign}
      canManage={canManage}
      tab={tab}
      onTabChange={(next) =>
        setParams({ tab: next === "overview" ? null : next })
      }
      onClose={closeCampaign}
    />
  );
}
