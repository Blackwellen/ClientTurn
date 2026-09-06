import Link from "next/link";
import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

export default function ProspectScoringNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={Target}
        title="That prospect could not be found"
        description="The link may be out of date, or the prospect may belong to a different workspace."
        action={
          <Link
            href="/app/find-leads?view=prospects"
            className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Back to Prospects
          </Link>
        }
      />
    </div>
  );
}
