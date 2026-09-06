import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

export function ReadOnlyNotice({
  message = "Only an owner or admin can change these settings.",
}: {
  message?: string;
}) {
  return (
    <div className="border-line bg-surface-sunken flex items-start gap-3 rounded-xl border px-4 py-3.5">
      <span className="bg-surface border-line flex size-8 shrink-0 items-center justify-center rounded-lg border">
        <Lock className="text-content-muted size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-content text-[13px] font-semibold">Read-only</p>
        <p className="text-content-muted mt-0.5 text-[13px]">{message}</p>
      </div>
    </div>
  );
}

export function PermissionDenied({
  title = "You do not have access to this",
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <EmptyState
      icon={Lock}
      title={title}
      description={description}
      action={
        <Link
          href="/app/settings?section=workspace"
          className="text-content-accent focus-visible:outline-content-accent rounded-xs text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to settings
        </Link>
      }
    />
  );
}
