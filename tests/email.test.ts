import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addressFromHeader,
  describeMailError,
  emailAccountSchema,
  formatAddress,
  limitsForHost,
  normaliseEmail,
  toConfig,
  toFormValues,
  DEFAULT_MAILBOX_LIMITS,
  MAILBOX_PRESETS,
  type EmailAccountConfig,
} from "../src/lib/email/account.ts";

/* ------------------------------------------------------------ addresses --- */

describe("address normalisation", () => {
  test("lowercases and trims", () => {
    assert.equal(normaliseEmail("  Jamie.Bell@Example.CO.UK "), "jamie.bell@example.co.uk");
  });

  test("rejects an address with no domain dot", () => {
    assert.equal(normaliseEmail("jamie@localhost"), null);
  });

  test("rejects obviously malformed input", () => {
    for (const bad of ["", "   ", "jamie", "@example.com", "jamie@", "a b@c.com", "jamie@ex..com"]) {
      assert.equal(normaliseEmail(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  test("rejects an address that would smuggle a second recipient", () => {
    assert.equal(normaliseEmail("jamie@example.com, evil@attacker.com"), null);
    assert.equal(normaliseEmail("jamie@example.com;evil@attacker.com"), null);
  });

  test("rejects an over-long address", () => {
    assert.equal(normaliseEmail(`${"a".repeat(250)}@example.com`), null);
  });

  test("accepts a plus-addressed inbox", () => {
    assert.equal(
      normaliseEmail("jamie+roofing@example.com"),
      "jamie+roofing@example.com",
    );
  });
});

describe("From header formatting", () => {
  test("quotes the display name", () => {
    assert.equal(
      formatAddress("Blackwellen Roofing", "hello@example.com"),
      '"Blackwellen Roofing" <hello@example.com>',
    );
  });

  test("a header injection attempt cannot break out of the name", () => {
    const header = formatAddress(
      'Evil"\r\nBcc: victim@example.com',
      "hello@example.com",
    );
    assert.ok(!header.includes("\r"));
    assert.ok(!header.includes("\n"));
    assert.ok(!header.includes("Bcc: victim@example.com\r"));
    // The CR/LF and the quote are stripped, so what remains is inert text
    // inside a quoted display name rather than a second header.
    assert.equal(header, '"EvilBcc: victim@example.com" <hello@example.com>');
  });

  test("an empty name yields a bare address", () => {
    assert.equal(formatAddress("   ", "hello@example.com"), "hello@example.com");
  });
});

describe("inbound From parsing", () => {
  test("extracts the address from a display-name header", () => {
    assert.equal(
      addressFromHeader('"Jamie Bell" <Jamie@Example.com>'),
      "jamie@example.com",
    );
  });

  test("accepts a bare address", () => {
    assert.equal(addressFromHeader("jamie@example.com"), "jamie@example.com");
  });

  test("returns null rather than guessing at a broken header", () => {
    assert.equal(addressFromHeader("undisclosed-recipients:;"), null);
    assert.equal(addressFromHeader(null), null);
  });
});

/* --------------------------------------------------------------- schema --- */

const valid = {
  fromName: "Blackwellen Roofing",
  fromEmail: "hello@example.co.uk",
  smtpHost: "smtp.example.co.uk",
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: "hello@example.co.uk",
  smtpPassword: "app-password",
  inboundProtocol: "imap" as const,
  inboundHost: "imap.example.co.uk",
  inboundPort: 993,
  inboundSecure: true,
  inboundMailbox: "INBOX",
};

describe("account schema", () => {
  test("accepts a complete configuration", () => {
    assert.equal(emailAccountSchema.safeParse(valid).success, true);
  });

  test("a password may be omitted so an edit can keep the stored one", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.smtpPassword;
    assert.equal(emailAccountSchema.safeParse(rest).success, true);
  });

  test("rejects a malformed from address", () => {
    const parsed = emailAccountSchema.safeParse({ ...valid, fromEmail: "not-an-address" });
    assert.equal(parsed.success, false);
  });

  test("reading replies requires an incoming host", () => {
    const parsed = emailAccountSchema.safeParse({ ...valid, inboundHost: "" });
    assert.equal(parsed.success, false);
    assert.ok(
      parsed.error?.issues.some((issue) => issue.path.includes("inboundHost")),
    );
  });

  test("reading replies requires an incoming port", () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.inboundPort;
    assert.equal(emailAccountSchema.safeParse(rest).success, false);
  });

  test("choosing not to read replies drops the incoming requirements", () => {
    const parsed = emailAccountSchema.safeParse({
      ...valid,
      inboundProtocol: "none",
      inboundHost: "",
      inboundPort: undefined,
    });
    assert.equal(parsed.success, true);
  });

  test("rejects a port outside the legal range", () => {
    assert.equal(emailAccountSchema.safeParse({ ...valid, smtpPort: 0 }).success, false);
    assert.equal(emailAccountSchema.safeParse({ ...valid, smtpPort: 70000 }).success, false);
  });

  test("an empty reply-to is allowed and means 'use the from address'", () => {
    assert.equal(emailAccountSchema.safeParse({ ...valid, replyTo: "" }).success, true);
  });
});

/* --------------------------------------------------------------- config --- */

function config(overrides: Partial<EmailAccountConfig> = {}): EmailAccountConfig {
  return {
    fromName: "Blackwellen Roofing",
    fromEmail: "hello@example.co.uk",
    replyTo: null,
    smtp: { host: "smtp.example.co.uk", port: 587, secure: false, username: "hello@example.co.uk" },
    inbound: {
      protocol: "imap",
      host: "imap.example.co.uk",
      port: 993,
      secure: true,
      username: "hello@example.co.uk",
      mailbox: "INBOX",
    },
    cursor: { uidValidity: "42", lastUid: 900, lastSeenAt: "2026-09-01T00:00:00.000Z" },
    ...overrides,
  };
}

describe("stored configuration", () => {
  test("addresses are stored lowercased", () => {
    const result = toConfig(
      emailAccountSchema.parse({ ...valid, fromEmail: "Hello@Example.CO.UK" }),
    );
    assert.equal(result.fromEmail, "hello@example.co.uk");
  });

  test("the inbound username defaults to the outgoing one", () => {
    const result = toConfig(emailAccountSchema.parse(valid));
    assert.equal(result.inbound.username, "hello@example.co.uk");
  });

  test("turning replies off clears the incoming host and port", () => {
    const result = toConfig(
      emailAccountSchema.parse({ ...valid, inboundProtocol: "none" }),
      config(),
    );
    assert.equal(result.inbound.host, null);
    assert.equal(result.inbound.port, null);
  });

  test("an unchanged mailbox keeps the poller's position", () => {
    const result = toConfig(emailAccountSchema.parse(valid), config());
    assert.equal(result.cursor.lastUid, 900);
  });

  test("pointing at a different mailbox resets the position", () => {
    const result = toConfig(
      emailAccountSchema.parse({ ...valid, inboundHost: "imap.other.co.uk" }),
      config(),
    );
    assert.equal(result.cursor.lastUid, 0);
    assert.equal(result.cursor.uidValidity, null);
  });

  test("switching protocol resets the position", () => {
    const result = toConfig(
      emailAccountSchema.parse({
        ...valid,
        inboundProtocol: "pop3",
        inboundPort: 995,
      }),
      config(),
    );
    assert.equal(result.cursor.lastUid, 0);
  });

  test("a config round-trips through the form without a password", () => {
    const values = toFormValues(config());
    assert.ok(!("smtpPassword" in values));
    assert.ok(!("inboundPassword" in values));
    assert.equal(emailAccountSchema.safeParse(values).success, true);
  });
});

/* -------------------------------------------------------------- presets --- */

describe("mailbox presets", () => {
  test("every preset carries all three server profiles", () => {
    for (const preset of MAILBOX_PRESETS) {
      assert.ok(preset.smtp, `${preset.id} has no smtp`);
      assert.ok(preset.imap, `${preset.id} has no imap`);
      assert.ok(preset.pop3, `${preset.id} has no pop3`);
    }
  });

  test("a real preset produces a configuration the schema accepts", () => {
    const google = MAILBOX_PRESETS.find((entry) => entry.id === "google")!;
    const parsed = emailAccountSchema.safeParse({
      ...valid,
      smtpHost: google.smtp.host,
      smtpPort: google.smtp.port,
      smtpSecure: google.smtp.secure,
      inboundHost: google.imap.host,
      inboundPort: google.imap.port,
      inboundSecure: google.imap.secure,
    });
    assert.equal(parsed.success, true);
  });

  test("the custom preset leaves the hosts blank to be typed", () => {
    const custom = MAILBOX_PRESETS.find((entry) => entry.id === "custom")!;
    assert.equal(custom.smtp.host, "");
  });
});

/* --------------------------------------------------------------- limits --- */

describe("send pacing", () => {
  test("a known host uses its own cap", () => {
    assert.equal(limitsForHost("smtp.gmail.com").perDay, 450);
    assert.equal(limitsForHost("SMTP.GMAIL.COM").perDay, 450);
  });

  test("an unknown host falls back to the conservative default", () => {
    assert.deepEqual(limitsForHost("smtp.some-host.co.uk"), DEFAULT_MAILBOX_LIMITS);
  });

  test("every cap is low enough not to trip a normal mailbox", () => {
    assert.ok(DEFAULT_MAILBOX_LIMITS.perMinute <= 30);
    assert.ok(limitsForHost("smtp.gmail.com").perMinute <= 30);
  });
});

/* --------------------------------------------------------------- errors --- */

describe("mail error classification", () => {
  test("a rejected password is permanent and mentions app passwords", () => {
    const result = describeMailError(
      Object.assign(new Error("Invalid login: 535 Authentication failed"), {
        code: "EAUTH",
      }),
    );
    assert.equal(result.permanent, true);
    assert.equal(result.code, "auth_failed");
    assert.match(result.message, /app password/i);
  });

  test("an unknown hostname is permanent", () => {
    const result = describeMailError(
      Object.assign(new Error("getaddrinfo ENOTFOUND smtp.typo.co.uk"), {
        code: "ENOTFOUND",
      }),
    );
    assert.equal(result.permanent, true);
    assert.equal(result.code, "host_not_found");
  });

  test("a refused connection points at the port and TLS", () => {
    const result = describeMailError(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    assert.equal(result.code, "connection_refused");
    assert.match(result.message, /port/i);
  });

  test("an unrecognised failure is not treated as permanent", () => {
    const result = describeMailError(new Error("something transient happened"));
    assert.equal(result.permanent, false);
  });

  test("a non-Error value does not throw", () => {
    assert.doesNotThrow(() => describeMailError("plain string"));
    assert.doesNotThrow(() => describeMailError(null));
  });

  test("the message never leaks the raw server transcript", () => {
    const result = describeMailError(
      Object.assign(new Error("535 auth failed for user hello@example.com pw=hunter2"), {
        code: "EAUTH",
      }),
    );
    assert.ok(!result.message.includes("hunter2"));
  });
});
