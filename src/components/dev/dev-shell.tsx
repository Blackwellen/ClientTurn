"use client";

import * as React from "react";
import { AppShell } from "@/components/app/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { primaryNavFor } from "@/lib/app/nav";

/**
 * Development-only chrome for the `/dev/*` visual harnesses.
 *
 * `AppShell` takes the rail as a list of hrefs and resolves each one back to
 * its icon itself, because an icon is a React component and a function cannot
 * cross the server/client boundary.
 */
export function DevShell({
  children,
  plan = "growth",
}: {
  children: React.ReactNode;
  /** Overridden by a harness that wants to see another tier's sidebar. */
  plan?: string;
}) {
  return (
    <ToastProvider>
      <AppShell
        businessName="Blackwellen Roofing & Exteriors"
        planLabel={plan === "enterprise" ? "Enterprise" : "Growth"}
        plan={plan}
        canManageBilling
        primaryNav={primaryNavFor({ sourcing: true, analytics: true }).map(
          (item) => item.href,
        )}
        integrationStatus="HEALTHY"
        notifications={[]}
        user={{ name: "Jamahl Thomas", email: "jt@blackwellen.co.uk" }}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
