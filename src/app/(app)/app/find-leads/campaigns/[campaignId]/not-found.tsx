import Link from "next/link";
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/**
 * A campaign in another workspace and a campaign that never existed produce
 * the same page on purpose: the difference would be a way to probe whether an
 * id is real.
 */
export default function CampaignNotFound() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface">
        <EmptyState
          icon={Megaphone}
          title="That campaign could not be found"
          description="It may have been deleted, or it belongs to a different workspace."
          action={
            <Link
              href="/app/find-leads?view=campaigns"
              className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Back to Campaigns
            </Link>
          }
        />
      </div>
    </div>
  );
}
