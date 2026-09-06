import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecret, sealSecret } from "@/lib/security/secret-box";
import type {
  EmailAccountConfig,
  EmailAccountView,
} from "./account";

/**
 * Reading and writing a workspace's mailbox connection.
 *
 * The split is deliberate and load-bearing: `loadEmailAccount` returns
 * settings only and is safe to hand to a server component, while
 * `loadEmailCredentials` decrypts the passwords and is called only by the two
 * places that open a socket. Nothing that returns to a browser ever carries a
 * password, and there is no code path that could accidentally serialise one.
 */

const PROVIDER = "imap_smtp";

type SecretsExtra = {
  smtp_password?: string;
  inbound_password?: string;
};

function emptyCursor() {
  return { uidValidity: null, lastUid: 0, lastSeenAt: null };
}

/** Tolerates a partially-written row rather than throwing on a null field. */
function normaliseConfig(raw: unknown): EmailAccountConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<EmailAccountConfig>;
  if (!value.smtp?.host || !value.fromEmail) return null;

  return {
    fromName: value.fromName ?? "",
    fromEmail: value.fromEmail,
    replyTo: value.replyTo ?? null,
    smtp: {
      host: value.smtp.host,
      port: value.smtp.port ?? 587,
      secure: value.smtp.secure ?? false,
      username: value.smtp.username ?? value.fromEmail,
    },
    inbound: {
      protocol: value.inbound?.protocol ?? "none",
      host: value.inbound?.host ?? null,
      port: value.inbound?.port ?? null,
      secure: value.inbound?.secure ?? true,
      username: value.inbound?.username ?? null,
      mailbox: value.inbound?.mailbox ?? "INBOX",
    },
    cursor: value.cursor ?? emptyCursor(),
  };
}

export async function loadEmailAccount(
  businessId: string,
): Promise<EmailAccountView | null> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select(
      "id, status, config, last_success_at, last_error_at, last_error_message",
    )
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER)
    .maybeSingle();

  if (!integration) return null;

  const config = normaliseConfig(integration.config);
  if (!config) return null;

  const { data: secrets } = await admin
    .from("integration_secrets")
    .select("extra")
    .eq("integration_id", integration.id)
    .maybeSingle();

  const extra = (secrets?.extra ?? {}) as SecretsExtra;

  return {
    config,
    status: integration.status,
    // Presence only — the value itself never leaves this module.
    hasSmtpPassword: Boolean(extra.smtp_password),
    hasInboundPassword: Boolean(extra.inbound_password),
    lastSuccessAt: integration.last_success_at,
    lastErrorAt: integration.last_error_at,
    lastErrorMessage: integration.last_error_message,
  };
}

export type EmailCredentials = {
  integrationId: string;
  config: EmailAccountConfig;
  smtpPassword: string | null;
  inboundPassword: string | null;
};

/** Only for code that is about to open a connection. Never for a response body. */
export async function loadEmailCredentials(
  businessId: string,
): Promise<EmailCredentials | null> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .select("id, config")
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER)
    .maybeSingle();

  if (!integration) return null;
  const config = normaliseConfig(integration.config);
  if (!config) return null;

  const { data: secrets } = await admin
    .from("integration_secrets")
    .select("extra")
    .eq("integration_id", integration.id)
    .maybeSingle();

  const extra = (secrets?.extra ?? {}) as SecretsExtra;

  return {
    integrationId: integration.id,
    config,
    smtpPassword: openSecret(extra.smtp_password),
    inboundPassword: openSecret(extra.inbound_password),
  };
}

export async function saveEmailAccount(input: {
  businessId: string;
  userId: string | null;
  config: EmailAccountConfig;
  /** Undefined keeps whatever is stored; a string replaces it. */
  smtpPassword?: string;
  inboundPassword?: string;
  status: string;
}): Promise<{ integrationId: string }> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("integrations")
    .upsert(
      {
        business_id: input.businessId,
        provider_type: PROVIDER,
        status: input.status,
        display_name: input.config.fromEmail,
        external_account_id: input.config.fromEmail,
        config: input.config as never,
        connected_by: input.userId,
      },
      { onConflict: "business_id,provider_type" },
    )
    .select("id")
    .single();

  if (!integration) throw new Error("Could not save the email connection.");

  const { data: existing } = await admin
    .from("integration_secrets")
    .select("extra")
    .eq("integration_id", integration.id)
    .maybeSingle();

  const extra = { ...((existing?.extra ?? {}) as SecretsExtra) };

  if (input.smtpPassword !== undefined) {
    extra.smtp_password = sealSecret(input.smtpPassword);
  }
  if (input.inboundPassword !== undefined) {
    extra.inbound_password = sealSecret(input.inboundPassword);
  }
  // Choosing "do not read replies" should not leave a decryptable password
  // sitting in the row for a mailbox we no longer open.
  if (input.config.inbound.protocol === "none") {
    delete extra.inbound_password;
  }

  await admin.from("integration_secrets").upsert(
    {
      integration_id: integration.id,
      business_id: input.businessId,
      extra: extra as never,
    },
    { onConflict: "integration_id" },
  );

  return { integrationId: integration.id };
}

/** Advances the reply poller's position. Never moves backwards. */
export async function saveInboundCursor(
  businessId: string,
  cursor: EmailAccountConfig["cursor"],
) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id, config")
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER)
    .maybeSingle();

  if (!data) return;
  const config = normaliseConfig(data.config);
  if (!config) return;

  await admin
    .from("integrations")
    .update({ config: { ...config, cursor } as never })
    .eq("id", data.id);
}

export async function recordEmailHealth(
  businessId: string,
  outcome:
    | { ok: true }
    | { ok: false; code: string; message: string; permanent: boolean },
) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  await admin
    .from("integrations")
    .update(
      outcome.ok
        ? {
            status: "HEALTHY",
            last_success_at: now,
            last_error_at: null,
            last_error_code: null,
            last_error_message: null,
          }
        : {
            // A permanent failure needs a human; a transient one is only a
            // degradation and the next send may well succeed.
            status: outcome.permanent ? "ACTION_REQUIRED" : "DEGRADED",
            last_error_at: now,
            last_error_code: outcome.code,
            last_error_message: outcome.message.slice(0, 500),
          },
    )
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER);
}

export async function disconnectEmailAccount(businessId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider_type", PROVIDER)
    .maybeSingle();

  if (!data) return;

  // Credentials are destroyed, not merely orphaned: disconnecting must mean
  // we no longer hold the customer's mail password.
  await admin.from("integration_secrets").delete().eq("integration_id", data.id);
  await admin
    .from("integrations")
    .update({
      status: "DISCONNECTED",
      last_error_at: null,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", data.id);
}
