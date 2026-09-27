import * as React from "react";

/**
 * The public documents a workspace's own customers open from a link (quotes
 * today; signature and booking pages later). No app chrome and no marketing
 * chrome: the page belongs to the workspace, with only the "Powered by
 * ClientTurn" badge (OD-1). Unauthenticated by design: the unguessable token
 * in the path is the credential (tests/route-guards.test.ts).
 */
export default function PublicDocumentLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-surface-sunken text-content">{children}</div>;
}
