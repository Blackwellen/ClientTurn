import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  addressFromHeader,
  describeMailError,
  type EmailAccountConfig,
} from "./account";
import { fetchPop3Messages, verifyPop3 } from "./pop3";
import type { EmailCredentials } from "./store";

/**
 * Reading replies from the workspace's own mailbox, over IMAP or POP3.
 *
 * Both protocols reduce to the same contract: hand back the messages that
 * have arrived since the stored cursor, and the new cursor. Everything above
 * this file is protocol-agnostic.
 */

export type InboundEmail = {
  /** Protocol-level id, used only to advance the cursor. */
  uid: string;
  from: string | null;
  subject: string | null;
  text: string;
  receivedAt: string;
  messageId: string | null;
  /** Present when the mail is a bounce/auto-reply rather than a human. */
  autoSubmitted: boolean;
};

export type InboundCursor = EmailAccountConfig["cursor"];

const MAX_PER_POLL = 25;

/* -------------------------------------------------------------- parsing --- */

/**
 * Trims the quoted history off a reply. A campaign only needs what the person
 * actually wrote, and keeping the thread would store the original marketing
 * message back into the conversation on every reply.
 */
export function stripQuotedReply(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (line) =>
      /^>/.test(line.trim()) ||
      /^-{2,}\s*original message\s*-{2,}$/i.test(line.trim()) ||
      /^on .+ wrote:$/i.test(line.trim()) ||
      /^from:\s/i.test(line.trim()) ||
      /^_{5,}$/.test(line.trim()),
  );

  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  // Never return empty for a message that had content: a bare "thanks" under a
  // quote line still matters.
  return kept.length > 0 ? kept : body.trim();
}

/** True for bounces, vacation responders and other machine mail. */
export function isAutomatedMail(headers: {
  autoSubmitted?: string | null;
  precedence?: string | null;
  from?: string | null;
  returnPath?: string | null;
}): boolean {
  const auto = (headers.autoSubmitted ?? "").toLowerCase();
  if (auto && auto !== "no") return true;

  const precedence = (headers.precedence ?? "").toLowerCase();
  if (["bulk", "junk", "auto_reply", "list"].includes(precedence)) return true;

  const from = (headers.from ?? "").toLowerCase();
  if (
    /(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/.test(from)
  ) {
    return true;
  }

  // An empty Return-Path is the RFC 3834 marker for a notification that must
  // never itself be replied to.
  return (headers.returnPath ?? "").trim() === "<>";
}

async function parseRaw(raw: string | Buffer, uid: string): Promise<InboundEmail> {
  const parsed = await simpleParser(raw);
  const headerValue = (name: string) => {
    const value = parsed.headers.get(name);
    return typeof value === "string" ? value : null;
  };

  return {
    uid,
    from: addressFromHeader(parsed.from?.value?.[0]?.address ?? parsed.from?.text),
    subject: parsed.subject ?? null,
    text: stripQuotedReply(parsed.text ?? ""),
    receivedAt: (parsed.date ?? new Date()).toISOString(),
    messageId: parsed.messageId ?? null,
    autoSubmitted: isAutomatedMail({
      autoSubmitted: headerValue("auto-submitted"),
      precedence: headerValue("precedence"),
      from: parsed.from?.text ?? null,
      returnPath: headerValue("return-path"),
    }),
  };
}

/* ----------------------------------------------------------------- imap --- */

async function fetchImap(
  config: EmailAccountConfig,
  password: string,
  cursor: InboundCursor,
): Promise<{ messages: InboundEmail[]; cursor: InboundCursor }> {
  const client = new ImapFlow({
    host: config.inbound.host!,
    port: config.inbound.port!,
    secure: config.inbound.secure,
    auth: { user: config.inbound.username!, pass: password },
    logger: false,
    tls: { minVersion: "TLSv1.2" },
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(config.inbound.mailbox || "INBOX");
    try {
      const mailbox = client.mailbox;
      if (typeof mailbox === "boolean") {
        return { messages: [], cursor };
      }

      const uidValidity = String(mailbox.uidValidity ?? "");
      // A changed UIDVALIDITY means every stored uid is meaningless. Restart
      // from "now" rather than from 0, so re-adding a mailbox does not replay
      // years of mail as fresh replies.
      const reset = cursor.uidValidity !== null && cursor.uidValidity !== uidValidity;
      const since = reset ? Math.max(0, (mailbox.uidNext ?? 1) - 1) : cursor.lastUid;

      if (reset || cursor.uidValidity === null) {
        if (cursor.lastUid === 0) {
          // First ever poll: take only what arrives from here on.
          return {
            messages: [],
            cursor: {
              uidValidity,
              lastUid: Math.max(0, (mailbox.uidNext ?? 1) - 1),
              lastSeenAt: new Date().toISOString(),
            },
          };
        }
      }

      const messages: InboundEmail[] = [];
      let highest = since;

      for await (const message of client.fetch(
        { uid: `${since + 1}:*` },
        { uid: true, source: true },
        { uid: true },
      )) {
        if (message.uid <= since) continue;
        highest = Math.max(highest, message.uid);
        if (message.source) {
          messages.push(await parseRaw(message.source, String(message.uid)));
        }
        if (messages.length >= MAX_PER_POLL) break;
      }

      return {
        messages,
        cursor: {
          uidValidity,
          lastUid: highest,
          lastSeenAt: new Date().toISOString(),
        },
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/* ----------------------------------------------------------------- pop3 --- */

async function fetchPop3(
  config: EmailAccountConfig,
  password: string,
  cursor: InboundCursor,
): Promise<{ messages: InboundEmail[]; cursor: InboundCursor }> {
  // POP3 has no per-message sequence that survives a session, so the cursor
  // holds the last UIDL string instead of a number. `uidValidity` carries it.
  const { messages: raw, lastUid } = await fetchPop3Messages(
    {
      host: config.inbound.host!,
      port: config.inbound.port!,
      secure: config.inbound.secure,
      username: config.inbound.username!,
      password,
    },
    cursor.uidValidity,
    MAX_PER_POLL,
  );

  const messages: InboundEmail[] = [];
  for (const entry of raw) {
    messages.push(await parseRaw(entry.raw, entry.uid));
  }

  return {
    messages,
    cursor: {
      uidValidity: lastUid,
      lastUid: cursor.lastUid,
      lastSeenAt: new Date().toISOString(),
    },
  };
}

/* ---------------------------------------------------------------- entry --- */

export async function fetchInboundEmail(
  credentials: EmailCredentials,
): Promise<
  | { ok: true; messages: InboundEmail[]; cursor: InboundCursor }
  | { ok: false; code: string; message: string; permanent: boolean }
> {
  const { config } = credentials;

  if (config.inbound.protocol === "none") {
    return { ok: true, messages: [], cursor: config.cursor };
  }
  if (!config.inbound.host || !config.inbound.port || !config.inbound.username) {
    return {
      ok: false,
      code: "inbound_not_configured",
      message: "The incoming mail server settings are incomplete.",
      permanent: true,
    };
  }
  if (!credentials.inboundPassword) {
    return {
      ok: false,
      code: "inbound_credentials_unreadable",
      message:
        "The stored incoming mail password could not be read. Re-enter it in Settings → Connections.",
      permanent: true,
    };
  }

  try {
    const result =
      config.inbound.protocol === "imap"
        ? await fetchImap(config, credentials.inboundPassword, config.cursor)
        : await fetchPop3(config, credentials.inboundPassword, config.cursor);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, ...describeMailError(error) };
  }
}

/** Authenticates against the incoming server, for the setup form's test button. */
export async function verifyInbound(
  config: EmailAccountConfig,
  password: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string; permanent: boolean }> {
  if (config.inbound.protocol === "none") return { ok: true };
  if (!config.inbound.host || !config.inbound.port || !config.inbound.username) {
    return {
      ok: false,
      code: "inbound_not_configured",
      message: "The incoming mail server settings are incomplete.",
      permanent: true,
    };
  }

  try {
    if (config.inbound.protocol === "pop3") {
      await verifyPop3({
        host: config.inbound.host,
        port: config.inbound.port,
        secure: config.inbound.secure,
        username: config.inbound.username,
        password,
      });
      return { ok: true };
    }

    const client = new ImapFlow({
      host: config.inbound.host,
      port: config.inbound.port,
      secure: config.inbound.secure,
      auth: { user: config.inbound.username, pass: password },
      logger: false,
      tls: { minVersion: "TLSv1.2" },
    });
    await client.connect();
    const lock = await client.getMailboxLock(config.inbound.mailbox || "INBOX");
    lock.release();
    await client.logout().catch(() => client.close());
    return { ok: true };
  } catch (error) {
    return { ok: false, ...describeMailError(error) };
  }
}
