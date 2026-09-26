import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/**
 * A lead in another workspace, an erased lead and an id that never existed
 * produce the same page on purpose: the difference would be a way to probe
 * whether an id is real.
 */
export default function LeadNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={Users}
        title="That lead could not be found"
        description="It may have been erased, or it belongs to a different workspace."
        action={
          <Link
            href="/app/leads"
            className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Back to Leads
          </Link>
        }
      />
    </div>
  );
}
