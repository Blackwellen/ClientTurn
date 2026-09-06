"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * The sticky "you have unsaved changes" bar. Only Settings → Workspace uses
 * it — connections, team and billing operations are transactional, so they
 * commit immediately and never leave a draft behind.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  // Warn on a real page unload; in-app navigation is guarded by the nav links
  // themselves via the confirm in `onBeforeLeave`.
  React.useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (!dirty) return null;

  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className={cn(
        "sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md",
        "sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8",
        "animate-[lr-slide-up_var(--lr-duration-base)_var(--lr-ease)] motion-reduce:animate-none",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <AlertCircle className="size-4 shrink-0 text-warning-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-content">
            You have unsaved changes
          </p>
          <p className="text-[12.5px] text-content-muted">
            Make sure to save your changes before leaving this page.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={onDiscard}
          >
            Discard changes
          </Button>
          <Button type="button" size="sm" loading={saving} onClick={onSave}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
