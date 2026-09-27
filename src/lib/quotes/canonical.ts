/**
 * Canonical JSON + SHA-256, so a hash over a structure is stable across key
 * order, runtimes and re-serialisation. Used for `calculationHash`, the
 * sealed document hash of a signed revision, and idempotency keys.
 *
 * Rules: object keys sorted by code unit; `undefined` properties dropped;
 * arrays kept in order; non-finite numbers, functions, symbols and bigint
 * are refused (money is already integer minor units).
 */

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? "null" : serialise(item))).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialise(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
