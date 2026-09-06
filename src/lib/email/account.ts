/**
 * The shape of a workspace's own mailbox connection, plus the pure helpers
 * that validate and describe it.
 *
 * Deliberately free of `server-only`, of Supabase and of any mail library, so
 * the settings form, the server action, the send path and the unit tests all
 * agree on one definition of a valid mailbox.
 *
 * Why a customer's own mailbox rather than a shared platform sender: it is far
 * cheaper at volume, replies land where the business already works, and
 * deliverability rides on a domain the business already warms up. The cost is
 * that we hold their credentials, so everything here is built around keeping
 * that holding narrow and auditable.
 */

import { z } from "zod";

export const INBOUND_PROTOCOLS = ["imap", "pop3", "none"] as const;
export type InboundProtocol = (typeof INBOUND_PROTOCOLS)[number];

export const INBOUND_PROTOCOL_LABELS: Record<InboundProtocol, string> = {
  imap: "IMAP",
  pop3: "POP3",
  none: "Do not read replies",
};

/* ----------------------------------------------------------- validation --- */

const host = z
  .string()
  .trim()
  .min(3)
  .max(255)
  // A hostname only. Anything with a scheme, a path, a space or credentials in
  // it is a paste of the wrong thing and would otherwise be dialled verbatim.
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
    "Enter a mail server hostname, for example smtp.yourdomain.com",
  );

const port = z.coerce.number().int().min(1).max(65535);

export const emailAccountSchema = z
  .object({
    fromName: z.string().trim().min(1).max(120),
    fromEmail: z.email().max(254),
    replyTo: z.union([z.email().max(254), z.literal("")]).optional(),

    smtpHost: host,
    smtpPort: port.default(587),
    smtpSecure: z.boolean().default(false),
    smtpUsername: z.string().trim().min(1).max(254),
    /** Omitted on an edit that keeps the stored password. */
    smtpPassword: z.string().min(1).max(512).optional(),

    inboundProtocol: z.enum(INBOUND_PROTOCOLS).default("imap"),
    inboundHost: z.union([host, z.literal("")]).optional(),
    inboundPort: port.optional(),
    inboundSecure: z.boolean().default(true),
    inboundUsername: z.string().trim().max(254).optional(),
    inboundPassword: z.string().min(1).max(512).optional(),
    inboundMailbox: z.string().trim().max(120).default("INBOX"),
  })
  .superRefine((value, ctx) => {
    if (value.inboundProtocol === "none") return;

    if (!value.inboundHost) {
      ctx.addIssue({
        code: "custom",
        path: ["inboundHost"],
        message: "Enter the incoming mail server, or choose not to read replies.",
      });
    }
    if (!value.inboundPort) {
      ctx.addIssue({
        code: "custom",
        path: ["inboundPort"],
        message: "Enter the incoming mail server port.",
      });
    }
  });

export type EmailAccountInput = z.infer<typeof emailAccountSchema>;

/* -------------------------------------------------------------- stored --- */

/** What lives in `integrations.config` — never a password. */
export type EmailAccountConfig = {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtp: { host: string; port: number; secure: boolean; username: string };
  inbound: {
    protocol: InboundProtocol;
    host: string | null;
    port: number | null;
    secure: boolean;
    username: string | null;
    mailbox: string;
  };
  /** Where the reply poller got to, so a restart cannot replay a mailbox. */
  cursor: { uidValidity: string | null; lastUid: number; lastSeenAt: string | null };
};

/** What the browser is allowed to see: settings, plus "a password is stored". */
export type EmailAccountView = {
  config: EmailAccountConfig;
  status: string;
  hasSmtpPassword: boolean;
  hasInboundPassword: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export function toConfig(
  input: EmailAccountInput,
  previous?: EmailAccountConfig,
): EmailAccountConfig {
  const inboundEnabled = input.inboundProtocol !== "none";
  const hostChanged =
    previous?.inbound.host !== (input.inboundHost || null) ||
    previous?.inbound.protocol !== input.inboundProtocol;

  return {
    fromName: input.fromName,
    fromEmail: input.fromEmail.toLowerCase(),
    replyTo: input.replyTo ? input.replyTo.toLowerCase() : null,
    smtp: {
      host: input.smtpHost,
      port: input.smtpPort,
      secure: input.smtpSecure,
      username: input.smtpUsername,
    },
    inbound: {
      protocol: input.inboundProtocol,
      host: inboundEnabled ? (input.inboundHost || null) : null,
      port: inboundEnabled ? (input.inboundPort ?? null) : null,
      secure: input.inboundSecure,
      username: inboundEnabled
        ? (input.inboundUsername || input.smtpUsername)
        : null,
      mailbox: input.inboundMailbox || "INBOX",
    },
    // Pointing at a different mailbox invalidates the old position: keeping it
    // would silently skip everything already in the new one.
    cursor: hostChanged
      ? { uidValidity: null, lastUid: 0, lastSeenAt: null }
      : (previous?.cursor ?? { uidValidity: null, lastUid: 0, lastSeenAt: null }),
  };
}

/** Fills the settings form from what is stored. Passwords are never returned. */
export function toFormValues(
  config: EmailAccountConfig,
): Omit<EmailAccountInput, "smtpPassword" | "inboundPassword"> {
  return {
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo ?? "",
    smtpHost: config.smtp.host,
    smtpPort: config.smtp.port,
    smtpSecure: config.smtp.secure,
    smtpUsername: config.smtp.username,
    inboundProtocol: config.inbound.protocol,
    inboundHost: config.inbound.host ?? "",
    inboundPort: config.inbound.port ?? undefined,
    inboundSecure: config.inbound.secure,
    inboundUsername: config.inbound.username ?? "",
    inboundMailbox: config.inbound.mailbox,
  };
}

/* -------------------------------------------------------------- presets --- */

/**
 * Known hosts, so a non-technical user rarely types a port number. Offered as
 * a starting point only — every field stays editable.
 */
export const MAILBOX_PRESETS = [
  {
    id: "google",
    label: "Google Workspace / Gmail",
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    pop3: { host: "pop.gmail.com", port: 995, secure: true },
    note: "Requires an app password with 2-step verification switched on.",
  },
  {
    id: "microsoft",
    label: "Microsoft 365 / Outlook",
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    pop3: { host: "outlook.office365.com", port: 995, secure: true },
    note: "SMTP AUTH must be enabled for the mailbox in the Microsoft admin centre.",
  },
  {
    id: "ionos",
    label: "IONOS",
    smtp: { host: "smtp.ionos.co.uk", port: 587, secure: false },
    imap: { host: "imap.ionos.co.uk", port: 993, secure: true },
    pop3: { host: "pop.ionos.co.uk", port: 995, secure: true },
    note: null,
  },
  {
    id: "custom",
    label: "Other / custom server",
    smtp: { host: "", port: 587, secure: false },
    imap: { host: "", port: 993, secure: true },
    pop3: { host: "", port: 995, secure: true },
    note: "Your host's help pages list these as outgoing (SMTP) and incoming settings.",
  },
] as const;

export type MailboxPresetId = (typeof MAILBOX_PRESETS)[number]["id"];

/* ------------------------------------------------------------ addresses --- */

const EMAIL_RE = /^[^\s@,;<>]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Deliberately stricter than the RFC: an address that merely *could* be legal
 * is not good enough to mail, and a lead with a malformed address is better
 * suppressed as `invalid_number` than bounced.
 */
export function normaliseEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

/** RFC 5322 display-name + address, with the name quoted defensively. */
export function formatAddress(name: string, address: string): string {
  const safe = name.replace(/["\\\r\n]/g, "").trim();
  return safe ? `"${safe}" <${address}>` : address;
}

/**
 * Strips a display name and angle brackets from an inbound `From` header.
 * Returns null rather than guessing when the header is not parseable.
 */
export function addressFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const angled = header.match(/<([^>]+)>/);
  return normaliseEmail(angled ? angled[1] : header);
}

/* ------------------------------------------------------------- problems --- */

/**
 * Turns a mail-server failure into something a small business owner can act
 * on, and says whether retrying could ever help. Authentication and policy
 * failures are permanent: retrying a wrong password just locks the account.
 */
export function describeMailError(error: unknown): {
  code: string;
  message: string;
  permanent: boolean;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const code =
    (error as { code?: string } | null)?.code ??
    (error as { responseCode?: number } | null)?.responseCode?.toString() ??
    "mail_error";
  const text = raw.toLowerCase();

  if (
    text.includes("invalid login") ||
    text.includes("authentication failed") ||
    text.includes("auth") && text.includes("fail") ||
    code === "EAUTH" ||
    code === "535"
  ) {
    return {
      code: "auth_failed",
      message:
        "The mail server rejected the username or password. If your provider uses two-step verification you need an app password, not your normal one.",
      permanent: true,
    };
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || text.includes("getaddrinfo")) {
    return {
      code: "host_not_found",
      message:
        "That mail server hostname could not be found. Check it against your provider's incoming and outgoing settings.",
      permanent: true,
    };
  }

  if (code === "ECONNREFUSED" || text.includes("connection refused")) {
    return {
      code: "connection_refused",
      message:
        "The mail server refused the connection on that port. Check the port and whether TLS should be on.",
      permanent: true,
    };
  }

  if (code === "ETIMEDOUT" || code === "ESOCKET" || text.includes("timeout")) {
    return {
      code: "timeout",
      message:
        "The mail server did not respond in time. It may be temporarily unavailable.",
      permanent: false,
    };
  }

  if (text.includes("certificate") || text.includes("self signed")) {
    return {
      code: "tls_error",
      message:
        "The mail server's security certificate could not be verified. Check the hostname matches the certificate.",
      permanent: true,
    };
  }

  if (
    text.includes("mailbox unavailable") ||
    text.includes("user unknown") ||
    text.includes("no such user") ||
    code === "550"
  ) {
    return {
      code: "recipient_rejected",
      message: "The recipient address was rejected by the mail server.",
      permanent: true,
    };
  }

  if (text.includes("quota") || text.includes("rate") || code === "421" || code === "450") {
    return {
      code: "rate_limited",
      message:
        "The mail server is rate limiting or over quota. Sending will resume automatically.",
      permanent: false,
    };
  }

  return {
    code: String(code),
    message: raw.slice(0, 300) || "The mail server reported an error.",
    permanent: false,
  };
}

/* --------------------------------------------------------- send volume --- */

/**
 * A customer mailbox is not a bulk relay: most providers cap daily sends
 * (Gmail ~500/2000, Microsoft 365 ~10,000 with a 30/minute burst limit), and
 * exceeding it gets the account throttled or suspended. These are the safe
 * defaults the scheduler paces to when we have no better information.
 */
export const MAILBOX_SEND_LIMITS: Record<
  string,
  { perMinute: number; perDay: number }
> = {
  "smtp.gmail.com": { perMinute: 20, perDay: 450 },
  "smtp.office365.com": { perMinute: 25, perDay: 9000 },
};

export const DEFAULT_MAILBOX_LIMITS = { perMinute: 20, perDay: 1000 };

export function limitsForHost(host: string) {
  return MAILBOX_SEND_LIMITS[host.toLowerCase()] ?? DEFAULT_MAILBOX_LIMITS;
}
