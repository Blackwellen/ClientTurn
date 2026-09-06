import * as React from "react";
import type { Metadata } from "next";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadSupport, parseQueue } from "@/lib/admin/support";
import { SupportView } from "@/components/admin/support/support-view";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = {
  title: "Support · Platform operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards too, but this page reads customer conversations across
  // every tenant, so it asserts the operator role itself.
  await requirePlatformAdmin();

  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const queue = parseQueue(first(raw.queue));
  const ticket = z.string().uuid().safeParse(first(raw.ticket));

  const data = await loadSupport(queue, ticket.success ? ticket.data : undefined);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Support"
        description="Customer tickets across every workspace. Copilot may draft; a person sends."
      />
      <SupportView data={data} />
    </div>
  );
}
