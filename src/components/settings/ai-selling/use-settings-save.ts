"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { SettingsActionResult } from "@/lib/settings/ai-selling-actions";

/**
 * Runs one settings save: pending state, a toast with the operation's own
 * message (including any warning it returned), field errors when the server
 * names them, and a refresh so every card shows what was actually stored.
 */
export function useSettingsSave() {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const save = React.useCallback(
    async (fn: () => Promise<SettingsActionResult>) => {
      setSaving(true);
      setFieldErrors({});
      try {
        const result = await fn();
        if (result.ok) {
          toast({ variant: "success", title: result.message });
          router.refresh();
        } else {
          setFieldErrors(result.fieldErrors ?? {});
          toast({ variant: "error", title: result.error });
        }
        return result.ok;
      } catch {
        toast({ variant: "error", title: "That could not be saved. Try again." });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [router, toast],
  );

  return { save, saving, fieldErrors, setFieldErrors };
}
