import "server-only";
import { z } from "zod";
import { normalisePhone } from "@/lib/messaging/provider";
import type { ImportMapping, ImportPreview, ImportRowError } from "./types";

export const MAX_IMPORT_ROWS = 5000;

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

const UK_POSTCODE =
  /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const rowSchema = z.object({
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(6).max(24),
  email: z.email().max(160).optional(),
  service: z.string().trim().max(120).optional(),
  postcode: z
    .string()
    .trim()
    .max(12)
    .refine((value) => UK_POSTCODE.test(value), "Not a UK postcode")
    .optional(),
});

export type ValidatedImportRow = {
  row: number;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  phoneNormalized: string;
  email: string | null;
  service: string | null;
  postcode: string | null;
};

export type ValidationResult = {
  rows: ValidatedImportRow[];
  errors: ImportRowError[];
  headers: string[];
  rowCount: number;
};

function clean(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Every row is validated before anything reaches the database. The mapping is
 * a fixed set of known fields, never an arbitrary schema.
 */
export function validateImport(
  table: string[][],
  mapping: ImportMapping,
): ValidationResult {
  const [headerRow, ...body] = table;
  const headers = (headerRow ?? []).map((cell) => cell.trim());
  const index = (name: string | undefined) =>
    name === undefined ? -1 : headers.indexOf(name);

  const columns = {
    first_name: index(mapping.first_name),
    last_name: index(mapping.last_name),
    phone: index(mapping.phone),
    email: index(mapping.email),
    service: index(mapping.service),
    postcode: index(mapping.postcode),
  };

  const rows: ValidatedImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();

  body.slice(0, MAX_IMPORT_ROWS).forEach((cells, offset) => {
    const number = offset + 2;
    const pick = (column: number) =>
      column < 0 ? undefined : clean(cells[column]);

    const parsed = rowSchema.safeParse({
      first_name: pick(columns.first_name),
      last_name: pick(columns.last_name),
      phone: pick(columns.phone),
      email: pick(columns.email),
      service: pick(columns.service),
      postcode: pick(columns.postcode),
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: number,
          field: String(issue.path[0] ?? "row"),
          message: issue.message,
        });
      }
      return;
    }

    const normalized = normalisePhone(parsed.data.phone);
    if (!normalized || !/^\+\d{10,15}$/.test(normalized)) {
      errors.push({
        row: number,
        field: "phone",
        message: "Not a usable mobile number",
      });
      return;
    }
    if (seen.has(normalized)) {
      errors.push({
        row: number,
        field: "phone",
        message: "Duplicate of an earlier row in this file",
      });
      return;
    }
    seen.add(normalized);

    rows.push({
      row: number,
      firstName: parsed.data.first_name ?? null,
      lastName: parsed.data.last_name ?? null,
      phone: parsed.data.phone,
      phoneNormalized: normalized,
      email: parsed.data.email ?? null,
      service: parsed.data.service ?? null,
      postcode: parsed.data.postcode ?? null,
    });
  });

  if (body.length > MAX_IMPORT_ROWS) {
    errors.push({
      row: MAX_IMPORT_ROWS + 1,
      field: "row",
      message: `Only the first ${MAX_IMPORT_ROWS.toLocaleString("en-GB")} rows are imported`,
    });
  }

  return { rows, errors, headers, rowCount: body.length };
}

export function toPreview(result: ValidationResult): ImportPreview {
  return {
    headers: result.headers,
    rowCount: result.rowCount,
    validCount: result.rows.length,
    invalidCount: Math.max(0, result.rowCount - result.rows.length),
    errors: result.errors.slice(0, 50),
    sample: result.rows.slice(0, 10).map((row) => ({
      row: row.row,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      phone: row.phoneNormalized,
      email: row.email ?? "",
      service: row.service ?? "",
      postcode: row.postcode ?? "",
    })),
  };
}
