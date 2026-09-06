import Link from "next/link";
import { Radar } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

export default function SourcingRunNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={Radar}
        title="That sourcing run could not be found"
        description="The link may be out of date, or the run may belong to a different workspace."
        action={
          <Link
            href="/app/find-leads"
            className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Back to Find Leads
          </Link>
        }
      />
    </div>
  );
}
