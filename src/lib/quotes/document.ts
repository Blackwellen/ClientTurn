/**
 * The quote document as sections: ONE layout-neutral view of a frozen render
 * model, consumed by BOTH the public page (/q/[token]) and the PDF (pdf.ts).
 * Every customer-visible string on either surface comes from here, so the
 * page and the PDF cannot show different figures or wording
 * (tests/quote-pdf.test.ts asserts every string reaches the PDF).
 *
 * Pure: relative imports only. Dates are formatted without Intl so the
 * output is identical on every runtime.
 */

import type { QuoteRenderModel } from "./types.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-27" (or an ISO timestamp) -> "27 October 2026". */
export function formatDocumentDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

export type DocumentRow = { label: string; value: string; strong?: boolean };

export type DocumentLine = {
  lineId: string;
  group: string | null;
  isAddOn: boolean;
  description: string;
  billing: string;
  /** Cells in the order of `lineColumns`, all pre-formatted. */
  cells: string[];
};

export type QuoteDocument = {
  title: string;
  number: string;
  revisionLabel: string;
  facts: DocumentRow[];
  seller: { name: string; lines: string[] };
  buyer: { heading: string; lines: string[] };
  lineColumns: string[];
  lines: DocumentLine[];
  totals: { heading: string; rows: DocumentRow[] }[];
  usage: { explanation: string; lines: string[] } | null;
  payment: { heading: string; rows: DocumentRow[] };
  customerNote: string | null;
  terms: string | null;
  vatNotice: string | null;
  poweredBy: boolean;
  fingerprintLabel: string;
};

export function quoteDocumentSections(model: QuoteRenderModel, options: { documentHash?: string | null } = {}): QuoteDocument {
  const showVat = model.showVat;
  const sellerLines = [
    ...(model.seller.legalName && model.seller.legalName !== model.seller.name ? [model.seller.legalName] : []),
    ...model.seller.address,
    ...(model.seller.companyNumber ? [`Company number ${model.seller.companyNumber}`] : []),
    ...(model.seller.vatNumber ? [`VAT number ${model.seller.vatNumber}`] : []),
    ...(model.seller.email ? [model.seller.email] : []),
  ];
  const buyerLines = [
    model.buyer.name,
    ...(model.buyer.company && model.buyer.company !== model.buyer.name ? [model.buyer.company] : []),
    ...model.buyer.address,
    ...(model.buyer.email ? [model.buyer.email] : []),
  ];

  const lineColumns = showVat
    ? ["Description", "Qty", "Unit price", "Discount", "Net", "VAT", "Total"]
    : ["Description", "Qty", "Unit price", "Discount", "Amount"];

  const lines: DocumentLine[] = model.lines.map((line) => {
    const qty = `${line.quantity} ${line.unit}`;
    const common = [line.description, qty, line.unitPrice ?? "Tiered", line.discount ?? "", line.netAmount];
    return {
      lineId: line.lineId,
      group: line.groupLabel,
      isAddOn: line.isAddOn,
      description: line.description,
      billing: line.billing,
      cells: showVat ? [...common, `${line.vatAmount ?? ""} (${line.vatRate ?? ""})`, line.grossAmount ?? ""] : common,
    };
  });

  const totals = [...(model.oneOff ? [model.oneOff] : []), ...model.recurring].map((group) => ({
    heading: group.label,
    rows: [
      ...(showVat ? [{ label: "Net", value: group.net }] : []),
      ...(showVat && group.vatByRate ? group.vatByRate.map((bucket) => ({ label: `VAT at ${bucket.rate} on ${bucket.net}`, value: bucket.vat })) : []),
      ...(showVat && group.vat ? [{ label: "Total VAT", value: group.vat }] : []),
      { label: showVat ? "Total including VAT" : "Total", value: group.gross, strong: true },
    ],
  }));

  const paymentRows: DocumentRow[] = [
    ...(model.totalDiscount ? [{ label: "Total discount", value: model.totalDiscount }] : []),
    // The deposit is the schedule's first row; it is not listed twice.
    ...(model.deposit && !model.schedule.some((row) => row.label === "Deposit") ? [{ label: "Deposit", value: model.deposit }] : []),
    ...model.schedule.map((row) => ({ label: `${row.label} (${row.due.toLowerCase()})`, value: row.amount })),
    { label: "Due on acceptance", value: model.firstPayment, strong: true },
  ];

  return {
    title: model.quote.title,
    number: model.quote.number,
    revisionLabel: `Revision ${model.quote.revision}`,
    facts: [
      { label: "Quote", value: model.quote.number },
      { label: "Revision", value: String(model.quote.revision) },
      { label: "Issued", value: formatDocumentDate(model.quote.issuedOn) },
      { label: "Valid until", value: formatDocumentDate(model.quote.validUntil) },
      { label: "Currency", value: model.quote.currency },
    ],
    seller: { name: model.seller.name, lines: sellerLines },
    buyer: { heading: "Prepared for", lines: buyerLines },
    lineColumns,
    lines,
    totals,
    usage: model.usage,
    payment: { heading: "Payment", rows: paymentRows },
    customerNote: model.customerNote,
    terms: model.terms.trim() ? model.terms : null,
    vatNotice: model.vatNotice,
    poweredBy: model.poweredBy,
    fingerprintLabel: options.documentHash ? `Document fingerprint (SHA-256): ${options.documentHash}` : `Price fingerprint (SHA-256): ${model.calculationHash}`,
  };
}

/** Every customer-visible string in the document, for consistency checks. */
export function documentStrings(doc: QuoteDocument): string[] {
  return [
    doc.title,
    doc.number,
    doc.seller.name,
    ...doc.seller.lines,
    ...doc.buyer.lines,
    ...doc.facts.map((row) => row.value),
    ...doc.lines.flatMap((line) => [...line.cells, line.billing, ...(line.group ? [line.group] : [])]),
    ...doc.totals.flatMap((group) => [group.heading, ...group.rows.flatMap((row) => [row.label, row.value])]),
    ...(doc.usage ? doc.usage.lines : []),
    ...doc.payment.rows.flatMap((row) => [row.label, row.value]),
    ...(doc.customerNote ? [doc.customerNote] : []),
    ...(doc.vatNotice ? [doc.vatNotice] : []),
  ].filter((value) => value.trim().length > 0);
}
