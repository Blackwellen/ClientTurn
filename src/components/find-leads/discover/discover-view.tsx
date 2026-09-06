import * as React from "react";
import type { DiscoverData } from "@/lib/find-leads/server/discover";
import { SearchSessionsRail } from "./search-sessions-rail";
import { DiscoverChat } from "./discover-chat";
import { AcquisitionProfileCard } from "./acquisition-profile-card";
import {
  RecentSourcingRunsCard,
  RecurringSourcingCard,
  UsageThisMonthCard,
} from "./side-cards";

/**
 * The Discover view (V4 §9).
 *
 * Three columns on a wide screen: sessions rail, the chat, the contextual rail.
 * The chat is the widest of the three at every breakpoint — that ordering is
 * the product decision, not a layout preference. On a tablet the sessions rail
 * drops below; on a phone everything stacks with the chat first, so the thing
 * the page is for is the thing you land on.
 */

export function DiscoverView({
  data,
  firstName,
  canManage,
}: {
  data: DiscoverData;
  firstName: string;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Ordered last on small screens so the chat is what a phone opens on. */}
      <div className="order-2 w-full lg:order-1 lg:w-auto">
        <SearchSessionsRail
          groups={data.sessionGroups}
          totalCount={data.sessionCount}
        />
      </div>

      <div className="order-1 min-w-0 flex-1 lg:order-2">
        <DiscoverChat firstName={firstName} profileComplete={data.profile.complete} />
      </div>

      <div className="order-3 flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
        <AcquisitionProfileCard
          profile={data.profile}
          analysis={data.analysis}
          defaultWebsite={data.defaultWebsite}
          canManage={canManage}
        />
        <RecentSourcingRunsCard runs={data.recentRuns} />
        <RecurringSourcingCard schedules={data.recurring} />
        <UsageThisMonthCard
          used={data.usage.searchesUsed}
          limit={data.usage.searchesLimit}
          percent={data.usage.percent}
          resetsAt={data.usage.resetsAt}
        />
      </div>
    </div>
  );
}
