"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { clearAttribution } from "@/lib/marketing/attribution";
import {
  CONSENT_CHANGED_EVENT,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/marketing/consent";

/**
 * PECR regulation 6 consent banner. Accept and reject carry equal weight and
 * sit next to each other, and nothing non-essential is stored until Accept is
 * pressed — the gate itself lives in `@/lib/marketing/consent`.
 */
export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored consent choice is browser-only, so it can only be read after mount.
    if (!readConsent()) setVisible(true);

    // The Cookie Policy page can clear the choice; the banner must come back.
    function onChanged() {
      setVisible(!readConsent());
    }
    window.addEventListener(CONSENT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChanged);
  }, []);

  function decide(choice: ConsentChoice) {
    // Withdrawal must be effective, not just recorded: drop anything the
    // visitor may have accumulated under a previous acceptance.
    if (choice === "rejected") clearAttribution();
    writeConsent(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-xl sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2
            id="cookie-consent-title"
            className="text-[13px] font-semibold text-content"
          >
            Cookies on this site
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-content-secondary">
            We use strictly necessary cookies to run the site and keep you signed
            in. With your permission we also store campaign attribution and
            product analytics, so we can tell which adverts and pages bring
            people here. Nothing optional is stored until you accept, and you can
            change your mind at any time.{" "}
            <Link
              href="/cookies"
              className="underline underline-offset-4 hover:text-content"
            >
              Cookie policy
            </Link>
            .
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="md" onClick={() => decide("rejected")}>
            Reject non-essential
          </Button>
          <Button size="md" onClick={() => decide("accepted")}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
