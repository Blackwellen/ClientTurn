"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { canStoreSecrets } from "@/lib/security/secret-box";
import type { ActionResult } from "@/lib/campaigns/types";
import {
  emailAccountSchema,
  toConfig,
  type EmailAccountConfig,
} from "./account";
import {
  disconnectEmailAccount,
  loadEmailAccount,
  loadEmailCredentials,
  saveEmailAccount,
} from "./store";
import { resetSmtpPool, sendTestEmail, verifySmtp } from "./smtp";
import { verifyInbound } from "./inbound";

/**
 * Connecting a workspace's own mailbox.
 *
 * Two rules run through all of this. Credentials are proved before they are
 * trusted — a connection is never stored as HEALTHY on the strength of what
 * was typed. And a password already stored is never sent back to the browser,
 * so an edit that leaves the field blank keeps what is there rather than
 * round-tripping the secret through a form.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function requireEmailAdmin() {
  try {
    // A mail password is a workspace-wide credential, so only owners and
    // admins may set or replace one.
    return { ok: true as const, workspace: await requireRole("admin") };
  } catch {
    return {
      ok: false as const,
      error: "Only owners and admins can change the email connection.",
    };
  }
}

/**
 * Resolves the password to use: the one just typed, or the one already
 * stored. Returns null when neither exists, which is the only case that must
 * block the save.
 */
async function resolvePasswords(
  businessId: string,
  input: { smtpPassword?: string; inboundPassword?: string },
  needsInbound: boolean,
): Promise<
  | { ok: true; smtp: string; inbound: string | null; changed: boolean }
  | { ok: false; error: string }
> {
  const stored = await loadEmailCredentials(businessId);

  const smtp = input.smtpPassword ?? stored?.smtpPassword ?? null;
  if (!smtp) {
    return {
      ok: false,
      error: "Enter the password for the outgoing (SMTP) server.",
    };
  }

  let inbound: string | null = null;
  if (needsInbound) {
    inbound =
      input.inboundPassword ??
      stored?.inboundPassword ??
      // Most providers use one password for both, so an unchanged inbound
      // password falls back to the outgoing one rather than blocking setup.
      input.smtpPassword ??
      null;

    if (!inbound) {
      return {
        ok: false,
        error: "Enter the password for the incoming (IMAP/POP3) server.",
      };
    }
  }

  return {
    ok: true,
    smtp,
    inbound,
    changed:
      input.smtpPassword !== undefined || input.inboundPassword !== undefined,
  };
}

/* ----------------------------------------------------------------- test --- */

export async function testEmailAccount(
  input: unknown,
): Promise<ActionResult<{ smtp: true; inbound: true }>> {
  const access = await requireEmailAdmin();
  if (!access.ok) return fail(access.error);

  const parsed = emailAccountSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  }

  const config = toConfig(parsed.data);
  const passwords = await resolvePasswords(
    access.workspace.businessId,
    parsed.data,
    config.inbound.protocol !== "none",
  );
  if (!passwords.ok) return fail(passwords.error);

  const smtp = await verifySmtp(config, passwords.smtp);
  if (!smtp.ok) return fail(`Outgoing mail (SMTP): ${smtp.message}`);

  if (config.inbound.protocol !== "none" && passwords.inbound) {
    const inbound = await verifyInbound(config, passwords.inbound);
    if (!inbound.ok) {
      return fail(
        `Incoming mail (${config.inbound.protocol.toUpperCase()}): ${inbound.message}`,
      );
    }
  }

  return ok({ smtp: true, inbound: true });
}

/* ----------------------------------------------------------------- save --- */

export async function saveEmailConnection(
  input: unknown,
): Promise<ActionResult<{ status: string; tested: boolean }>> {
  const access = await requireEmailAdmin();
  if (!access.ok) return fail(access.error);
  const workspace = access.workspace;

  if (!canStoreSecrets()) {
    return fail(
      "This environment cannot store mailbox passwords securely yet (CREDENTIAL_ENCRYPTION_KEY is not set). Ask your administrator to configure it before connecting a mailbox.",
    );
  }

  const parsed = emailAccountSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Those settings are not valid.");
  }

  const existing = await loadEmailAccount(workspace.businessId);
  const config = toConfig(parsed.data, existing?.config);

  const passwords = await resolvePasswords(
    workspace.businessId,
    parsed.data,
    config.inbound.protocol !== "none",
  );
  if (!passwords.ok) return fail(passwords.error);

  // Prove it works before storing it as usable. A connection that fails the
  // check is still saved — so the customer does not lose their typing — but
  // as ACTION_REQUIRED, which the send path treats as "cannot send".
  const smtp = await verifySmtp(config, passwords.smtp);
  const inbound =
    smtp.ok && config.inbound.protocol !== "none" && passwords.inbound
      ? await verifyInbound(config, passwords.inbound)
      : { ok: true as const };

  const healthy = smtp.ok && inbound.ok;

  await saveEmailAccount({
    businessId: workspace.businessId,
    userId: workspace.userId,
    config,
    smtpPassword: parsed.data.smtpPassword,
    inboundPassword:
      config.inbound.protocol === "none"
        ? undefined
        : (parsed.data.inboundPassword ??
          // Mirror the fallback used above so the stored inbound password
          // matches the one that was actually verified.
          (parsed.data.smtpPassword !== undefined &&
          parsed.data.inboundPassword === undefined
            ? parsed.data.smtpPassword
            : undefined)),
    status: healthy ? "HEALTHY" : "ACTION_REQUIRED",
  });

  // A changed password must not keep working through a pooled connection.
  if (passwords.changed) resetSmtpPool();

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.connected",
    entityType: "integration",
    metadata: {
      provider: "email",
      from_email: config.fromEmail,
      smtp_host: config.smtp.host,
      inbound_protocol: config.inbound.protocol,
      inbound_host: config.inbound.host,
      verified: healthy,
      // Deliberately absent: anything derived from the password.
    },
  });

  revalidatePath("/app/settings");

  if (!smtp.ok) return fail(`Saved, but outgoing mail failed: ${smtp.message}`);
  if (!inbound.ok) {
    return fail(`Saved, but incoming mail failed: ${inbound.message}`);
  }

  return ok({ status: "HEALTHY", tested: true });
}

/* ------------------------------------------------------------ test send --- */

export async function sendEmailConnectionTest(): Promise<
  ActionResult<{ to: string }>
> {
  const access = await requireEmailAdmin();
  if (!access.ok) return fail(access.error);

  const credentials = await loadEmailCredentials(access.workspace.businessId);
  if (!credentials) return fail("No email account is connected yet.");
  if (!credentials.smtpPassword) {
    return fail("The stored password could not be read. Re-enter it and save.");
  }

  const result = await sendTestEmail(credentials.config, credentials.smtpPassword);
  if (!result.ok) return fail(result.message);

  return ok({ to: credentials.config.fromEmail });
}

/* ----------------------------------------------------------- disconnect --- */

export async function disconnectEmail(): Promise<ActionResult<null>> {
  const access = await requireEmailAdmin();
  if (!access.ok) return fail(access.error);

  await disconnectEmailAccount(access.workspace.businessId);
  resetSmtpPool();

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "integration.disconnected",
    entityType: "integration",
    metadata: { provider: "email", credentials_destroyed: true },
  });

  revalidatePath("/app/settings");
  return ok(null);
}

/** Server component read: settings only, never a password. */
export async function getEmailAccount() {
  const workspace = await requireRole("member");
  return loadEmailAccount(workspace.businessId);
}

export type { EmailAccountConfig };
