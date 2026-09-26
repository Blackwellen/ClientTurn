"use client";

import { Send } from "lucide-react";

/** Opens the support popout on the new-ticket form (its `clientturn:support` event). */
export function ContactSupportButton() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("clientturn:support", { detail: { tab: "help", compose: true } }),
        )
      }
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-content shadow-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
    >
      <Send className="size-3.5" aria-hidden />
      New support ticket
    </button>
  );
}
