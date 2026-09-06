import * as React from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/components/leads/import/import-wizard";

export const metadata: Metadata = { title: "Import leads · ClientTurn" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // Importing writes to `leads` and `prospects`, so it is admin-only rather
  // than available to every member.
  await requireRole("admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import"
        description="Bring an existing list in. Every row is checked before anything is created, and nothing is contacted without your say-so."
        size="lg"
      />
      <ImportWizard />
    </div>
  );
}
