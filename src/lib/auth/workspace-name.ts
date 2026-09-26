/**
 * Workspace naming (Phase 8.29).
 *
 * Every workspace is named by its owner, by hand, in onboarding's first step.
 * Neither way in asks for it any more: signup is email, password and name, and
 * "Continue with Google" gives us a verified email and a person's name, never
 * a business name. So both create the workspace as `UNNAMED_WORKSPACE`, a
 * placeholder onboarding refuses to accept, and nothing the owner sees shows
 * it: the app shell is closed until onboarding is finished, and Stripe
 * Checkout is keyed on the owner's email, not the workspace name.
 *
 * `workspaceNameFromEmail` survives only as a hint. A B2B buyer almost always
 * signs in with their work address, so the domain is the best available guess
 * at the company (`hello@acme-digital.co.uk` → "Acme Digital"), shown as the
 * empty field's placeholder ("e.g. Acme Digital") and never pre-filled.
 *
 * Pure — no `server-only` — so it can be tested directly.
 */

/** What a workspace is called until its owner names it. Never shown to them. */
export const UNNAMED_WORKSPACE = "Unnamed workspace";

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 120;

/** Whether a stored name is the placeholder (or empty), i.e. the workspace still needs naming. */
export function isUnnamedWorkspace(name: string | null | undefined): boolean {
  const value = (name ?? "").trim();
  return value.length === 0 || value.toLowerCase() === UNNAMED_WORKSPACE.toLowerCase();
}

/**
 * The one rule for a workspace name, used by the onboarding form (to enable
 * Continue) and by the server action (as the real check). Returns the trimmed
 * name, or the reason it cannot be used.
 */
export function validateWorkspaceName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length === 0) return { ok: false, error: "Name your workspace to continue." };
  if (isUnnamedWorkspace(name)) return { ok: false, error: "Give your workspace its real name." };
  if (name.length < WORKSPACE_NAME_MIN) return { ok: false, error: "Use at least 2 characters." };
  if (name.length > WORKSPACE_NAME_MAX) return { ok: false, error: "Use 120 characters or fewer." };
  return { ok: true, name };
}

/** Consumer mailbox domains, which name the email provider rather than the business. */
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.co.uk",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
]);

/** Second-level labels that sit under a country code (`acme.co.uk`, `acme.com.au`). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ltd", "plc", "ac", "gov"]);

function titleCase(label: string): string {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function workspaceNameFromEmail(email: string, firstName?: string | null): string {
  const personal = firstName?.trim() ? `${firstName.trim()}'s workspace` : "My workspace";

  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || PERSONAL_DOMAINS.has(domain)) return personal;

  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return personal;

  // Drop the public suffix: one label (`.com`), or two for `co.uk`-style names.
  const suffixLength = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 2 : 1;
  const registrable = labels[labels.length - suffixLength - 1];
  const name = registrable ? titleCase(registrable) : "";

  return name ? name.slice(0, 120) : personal;
}

/**
 * The placeholder text for the empty workspace-name field: the domain guess
 * for a work address, a neutral example for a personal mailbox (a guess of
 * "Sam's workspace" would only invite someone to keep it).
 */
export function workspaceNamePlaceholder(email: string | null | undefined): string {
  const fallback = "e.g. Acme Digital Ltd";
  if (!email) return fallback;
  const guess = workspaceNameFromEmail(email);
  return guess === "My workspace" ? fallback : `e.g. ${guess}`;
}
