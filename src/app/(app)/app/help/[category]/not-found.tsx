import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/** An unknown help category or article: a way back into Help, not the app-wide 404. */
export default function HelpNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={CircleHelp}
        title="That help article could not be found"
        description="It may have moved. Search Help, or browse the categories."
        action={
          <Link
            href="/app/help"
            className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Back to Help
          </Link>
        }
      />
    </div>
  );
}
