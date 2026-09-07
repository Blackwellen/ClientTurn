"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opens the support popout on arrival at `/app/support` (V4 §23.1).
 *
 * The popout is the product surface; this is only the door. It dispatches the
 * same event any other "contact support" affordance uses, so there is exactly
 * one support UI to keep correct.
 *
 * `?compose=1` opens straight into the new-ticket form, which is what a link
 * from a failed action or an error page should do — arriving at a list when
 * you were sent to report a problem is a wasted click.
 */
export function SupportDeepLink() {
  const params = useSearchParams();
  const compose = params.get("compose") === "1";
  const tab = params.get("tab");

  const open = React.useCallback(
    (options: { compose: boolean; tab?: string }) => {
      window.dispatchEvent(
        new CustomEvent("clientturn:support", {
          detail: {
            tab: options.tab ?? (options.compose ? "tickets" : "help"),
            compose: options.compose,
          },
        }),
      );
    },
    [],
  );

  // Fires once on arrival. Re-opening on every render would fight a customer
  // who deliberately closed the panel.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open({ compose, tab: tab ?? undefined });
  }, [compose, open, tab]);

  return (
    <Button className="mt-4" onClick={() => open({ compose })}>
      <LifeBuoy className="size-4" aria-hidden />
      Open support
    </Button>
  );
}
