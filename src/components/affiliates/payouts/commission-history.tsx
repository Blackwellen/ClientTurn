import * as React from "react";
import { ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty, Table, Td } from "@/components/affiliates/portal-ui";
import { ledgerEntryLabel } from "@/lib/affiliates/ledger-rules";
import {
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_MEANING,
  COMMISSION_STATUS_TONE,
  formatMinor,
  type CommissionRow,
} from "@/lib/affiliates/types";

/**
 * The partner's own commission ledger, row by row (payouts page). Before
 * this the page promised "commission history" but only showed balances and
 * payouts, so a reversal, a dispute restore or an end-of-partnership
 * write-off was visible only as a changed total.
 *
 * Rows come from the partner's own session under RLS (current_affiliate_id);
 * the referred business appears only as its anonymised referral label.
 */
export function CommissionHistory({ rows, currency }: { rows: CommissionRow[]; currency: string }) {
  return (
    <Panel
      icon={ReceiptText}
      title="Commission history"
      description="Every entry on your balance: commission earned, reversals after a refund or chargeback, restores after a won dispute, adjustments, and any write-off."
    >
      {rows.length === 0 ? (
        <PanelEmpty
          title="No commission yet"
          description="Commission appears here when a customer you referred makes their first payment."
        />
      ) : (
        <Table
          minWidth={640}
          headers={[
            { label: "Date" },
            { label: "Entry" },
            { label: "Referral" },
            { label: "Amount", numeric: true },
            { label: "Status" },
          ]}
        >
          {rows.slice(0, 100).map((row) => (
            <tr key={row.id}>
              <Td>{new Date(row.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Td>
              <Td>{ledgerEntryLabel(row.entryType, row.reversalReason)}</Td>
              <Td>{row.referralLabel}</Td>
              <Td numeric>{formatMinor(row.commissionAmountMinor, row.currency || currency)}</Td>
              <Td>
                <span title={COMMISSION_STATUS_MEANING[row.status]}>
                  <Badge tone={COMMISSION_STATUS_TONE[row.status]} dense>
                    {COMMISSION_STATUS_LABEL[row.status] ?? row.status}
                  </Badge>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}
