import * as React from "react";
import { z } from "zod";
import { listCustomers, getCustomerDetail } from "@/lib/admin/customers";
import { getCustomerSupportSignals } from "@/lib/admin/support-signals";
import { getCustomerSystemCheck } from "@/lib/admin/system-check";
import { CUSTOMER_FILTERS, CUSTOMER_SORTS } from "@/lib/admin/types";
import { CustomersView } from "@/components/admin/customers/customers-view";
import { PageHeader } from "@/components/app/page-header";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  filter: z.enum(CUSTOMER_FILTERS).default("all").catch("all"),
  q: z.string().trim().max(80).default("").catch(""),
  sort: z.enum(CUSTOMER_SORTS).default("joined").catch("joined"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
  size: z.coerce.number().int().min(10).max(50).default(10).catch(10),
  customer: z.string().uuid().optional().catch(undefined),
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
    sort: first(raw.sort),
    dir: first(raw.dir),
    page: first(raw.page),
    size: first(raw.size),
    customer: first(raw.customer),
  });

  const [result, detail] = await Promise.all([
    listCustomers({
      filter: params.filter,
      search: params.q,
      sort: params.sort,
      direction: params.dir,
      page: params.page,
      pageSize: params.size,
    }),
    params.customer ? getCustomerDetail(params.customer) : Promise.resolve(null),
  ]);

  // Read-only support signals for the open customer (audited as a support
  // view), only once the workspace is known to exist.
  const signals = detail
    ? await getCustomerSupportSignals(detail.id).catch((error: unknown) => {
        console.error("[admin] support signals unavailable", error);
        return null;
      })
    : null;
  // The customer's own System check, read-only (troubleshooting for support).
  const systemCheck = detail
    ? await getCustomerSystemCheck(detail.id).catch((error: unknown) => {
        console.error("[admin] system check unavailable", error);
        return null;
      })
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Manage and support all ClientTurn customers."
      />
      <CustomersView
        result={result}
        filter={params.filter}
        search={params.q}
        sort={params.sort}
        direction={params.dir}
        detail={detail}
        signals={signals}
        systemCheck={systemCheck}
      />
    </div>
  );
}
