import Link from "next/link";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/**
 * A session id that does not resolve.
 *
 * Deliberately indistinguishable from a session belonging to another
 * workspace: `getSession` is scoped by business, so a cross-tenant probe gets
 * this page rather than learning the id exists.
 */
export default function SearchSessionNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={Compass}
        title="That search session could not be found"
        description="It may have been archived, or the link may be out of date."
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
