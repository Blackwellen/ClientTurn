import * as React from "react";
import { z } from "zod";
import { listCustomers, getCustomerDetail, CUSTOMER_FILTERS } from "@/lib/admin/queries";
import { CustomersView } from "@/components/admin/customers-view";
import { PageHeader } from "@/components/app/page-header";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  filter: z.enum(CUSTOMER_FILTERS).default("all").catch("all"),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
  customer: z.string().trim().max(64).optional().catch(undefined),
});

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const params = paramsSchema.parse({
    filter: first(raw.filter),
    q: first(raw.q),
    page: first(raw.page),
    customer: first(raw.customer),
  });

  const [result, detail] = await Promise.all([
    listCustomers({
      filter: params.filter,
      search: params.q ?? "",
      page: params.page,
      pageSize: 25,
    }),
    params.customer
      ? getCustomerDetail(params.customer)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Every workspace on the platform, with usage and integration health."
      />
      <CustomersView
        result={result}
        filter={params.filter}
        search={params.q ?? ""}
        detail={detail}
      />
    </div>
  );
}
