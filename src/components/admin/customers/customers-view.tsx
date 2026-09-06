"use client";

import * as React from "react";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SuspendDialog } from "@/components/admin/suspend-dialog";
import { CustomerFilters } from "./customer-filters";
import { CustomerTable } from "./customer-table";
import { CustomerSupportDrawer } from "./customer-support-drawer";
import {
  resendOnboardingEmail,
  suspendWorkspace,
  triggerIntegrationHealthCheck,
  unsuspendWorkspace,
} from "@/lib/admin/actions";
import type {
  CustomerDetail,
  CustomerFilter,
  CustomerListResult,
  CustomerRow,
  CustomerSort,
} from "@/lib/admin/types";

export function CustomersView({
  result,
  filter,
  search,
  sort,
  direction,
  detail,
}: {
  result: CustomerListResult;
  filter: CustomerFilter;
  search: string;
  sort: CustomerSort;
  direction: "asc" | "desc";
  detail: CustomerDetail | null;
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();
  const [suspendTarget, setSuspendTarget] = React.useState<{
    id: string;
    name: string;
    members: number;
  } | null>(null);

  const openCustomer = React.useCallback(
    (row: CustomerRow) => setParams({ customer: row.id }),
    [setParams],
  );

  const handleRowAction = React.useCallback(
    (row: CustomerRow, action: "health" | "onboarding" | "suspend" | "unsuspend") => {
      if (action === "health") {
        void run(
          "health",
          () => triggerIntegrationHealthCheck(row.id),
          "Health check queued.",
        );
        return;
      }
      if (action === "onboarding") {
        void run(
          "onboarding",
          () => resendOnboardingEmail(row.id),
          "Onboarding email resent.",
        );
        return;
      }
      if (action === "unsuspend") {
        void run(
          "unsuspend",
          () => unsuspendWorkspace(row.id),
          "Workspace restored.",
        );
        return;
      }
      // Suspension is never one click: it always goes through confirmation.
      setSuspendTarget({ id: row.id, name: row.name, members: 0 });
    },
    [run],
  );

  return (
    <>
      <div className="space-y-3">
        <CustomerFilters
          filter={filter}
          search={search}
          sort={sort}
          direction={direction}
          pageSize={result.pageSize}
          onChange={setParams}
        />
        <CustomerTable
          result={result}
          sort={sort}
          direction={direction}
          onChange={setParams}
          onOpen={openCustomer}
          onAction={handleRowAction}
        />
      </div>

      {detail && (
        <CustomerSupportDrawer
          detail={detail}
          pending={pending}
          onClose={() => setParams({ customer: null })}
          onResendOnboarding={() =>
            void run(
              "onboarding",
              () => resendOnboardingEmail(detail.id),
              "Onboarding email resent.",
            )
          }
          onRunHealthCheck={() =>
            void run(
              "health",
              () => triggerIntegrationHealthCheck(detail.id),
              "Health check queued.",
            )
          }
          onSuspend={() =>
            setSuspendTarget({
              id: detail.id,
              name: detail.name,
              members: detail.members.length,
            })
          }
          onUnsuspend={() =>
            void run(
              "unsuspend",
              () => unsuspendWorkspace(detail.id),
              "Workspace restored.",
            )
          }
        />
      )}

      <SuspendDialog
        open={suspendTarget !== null}
        workspaceName={suspendTarget?.name ?? ""}
        memberCount={suspendTarget?.members ?? 0}
        onClose={() => setSuspendTarget(null)}
        onConfirm={async (reason) => {
          const target = suspendTarget;
          setSuspendTarget(null);
          if (!target) return;
          await run(
            "suspend",
            () => suspendWorkspace(target.id, reason),
            "Workspace suspended.",
          );
        }}
      />

      {stepUpDialog}
    </>
  );
}
