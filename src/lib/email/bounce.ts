/**
 * Bounce classification: which failures are about ONE recipient and which are
 * about the whole mailbox (gap audit 15, top-10 #8).
 *
 * Two failure shapes reach us:
 *
 * 1. **Synchronous**: the customer's own SMTP server refuses the message while
 *    we are still connected (nodemailer throws). A `5.1.x` / `5.2.1` /
 *    "user unknown" refusal at `RCPT TO` is a fact about that address: the
 *    address is suppressed and the mailbox stays healthy. Authentication, TLS,
 *    DNS, connection and `5.7.x` policy failures are about the mailbox and are
 *    what `recordEmailHealth` exists for.
 * 2. **Asynchronous**: a non-delivery report (NDR / DSN) lands in the mailbox
 *    later and the `email.poll` job reads it. The failed address is taken from
 *    the machine-readable parts only (`X-Failed-Recipients`, the
 *    `message/delivery-status` part, "Final-Recipient" lines). If no address
 *    can be named with confidence, **nothing is suppressed**: suppressing the
 *    mailer-daemon, the postmaster or the customer's own address is worse than
 *    missing one bounce, because the address is re-checked on the next send.
 *
 * Pure: no server-only import, so tests import it directly.
 */

export type FailureScope =
  /** One address is bad. Suppress it; the mailbox is fine. */
  | "recipient"
  /** The mailbox itself is broken (auth, TLS, host, policy). */
  | "mailbox"
  /** Temporary: rate limit, timeout, greylisting. Retry later. */
  | "transient";

export type SmtpFailureLike = {
  message?: string;
  code?: string | null;
  responseCode?: number | null;
  response?: string | null;
  command?: string | null;
  rejected?: readonly string[] | null;
};

/** The enhanced status code (RFC 3463) in a server response, e.g. "5.1.1". */
export function enhancedStatus(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/\b([245])\.(\d{1,3})\.(\d{1,3})\b/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

const RECIPIENT_PHRASES = [
  "user unknown",
  "no such user",
  "unknown user",
  "mailbox unavailable",
  "mailbox not found",
  "recipient not found",
  "address rejected",
  "recipient address rejected",
  "does not exist",
  "invalid recipient",
  "no mailbox here",
  "account has been disabled",
];

/**
 * Where a send failure belongs.
 *
 * Order matters: a mailbox-level fault is checked first, so an `auth` failure
 * that happens to mention a recipient is never mistaken for a bad address.
 */
export function classifySmtpFailure(error: unknown): FailureScope {
  const e = (error ?? {}) as SmtpFailureLike;
  const raw = `${e.message ?? String(error ?? "")} ${e.response ?? ""}`;
  const text = raw.toLowerCase();
  const code = e.code ?? null;
  const responseCode = e.responseCode ?? null;
  const status = enhancedStatus(raw);

  // Mailbox-level: the connection, the credentials or the sending policy.
  if (
    code === "EAUTH" ||
    responseCode === 535 ||
    responseCode === 530 ||
    text.includes("invalid login") ||
    text.includes("authentication") ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "ETLS" ||
    text.includes("certificate") ||
    text.includes("starttls")
  ) {
    return "mailbox";
  }

  // 5.7.x is policy: relaying denied, sender not permitted, message refused as
  // spam, DMARC. It is not about the address, so the address is never
  // suppressed for it.
  if (status?.startsWith("5.7.")) return "mailbox";

  // Temporary server states.
  if (
    status?.startsWith("4.") ||
    (responseCode !== null && responseCode >= 400 && responseCode < 500) ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    text.includes("timeout") ||
    text.includes("try again later") ||
    text.includes("rate limit")
  ) {
    return "transient";
  }

  // Recipient-level: a 5.1.x address fault, a disabled mailbox (5.2.1), or a
  // refusal at RCPT TO naming the address.
  if (
    status?.startsWith("5.1.") ||
    status === "5.2.1" ||
    (code === "EENVELOPE" && (e.rejected?.length ?? 0) > 0) ||
    (e.command?.toUpperCase().startsWith("RCPT") && responseCode !== null && responseCode >= 500) ||
    RECIPIENT_PHRASES.some((phrase) => text.includes(phrase))
  ) {
    return "recipient";
  }

  // A bare 550 with nothing else to go on: most servers use it for an unknown
  // user, but it is also a generic policy refusal. Treat as recipient only at
  // RCPT (handled above); otherwise the mailbox gets a DEGRADED note rather
  // than a stranger's address being suppressed.
  if (responseCode !== null && responseCode >= 500) return "mailbox";

  return "transient";
}

/* ------------------------------------------------------ non-delivery --- */

export type BounceCandidate = {
  from: string | null;
  subject: string | null;
  text: string;
  /** The `message/delivery-status` part (RFC 3464), when attached. */
  deliveryStatus?: string | null;
  /** The `X-Failed-Recipients` header (Exim, Gmail). */
  failedRecipientsHeader?: string | null;
};

export type BounceVerdict = {
  isBounce: boolean;
  /** Permanent (5.x.x / "failed"): only a hard bounce is suppressed. */
  hard: boolean;
  /** The address that failed, or null when it could not be named safely. */
  recipient: string | null;
};

const BOUNCE_SUBJECT_HINTS = [
  "delivery status notification",
  "undeliverable",
  "undelivered mail",
  "mail delivery failed",
  "mail delivery failure",
  "returned mail",
  "delivery failure",
  "failure notice",
  "non-delivery",
];

const BOUNCE_BODY_HINTS = [
  "user unknown",
  "no such user",
  "mailbox unavailable",
  "address rejected",
  "does not exist",
  "recipient not found",
  "550 5.1.1",
  "the following address(es) failed",
  "could not be delivered",
];

const SOFT_HINTS = [
  "delivery has been delayed",
  "delivery delayed",
  "will retry",
  "will be retried",
  "still trying",
  "temporarily",
  "mailbox full",
  "over quota",
  "quota exceeded",
];

/** Addresses that are machinery, never a person who could have bounced. */
export function isMachineAddress(address: string): boolean {
  const local = address.split("@")[0]?.toLowerCase() ?? "";
  return /^(mailer-daemon|postmaster|mail-daemon|maildaemon|bounces?|no-?reply|do-?not-?reply|abuse|dmarc|dsn)([+._-].*)?$/.test(
    local,
  );
}

const ADDRESS_RE = /[\w.+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

function addressesIn(text: string): string[] {
  return Array.from(new Set((text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase())));
}

function strictAddress(value: string): string | null {
  const trimmed = value.trim().replace(/^<|>$/g, "").toLowerCase();
  return /^[\w.+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(trimmed) ? trimmed : null;
}

/**
 * Candidates from the machine-readable fields only, in priority order.
 * A per-recipient DSN block also yields its own hard/soft status.
 */
function dsnRecipients(dsn: string): { address: string; hard: boolean }[] {
  const out: { address: string; hard: boolean }[] = [];
  // Per-recipient blocks are separated by a blank line (RFC 3464 §2.1).
  for (const block of dsn.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const recipient =
      block.match(/^\s*final-recipient:\s*(?:rfc822;\s*)?(.+)$/im)?.[1] ??
      block.match(/^\s*original-recipient:\s*(?:rfc822;\s*)?(.+)$/im)?.[1];
    if (!recipient) continue;
    const address = strictAddress(recipient);
    if (!address) continue;
    const action = block.match(/^\s*action:\s*(\w+)/im)?.[1]?.toLowerCase() ?? null;
    const status = block.match(/^\s*status:\s*([245]\.\d{1,3}\.\d{1,3})/im)?.[1] ?? null;
    const hard = action ? action === "failed" : status ? status.startsWith("5.") : true;
    out.push({ address, hard });
  }
  return out;
}

export function looksLikeBounce(subject: string | null, text: string): boolean {
  const s = (subject ?? "").toLowerCase();
  if (BOUNCE_SUBJECT_HINTS.some((hint) => s.includes(hint))) return true;
  const body = text.toLowerCase();
  return BOUNCE_BODY_HINTS.some((hint) => body.includes(hint));
}

/**
 * Reads a non-delivery report.
 *
 * `ownAddresses` are the mailbox's own From/Reply-To/sender-identity
 * addresses: an NDR always quotes the original sender, and suppressing the
 * customer's own address would stop them mailing themselves.
 */
export function parseBounce(
  message: BounceCandidate,
  ownAddresses: readonly string[] = [],
): BounceVerdict {
  const hasDsn = Boolean(message.deliveryStatus && message.deliveryStatus.trim());
  // Body wording alone ("does not exist") is only trusted from a machine
  // sender: a person can write those words in a genuine reply.
  const subjectHint = BOUNCE_SUBJECT_HINTS.some((hint) =>
    (message.subject ?? "").toLowerCase().includes(hint),
  );
  const fromMachine = Boolean(message.from && isMachineAddress(message.from));
  const isBounce =
    hasDsn ||
    Boolean(message.failedRecipientsHeader) ||
    subjectHint ||
    (fromMachine && looksLikeBounce(message.subject, message.text));

  if (!isBounce) return { isBounce: false, hard: false, recipient: null };

  const excluded = new Set(
    [message.from, ...ownAddresses]
      .filter((a): a is string => Boolean(a))
      .map((a) => a.trim().toLowerCase()),
  );
  const acceptable = (address: string | null): address is string =>
    Boolean(address) && !excluded.has(address!) && !isMachineAddress(address!);

  // 1. The DSN part: authoritative, and carries its own status.
  if (hasDsn) {
    const entries = dsnRecipients(message.deliveryStatus!).filter((e) => acceptable(e.address));
    const failed = entries.filter((e) => e.hard);
    if (failed.length === 1) return { isBounce: true, hard: true, recipient: failed[0].address };
    if (failed.length === 0 && entries.length > 0) {
      // Every named recipient is only delayed: a soft bounce.
      return { isBounce: true, hard: false, recipient: entries[0].address };
    }
    if (failed.length > 1) {
      // Several failed recipients in one report: we sent one recipient per
      // message, so this is not ours to guess at.
      return { isBounce: true, hard: true, recipient: null };
    }
  }

  const soft = SOFT_HINTS.some((hint) =>
    `${message.subject ?? ""} ${message.text}`.toLowerCase().includes(hint),
  );

  // 2. X-Failed-Recipients header.
  if (message.failedRecipientsHeader) {
    const listed = message.failedRecipientsHeader
      .split(/[,\s]+/)
      .map(strictAddress)
      .filter(acceptable);
    if (listed.length === 1) return { isBounce: true, hard: !soft, recipient: listed[0] };
  }

  // 3. Labelled lines in the human-readable text.
  const labelled = Array.from(
    message.text.matchAll(
      /(?:failed recipient|original-recipient|final-recipient|your message to|delivery to the following recipient[s]? failed[^\n]*\n)\s*[:;]?\s*(?:rfc822;\s*)?<?([\w.+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)>?/gi,
    ),
  )
    .map((m) => m[1].toLowerCase())
    .filter(acceptable);
  const labelledUnique = Array.from(new Set(labelled));
  if (labelledUnique.length === 1) {
    return { isBounce: true, hard: !soft, recipient: labelledUnique[0] };
  }

  // 4. Last resort: exactly one non-machine, non-own address anywhere in the
  //    text. Two or more is ambiguous (quoted headers name several) and
  //    suppresses nothing.
  const anywhere = addressesIn(message.text).filter(acceptable);
  if (labelledUnique.length === 0 && anywhere.length === 1) {
    return { isBounce: true, hard: !soft, recipient: anywhere[0] };
  }

  return { isBounce: true, hard: !soft, recipient: null };
}

/* ------------------------------------------------------ send outcome --- */

export type SendFailureLike = {
  errorCode: string;
  errorMessage: string;
  permanent: boolean;
  scope?: FailureScope;
};

export type SendOutcomeActions = {
  /** Put the recipient on the suppression list as a hard bounce. */
  suppressRecipient: boolean;
  /** What to write to the mailbox's health, or "skip" to leave it alone. */
  health:
    | "skip"
    | { ok: true }
    | { ok: false; code: string; message: string; permanent: boolean };
};

/**
 * What one send result means for the mailbox and for the recipient.
 *
 * A recipient-level refusal proves the mailbox works (we connected,
 * authenticated and reached RCPT), so it never touches mailbox health.
 */
export function sendOutcomeActions(
  result: { ok: true } | ({ ok: false } & SendFailureLike),
): SendOutcomeActions {
  if (result.ok) return { suppressRecipient: false, health: { ok: true } };
  if (result.scope === "recipient") {
    return {
      suppressRecipient: result.errorCode === "recipient_rejected",
      health: "skip",
    };
  }
  // Refusals decided before any connection (no mailbox, no subject, a
  // malformed address) say nothing new about the mailbox's health.
  if (
    result.errorCode === "invalid_recipient" ||
    result.errorCode === "missing_subject"
  ) {
    return { suppressRecipient: false, health: "skip" };
  }
  return {
    suppressRecipient: false,
    health: {
      ok: false,
      code: result.errorCode,
      message: result.errorMessage,
      permanent: result.permanent,
    },
  };
}
