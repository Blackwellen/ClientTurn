"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "lr.cookie-consent";

type Choice = "accepted" | "rejected";

function readChoice(): Choice | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

function writeChoice(choice: Choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage blocked — the banner simply reappears next visit */
  }
}

export function CookieConsent() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored consent choice is browser-only, so it can only be read after mount.
    if (!readChoice()) setVisible(true);
  }, []);

  function decide(choice: Choice) {
    writeChoice(choice);
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
            We use essential cookies to run the site and, with your permission,
            analytics cookies to understand which pages and adverts bring people
            here. You can change your mind at any time.{" "}
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
