/**
 * The quote PDF, rendered from the SAME document sections as the public page
 * (document.ts <- render-model.ts), so the two cannot disagree.
 *
 * Dependency decision (gap map R13): no PDF library. The repo has none, and a
 * quote is text, rules and a table. This is a small PDF 1.4 writer using the
 * standard Helvetica fonts (built into every reader, nothing embedded) with
 * WinAnsi encoding, which covers English, the £ and € signs and Western
 * European accents. Advantages over a dependency: zero bundle or cold-start
 * cost in the job, and the output is DETERMINISTIC (no creation date, no
 * random ids), so the same revision always produces byte-identical PDF and the
 * stored object can be re-verified by re-rendering. The logo is not drawn
 * (it is presentation, not sealed content; the public page shows it).
 *
 * Pure: no I/O. Returns the bytes; the `quote.render_pdf` job stores them.
 */

import { documentStrings, quoteDocumentSections, type QuoteDocument } from "./document.ts";
import type { QuoteRenderModel } from "./types.ts";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 28;

/** Helvetica advance widths (1/1000 em) for 32..126; Bold is approximated at +6%. */
const HELVETICA: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Unicode -> WinAnsi (cp1252) for the characters outside Latin-1 that quotes use. */
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "•": 0x95, "–": 0x96, "—": 0x97, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "™": 0x99,
};

function encodeChar(ch: string): number {
  if (WIN_ANSI[ch] !== undefined) return WIN_ANSI[ch];
  const code = ch.codePointAt(0) ?? 63;
  if (code >= 32 && code <= 126) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  if (code === 0x2212) return 45; // minus sign
  return 63; // "?"
}

export function encodeWinAnsi(text: string): number[] {
  return [...text].map(encodeChar);
}

function charWidth(code: number): number {
  if (code >= 32 && code <= 126) return HELVETICA[code - 32];
  if (code === 0xa3 || code === 0x80) return 556; // £ €
  if (code === 0x96) return 556;
  if (code === 0x97) return 1000;
  return 556;
}

export function textWidth(text: string, size: number, bold = false): number {
  const units = encodeWinAnsi(text).reduce((sum, code) => sum + charWidth(code), 0);
  return (units * size * (bold ? 1.06 : 1)) / 1000;
}

/** Greedy word wrap to a width; a single over-long word is split by characters. */
export function wrapText(text: string, width: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let rest = word;
      while (textWidth(rest, size, bold) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

function pdfString(text: string): string {
  let out = "(";
  for (const code of encodeWinAnsi(text)) {
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

const n = (value: number) => (Math.round(value * 100) / 100).toString();

type Page = string[];

class Layout {
  pages: Page[] = [[]];
  y = PAGE_H - MARGIN;

  get page(): Page {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  text(x: number, y: number, text: string, size: number, bold = false, grey = false) {
    if (!text) return;
    const colour = grey ? "0.42 0.45 0.5 rg" : "0.04 0.06 0.13 rg";
    this.page.push(`BT ${colour} /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(x)} ${n(y)} Td ${pdfString(text)} Tj ET`);
  }

  right(xRight: number, y: number, text: string, size: number, bold = false) {
    this.text(xRight - textWidth(text, size, bold), y, text, size, bold);
  }

  rule(y: number, weight = 0.5) {
    this.page.push(`0.85 0.87 0.9 RG ${n(weight)} w ${n(MARGIN)} ${n(y)} m ${n(PAGE_W - MARGIN)} ${n(y)} l S`);
  }

  paragraph(text: string, size = 9.5, bold = false, grey = false, width = CONTENT_W, x = MARGIN) {
    const leading = size * 1.35;
    for (const line of wrapText(text, width, size, bold)) {
      this.ensure(leading);
      this.y -= leading;
      this.text(x, this.y, line, size, bold, grey);
    }
  }

  gap(amount: number) {
    this.y -= amount;
  }
}

function drawRows(layout: Layout, heading: string, rows: { label: string; value: string; strong?: boolean }[]) {
  layout.ensure(40);
  layout.gap(14);
  layout.text(MARGIN, layout.y, heading, 10.5, true);
  layout.gap(4);
  for (const row of rows) {
    const labelLines = wrapText(row.label, CONTENT_W * 0.62, 9.5, Boolean(row.strong));
    layout.ensure(labelLines.length * 13 + 2);
    for (const [index, line] of labelLines.entries()) {
      layout.gap(13);
      layout.text(MARGIN, layout.y, line, 9.5, Boolean(row.strong));
      if (index === 0) layout.right(PAGE_W - MARGIN, layout.y, row.value, 9.5, Boolean(row.strong));
    }
  }
}

function drawTable(layout: Layout, doc: QuoteDocument) {
  const cols = doc.lineColumns.length;
  // Description takes what the numeric columns leave.
  const numericW = cols === 7 ? [48, 62, 58, 62, 70, 66] : [60, 72, 66, 80];
  const descW = CONTENT_W - numericW.reduce((a, b) => a + b, 0);
  const rightEdges: number[] = [];
  let edge = MARGIN + descW;
  for (const w of numericW) {
    edge += w;
    rightEdges.push(edge);
  }
  const header = () => {
    layout.ensure(24);
    layout.gap(18);
    layout.text(MARGIN, layout.y, doc.lineColumns[0], 8.5, true, true);
    doc.lineColumns.slice(1).forEach((label, i) => layout.right(rightEdges[i], layout.y, label, 8.5, true));
    layout.gap(5);
    layout.rule(layout.y);
  };
  header();
  let group: string | null = null;
  for (const line of doc.lines) {
    if (line.group && line.group !== group) {
      layout.ensure(16);
      layout.gap(14);
      layout.text(MARGIN, layout.y, line.group, 9, true);
    }
    group = line.group;
    const indent = line.isAddOn ? 10 : 0;
    const desc = wrapText(line.description, descW - 8 - indent, 9);
    const billing = wrapText(line.billing, descW - 8 - indent, 7.5);
    const height = desc.length * 12 + billing.length * 10 + 8;
    if (layout.y - height < MARGIN + 20) {
      layout.newPage();
      header();
    }
    layout.gap(14);
    const top = layout.y;
    desc.forEach((text, i) => layout.text(MARGIN + indent, top - i * 12, text, 9));
    billing.forEach((text, i) => layout.text(MARGIN + indent, top - desc.length * 12 - i * 10 + 2, text, 7.5, false, true));
    line.cells.slice(1).forEach((cell, i) => layout.right(rightEdges[i], top, cell, 9));
    layout.y = top - (desc.length - 1) * 12 - billing.length * 10 - 2;
    layout.gap(4);
    layout.rule(layout.y, 0.3);
  }
}

export function layoutQuoteDocument(doc: QuoteDocument): Page[] {
  const layout = new Layout();

  // Header: seller on the left, quote facts on the right.
  layout.gap(4);
  layout.text(MARGIN, layout.y - 14, doc.seller.name, 16, true);
  let leftY = layout.y - 30;
  for (const line of doc.seller.lines) {
    layout.text(MARGIN, leftY, line, 8.5, false, true);
    leftY -= 11;
  }
  let rightY = layout.y - 14;
  layout.right(PAGE_W - MARGIN, rightY, "QUOTE", 16, true);
  rightY -= 16;
  for (const fact of doc.facts) {
    layout.right(PAGE_W - MARGIN, rightY, `${fact.label}: ${fact.value}`, 8.5);
    rightY -= 11;
  }
  layout.y = Math.min(leftY, rightY) - 8;
  layout.rule(layout.y);

  layout.gap(22);
  layout.text(MARGIN, layout.y, doc.title, 13, true);
  layout.gap(8);
  layout.paragraph(doc.buyer.heading, 8.5, true, true);
  for (const line of doc.buyer.lines) layout.paragraph(line, 9.5);

  if (doc.customerNote) {
    layout.gap(8);
    layout.paragraph(doc.customerNote, 9.5);
  }

  drawTable(layout, doc);
  for (const group of doc.totals) drawRows(layout, group.heading, group.rows);
  if (doc.usage) {
    layout.gap(12);
    layout.paragraph("Usage (estimate)", 10.5, true);
    layout.paragraph(doc.usage.explanation, 8.5, false, true);
    for (const line of doc.usage.lines) layout.paragraph(line, 9);
  }
  drawRows(layout, doc.payment.heading, doc.payment.rows);
  if (doc.vatNotice) {
    layout.gap(10);
    layout.paragraph(doc.vatNotice, 8.5, false, true);
  }
  if (doc.terms) {
    layout.gap(14);
    layout.paragraph("Terms", 10.5, true);
    layout.paragraph(doc.terms, 8.5);
  }
  return layout.pages;
}

function footer(doc: QuoteDocument, index: number, count: number): string[] {
  const ops: string[] = [];
  const left = `${doc.number} ${doc.revisionLabel.toLowerCase()}   Page ${index + 1} of ${count}`;
  ops.push(`BT 0.42 0.45 0.5 rg /F1 7 Tf ${n(MARGIN)} ${n(FOOTER_Y + 10)} Td ${pdfString(left)} Tj ET`);
  ops.push(`BT 0.42 0.45 0.5 rg /F1 6 Tf ${n(MARGIN)} ${n(FOOTER_Y)} Td ${pdfString(doc.fingerprintLabel)} Tj ET`);
  if (doc.poweredBy) {
    const text = "Powered by ClientTurn";
    ops.push(`BT 0.42 0.45 0.5 rg /F1 7 Tf ${n(PAGE_W - MARGIN - textWidth(text, 7))} ${n(FOOTER_Y + 10)} Td ${pdfString(text)} Tj ET`);
  }
  return ops;
}

/** Assemble the PDF bytes. Deterministic for a given model. */
export function renderQuotePdf(model: QuoteRenderModel, options: { documentHash?: string | null } = {}): Uint8Array {
  const doc = quoteDocumentSections(model, options);
  const pages = layoutQuoteDocument(doc);
  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 F1, 4 F2, then page/content pairs, then info.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const kids: string[] = [];
  pages.forEach((ops, index) => {
    const pageObj = 5 + index * 2;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const stream = [...ops, ...footer(doc, index, pages.length)].join("\n");
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  const infoObj = objects.length;
  objects[infoObj] = `<< /Title ${pdfString(`Quote ${doc.number}`)} /Producer (ClientTurn) >>`;

  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** The text a reader extracts from the PDF (Tj strings in order), for tests. */
export function extractPdfText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  for (const match of source.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) {
    const raw = match[1].replace(/\\([0-7]{3})|\\(.)/g, (_all, octal: string | undefined, ch: string | undefined) =>
      octal ? String.fromCharCode(parseInt(octal, 8)) : (ch ?? ""),
    );
    parts.push(Buffer.from(raw, "latin1").toString("latin1").replace(/£/g, "£"));
  }
  return parts.join(" ");
}

export { documentStrings };
