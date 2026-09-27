"use client";

import * as React from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissalCookie, dismissalKey, isDismissed } from "@/lib/billing/trial-upgrade-prompt";
import type { TrialUpgradeOffer } from "@/lib/billing/trial-upgrade-service";
import { TrialUpgradeModal } from "./trial-upgrade-modal";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The trial "continue by SMS" prompt on a page: an inline callout that always
 * stays (the banner version), plus the modal, which opens by itself unless the
 * viewer said "Not now" for this lead in the last 24 hours. The decision to
 * render at all was made on the server from database state.
 */
export function TrialUpgradePrompt({
  userId,
  lead,
  offer,
  canUpgrade,
  dismissedOnServer = false,
}: {
  userId: string;
  lead: { id: string; name: string };
  offer: TrialUpgradeOffer;
  canUpgrade: boolean;
  /** The cookie mirror of "Not now", read by the mount: honoured even when storage is blocked. */
  dismissedOnServer?: boolean;
}) {
  const key = dismissalKey(userId, lead.id);
  // Read on the client only; the server snapshot counts as dismissed so the
  // modal never renders during SSR and hydration stays consistent.
  const dismissed = React.useSyncExternalStore(
    subscribeToStorage,
    () => isDismissed(readStorage(key), Date.now()),
    () => true,
  );
  const [closed, setClosed] = React.useState(false);
  const [manual, setManual] = React.useState(false);
  const open = manual || (!dismissed && !dismissedOnServer && !closed);

  function close() {
    setClosed(true);
    setManual(false);
  }

  function notNow() {
    const now = Date.now();
    try {
      window.localStorage.setItem(key, String(now));
    } catch {
      // Storage blocked: the cookie below still carries the dismissal.
    }
    try {
      document.cookie = dismissalCookie(userId, lead.id, now);
    } catch {
      // Cookies blocked too: the modal simply opens again next time.
    }
    close();
  }

  return (
    <>
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-midnight/15 bg-brand-midnight px-4 py-3 text-white"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-lime text-brand-midnight">
          <MessageSquare className="size-3.5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">{lead.name} replied and is waiting.</span>{" "}
          <span className="text-white/75">
            Your trial SMS allowance is used up. Upgrade to continue this conversation by SMS.
          </span>
        </p>
        <Button size="sm" onClick={() => setManual(true)}>
          {canUpgrade ? "Upgrade now" : "View options"}
        </Button>
      </div>
      <TrialUpgradeModal
        open={open}
        onClose={close}
        onNotNow={notNow}
        offer={offer}
        canUpgrade={canUpgrade}
        lead={lead}
      />
    </>
  );
}
