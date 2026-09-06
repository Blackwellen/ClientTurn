/**
 * Billing shapes and pure display helpers. Deliberately free of `server-only`,
 * of the Stripe SDK and of the service-role client, so client components can
 * share them with the server queries without dragging any of that into the
 * browser bundle.
 */

export type InvoiceRow = {
  id: string;
  number: string | null;
  created: string;
  amountDue: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

export type InvoicesResult =
  | { ok: true; invoices: InvoiceRow[]; portalAvailable: boolean }
  | { ok: false; error: string };

const INVOICE_STATUS_TONE: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  paid: { label: "Paid", tone: "success" },
  open: { label: "Open", tone: "warning" },
  draft: { label: "Draft", tone: "neutral" },
  uncollectible: { label: "Uncollectible", tone: "danger" },
  void: { label: "Void", tone: "neutral" },
};

export function invoiceStatusMeta(status: string) {
  return INVOICE_STATUS_TONE[status] ?? { label: status, tone: "neutral" as const };
}
