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
export function DevShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AppShell
        businessName="Blackwellen Roofing & Exteriors"
        planLabel="Enterprise"
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
