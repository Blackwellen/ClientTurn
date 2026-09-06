import "server-only";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { serverEnv } from "@/lib/env";
import {
  describeMailError,
  formatAddress,
  normaliseEmail,
  type EmailAccountConfig,
} from "./account";
import { htmlToPlainText, sanitizeEmailHtml } from "./rich-text";
import { loadEmailCredentials } from "./store";

/**
 * Outbound email through the workspace's own SMTP server.
 *
 * One transporter per mailbox, pooled and reused, because a campaign opens
 * one connection and sends many messages down it — reconnecting per message
 * is both slow and the fastest way to trip a provider's rate limiter.
 */

type TransportKey = string;

const pool = new Map<
  TransportKey,
  { transporter: Transporter; createdAt: number }
>();

/** Recycled hourly so a rotated password cannot be used indefinitely. */
const MAX_TRANSPORT_AGE_MS = 60 * 60 * 1000;

function transportKey(config: EmailAccountConfig, password: string) {
  return [
    config.smtp.host,
    config.smtp.port,
    config.smtp.secure,
    config.smtp.username,
    // Length only: enough to notice a rotation, never the value itself.
    password.length,
  ].join("|");
}

function buildTransporter(
  config: EmailAccountConfig,
  password: string,
): Transporter {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // `secure` means implicit TLS (465). On 587 nodemailer upgrades with
    // STARTTLS, which `requireTLS` makes mandatory rather than opportunistic —
    // a customer's mail password must never cross the wire in the clear.
    secure: config.smtp.secure,
    requireTLS: !config.smtp.secure,
    auth: { user: config.smtp.username, pass: password },
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2" },
  });
}

function transporterFor(
  config: EmailAccountConfig,
  password: string,
): Transporter {
  const key = transportKey(config, password);
  const existing = pool.get(key);

  if (existing && Date.now() - existing.createdAt < MAX_TRANSPORT_AGE_MS) {
    return existing.transporter;
  }

  existing?.transporter.close();
  const transporter = buildTransporter(config, password);
  pool.set(key, { transporter, createdAt: Date.now() });
  return transporter;
}

/** Test seam, and the cleanup path when an account is disconnected. */
export function resetSmtpPool() {
  for (const entry of pool.values()) entry.transporter.close();
  pool.clear();
}

/* ------------------------------------------------------------- sending --- */

export type EmailSendRequest = {
  businessId: string;
  to: string;
  subject: string;
  /** The body as the customer authored it: restricted markup. */
  html: string;
  /** Adds a working one-click unsubscribe, as marketing email must. */
  unsubscribeUrl?: string | null;
  /** Idempotency key, echoed as the Message-ID so a resend is detectable. */
  sendKey: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string; provider: string }
  | { ok: false; errorCode: string; errorMessage: string; permanent: boolean };

/**
 * Every message goes out as both halves of a `multipart/alternative`: the
 * markup the author wrote, and a plain-text rendering of the same thing. The
 * text part is not optional — a message without one reads as bulk mail to most
 * filters, and some clients show nothing at all.
 *
 * The markup is re-sanitised here rather than trusted from the database, so a
 * body stored before a rule changed, or written by any other path, still
 * cannot carry a script or an unsafe link out to a customer.
 */
function buildBodies(
  rawHtml: string,
  unsubscribeUrl: string | null | undefined,
) {
  const html = sanitizeEmailHtml(rawHtml);
  const text = htmlToPlainText(html);

  if (!unsubscribeUrl) return { html, text };

  const escaped = unsubscribeUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

  return {
    html: `${html}<p>&mdash;<br>If you would rather not hear from us, <a href="${escaped}">unsubscribe here</a>.</p>`,
    text: `${text}\n\n—\nIf you would rather not hear from us, unsubscribe here: ${unsubscribeUrl}`,
  };
}

function messageId(sendKey: string, fromEmail: string) {
  const domain = fromEmail.split("@")[1] ?? "clientturn.com";
  // Deterministic from the send key, so the same send can never appear twice
  // in a mailbox with two different ids.
  const local = sendKey.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
  return `<${local}@${domain}>`;
}

export async function sendEmail(
  request: EmailSendRequest,
): Promise<EmailSendResult> {
  const credentials = await loadEmailCredentials(request.businessId);

  if (!credentials) {
    return {
      ok: false,
      errorCode: "email_not_connected",
      errorMessage:
        "No email account is connected for this workspace. Connect one in Settings → Connections.",
      permanent: true,
    };
  }
  if (!credentials.smtpPassword) {
    return {
      ok: false,
      errorCode: "email_credentials_unreadable",
      errorMessage:
        "The stored mailbox password could not be read. Re-enter it in Settings → Connections.",
      permanent: true,
    };
  }

  const to = normaliseEmail(request.to);
  if (!to) {
    return {
      ok: false,
      errorCode: "invalid_recipient",
      errorMessage: "That is not a usable email address.",
      permanent: true,
    };
  }

  const { config } = credentials;
  const id = messageId(request.sendKey, config.fromEmail);

  try {
    const info = await transporterFor(config, credentials.smtpPassword).sendMail({
      from: formatAddress(config.fromName, config.fromEmail),
      replyTo: config.replyTo ?? undefined,
      to,
      subject: request.subject,
      ...buildBodies(request.html, request.unsubscribeUrl),
      messageId: id,
      headers: request.unsubscribeUrl
        ? {
            // RFC 8058: lets a mail client show its own unsubscribe button,
            // which is what keeps a sender out of the spam folder.
            "List-Unsubscribe": `<${request.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "Auto-Submitted": "auto-generated",
          }
        : undefined,
    });

    return {
      ok: true,
      providerMessageId: info.messageId ?? id,
      provider: `smtp:${config.smtp.host}`,
    };
  } catch (error) {
    const described = describeMailError(error);
    return {
      ok: false,
      errorCode: described.code,
      errorMessage: described.message,
      permanent: described.permanent,
    };
  }
}

/* ------------------------------------------------------------ verifying --- */

export type VerifyResult =
  | { ok: true }
  | { ok: false; code: string; message: string; permanent: boolean };

/**
 * Proves the credentials work before they are trusted, so a customer finds out
 * at setup time rather than when a campaign silently fails.
 */
export async function verifySmtp(
  config: EmailAccountConfig,
  password: string,
): Promise<VerifyResult> {
  const transporter = buildTransporter(config, password);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...describeMailError(error) };
  } finally {
    transporter.close();
  }
}

/** Sends a real message to the connected address, as the final setup step. */
export async function sendTestEmail(
  config: EmailAccountConfig,
  password: string,
): Promise<VerifyResult> {
  const transporter = buildTransporter(config, password);
  try {
    await transporter.sendMail({
      from: formatAddress(config.fromName, config.fromEmail),
      to: config.fromEmail,
      subject: "Your ClientTurn email connection works",
      text:
        "This is a test message from ClientTurn.\n\n" +
        "Your mailbox is connected correctly, so reactivation campaigns can now " +
        "send from this address. Replies come back to this inbox.\n\n" +
        "You can safely delete this message.",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, ...describeMailError(error) };
  } finally {
    transporter.close();
  }
}

/* --------------------------------------------------------- unsubscribe --- */

/**
 * The unsubscribe URL for one lead. The token is a per-lead random value from
 * the database, so revoking one link never affects another lead.
 */
export function unsubscribeUrl(token: string): string {
  return `${serverEnv.siteUrl.replace(/\/$/, "")}/unsubscribe/${token}`;
}
