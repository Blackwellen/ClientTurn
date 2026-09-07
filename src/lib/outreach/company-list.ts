/**
 * Parsing a named company list out of a CSV.
 *
 * Pure — no React, no `server-only` — so the parsing that decides which
 * companies a campaign will target is unit-testable on its own. A spreadsheet
 * export is messier than it looks: quoted fields, embedded commas, a header
 * row that may or may not be there.
 */

/** Bounded so a 50,000-row file cannot lock the tab parsing it. */
export const MAX_COMPANY_ROWS = 5000;

/** Header names that identify the column holding the company. */
const COMPANY_HEADERS = [
  "company",
  "company name",
  "name",
  "organisation",
  "organization",
  "domain",
  "website",
];

/**
 * Company names and domains out of a CSV.
 *
 * Handles the quoted fields a spreadsheet export actually produces, takes the
 * named column when there is a recognisable header, and otherwise falls back
 * to the first column — which is what a one-column list of company names looks
 * like.
 */
export function parseCompanyCsv(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const named = header.findIndex((cell) => COMPANY_HEADERS.includes(cell));

  // A header row is only skipped when it actually looks like one; a bare list
  // of names would otherwise lose its first company.
  const hasHeader = named !== -1;
  const column = hasHeader ? named : 0;
  const rows = hasHeader ? lines.slice(1) : lines;

  const values: string[] = [];
  for (const line of rows) {
    const cells = splitCsvLine(line);
    const value = (cells[column] ?? "").trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (values.length >= MAX_COMPANY_ROWS) break;
    values.push(value.slice(0, 200));
  }

  return values;
}

/** A single CSV line, respecting quotes and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }

  cells.push(current);
  return cells;
}
