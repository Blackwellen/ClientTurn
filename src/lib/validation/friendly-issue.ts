/**
 * The first validation problem, in words a customer can act on.
 *
 * Server actions return `issues[0].message` to the browser. Where a schema
 * gives its own message that is used as is; where it does not, Zod's default
 * is developer text ("Too big: expected string to have <=80 characters"),
 * which reached the settings forms verbatim (surface QA 2026-09-30). This
 * rewrites only those defaults, using the field name from the issue path.
 *
 * Pure: no `server-only`, so it is unit-testable and usable anywhere.
 */
type Issue = {
  code?: string;
  path?: PropertyKey[];
  message: string;
  maximum?: number | bigint;
  minimum?: number | bigint;
  origin?: string;
};

const ZOD_DEFAULT = /^(Too big|Too small|Invalid input|Invalid (string|number|type|option|format|UUID|email|URL|url|uuid)|Expected |Required$)/;

function fieldLabel(path: PropertyKey[] | undefined): string {
  const last = [...(path ?? [])].reverse().find((part) => typeof part === "string");
  if (typeof last !== "string" || !last) return "This field";
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function friendlyIssueMessage(issue: Issue | undefined, fallback: string): string {
  if (!issue) return fallback;
  if (!ZOD_DEFAULT.test(issue.message)) return issue.message;
  const label = fieldLabel(issue.path);
  const isString = issue.origin === "string";
  if (issue.code === "too_big" && issue.maximum !== undefined) {
    return isString
      ? `${label} must be ${issue.maximum} characters or fewer.`
      : `${label} must be ${issue.maximum} or less.`;
  }
  if (issue.code === "too_small" && issue.minimum !== undefined) {
    if (isString) {
      return Number(issue.minimum) <= 1
        ? `${label} is required.`
        : `${label} must be at least ${issue.minimum} characters.`;
    }
    return `${label} must be ${issue.minimum} or more.`;
  }
  if (issue.code === "invalid_type") return `${label} is missing or not valid.`;
  return `${label} is not valid.`;
}

export function friendlyIssue(
  error: { issues: Issue[] },
  fallback: string,
): string {
  return friendlyIssueMessage(error.issues[0], fallback);
}
