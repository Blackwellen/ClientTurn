import * as React from "react";

/**
 * "Powered by ClientTurn" on public pages a customer's customer sees: the
 * quote page (and later the signature and public booking pages). OD-1:
 * shown unless the workspace holds `white_label_public_pages` (a grant, a
 * future paid add-on). The caller decides from the render model / `can()`;
 * this only draws it. It links to the public site, never into the app.
 */
export function PoweredByBadge({ className }: { className?: string }) {
  return (
    <a
      href="/"
      target="_blank"
      rel="noopener"
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11.5px] font-medium text-content-muted " +
        "hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent " +
        (className ?? "")
      }
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[#B7F34A] ring-1 ring-[#0B1020]/20" />
      Powered by ClientTurn
    </a>
  );
}
