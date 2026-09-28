import Link from "next/link";
import { Bot } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/**
 * An agent in another workspace, a deleted agent and an id that never existed
 * produce the same page on purpose: the difference would be a way to probe
 * whether an id is real. Before this existed the app-wide 404 rendered, with
 * no way back to Agents.
 */
export default function AgentNotFound() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <EmptyState
        icon={Bot}
        title="That agent could not be found"
        description="It may have been deleted, or it belongs to a different workspace."
        action={
          <Link
            href="/app/agents"
            className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
          >
            Back to Agents
          </Link>
        }
      />
    </div>
  );
}
