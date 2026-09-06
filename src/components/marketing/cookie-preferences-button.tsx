"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { clearAttribution } from "@/lib/marketing/attribution";
import { readConsent, resetConsent } from "@/lib/marketing/consent";

/**
 * Withdrawal control for the Cookie Policy page. Article 7(3) UK GDPR requires
 * withdrawing consent to be as easy as giving it, so this clears the stored
 * choice, discards anything stored under it, and brings the banner straight
 * back.
 */
export function CookiePreferencesButton() {
  const [choice, setChoice] = React.useState<string | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored choice is browser-only and can only be read after mount.
    setChoice(readConsent());
  }, []);

  function change() {
    clearAttribution();
    resetConsent();
    setChoice(null);
  }

  return (
    <div className="not-prose mt-2 flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="md" onClick={change}>
        Change your cookie choice
      </Button>
      <span className="text-[13px] text-content-muted">
        {choice === "accepted"
          ? "You currently accept analytics and attribution storage."
          : choice === "rejected"
            ? "You currently reject everything that is not strictly necessary."
            : "You have not made a choice yet, so nothing optional is stored."}
      </span>
    </div>
  );
}
