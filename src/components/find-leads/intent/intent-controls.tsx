"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Pencil, Play, Square } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { controlIntentMonitor, setIntentCategoryActive } from "@/lib/intent/actions";

/**
 * Pause / resume / edit for a category or a monitor.
 *
 * Errors surface as a toast rather than being swallowed: a resume that was
 * refused because the plan's monitor limit is full is exactly the thing
 * someone needs told.
 */
export function IntentControls({
  kind,
  id,
  active,
  onEdit,
}: {
  kind: "category" | "monitor";
  id: string;
  active: boolean;
  onEdit?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function run(next: boolean) {
    startTransition(async () => {
      const result =
        kind === "category"
          ? await setIntentCategoryActive(id, next)
          : await controlIntentMonitor(id, next ? "resume" : "pause");

      if (result.ok) {
        router.refresh();
      } else {
        toast({ title: result.error, variant: "error" });
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      {onEdit && (
        <IconButton size="sm" label="Edit" onClick={onEdit} disabled={pending}>
          <Pencil className="size-3.5" />
        </IconButton>
      )}
      <IconButton
        size="sm"
        label={active ? "Pause" : "Resume"}
        onClick={() => run(!active)}
        disabled={pending}
      >
        {active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </IconButton>
      {kind === "monitor" && (
        <IconButton
          size="sm"
          label="Stop"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await controlIntentMonitor(id, "stop");
              if (result.ok) router.refresh();
              else toast({ title: result.error, variant: "error" });
            })
          }
        >
          <Square className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}
