import { BackLink } from "@/components/app/back-link";
import * as React from "react";
import type { Metadata } from "next";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { PermissionDeniedState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/components/leads/import/import-wizard";

export const metadata: Metadata = { title: "Import leads" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // Importing writes to `leads` and `prospects`, so it is admin-only rather
  // than available to every member.
  // A member gets the permission state rather than a thrown FORBIDDEN
  // landing on the error boundary (QA 2026-09-28); the import actions
  // enforce the same role on the server.
  const workspace = await requireWorkspace();
  if (!hasRole(workspace.role, "admin")) {
    return (
      <div className="space-y-6">
        <BackLink href="/app/leads">Back to Leads</BackLink>
        <PageHeader title="Import" size="lg" />
        <PermissionDeniedState
          title="Only an owner or admin can import leads"
          description="An import creates leads and prospects in bulk, so it needs admin access. You can still add a single lead from the Leads page."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/app/leads">Back to Leads</BackLink>
      <PageHeader
        title="Import"
        description="Bring an existing list in. Every row is checked before anything is created, and nothing is contacted without your say-so."
        size="lg"
      />
      <ImportWizard />
    </div>
  );
}
