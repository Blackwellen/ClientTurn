import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { TLSSocket, createServer as createTlsServer } from "node:tls";
import * as tlsModule from "node:tls";

// @types/node has not yet caught up with these two Node 22+ runtime APIs
// (they exist at runtime — see the availability check in the codebase audit
// this fixture supports — but are missing from the shipped .d.ts).
const { getCACertificates, setDefaultCACertificates } = tlsModule as unknown as {
  getCACertificates(scope?: "default" | "system" | "extra"): string[];
  setDefaultCACertificates(certs: string[]): void;
};
import { fetchPop3Messages, verifyPop3 } from "../src/lib/email/pop3.ts";

/**
 * A real socket, real TLS conversation against a minimal RFC 1939 (+ RFC 2595
 * STLS) server on localhost — this exercises the actual framing,
 * dot-unstuffing, command sequencing and STLS upgrade `pop3.ts` uses to read
 * a customer's mailbox, without touching any real mail provider.
 */

const CRLF = "\r\n";

// A throwaway self-signed certificate for 127.0.0.1/localhost, generated
// once for this test fixture only. Trusted below via
// `setDefaultCACertificates`, exactly as a real CA would be trusted by the
// OS — so the TLS assertions below are a genuine certificate-validated
// handshake, not a `rejectUnauthorized: false` shortcut that would leave the
// downgrade-protection fix unverified.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUHNWryKs5W7nofaS7DA8DKP9Q7k8wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkxNDE1NTYyMFoXDTM2MDkx
MTE1NTYyMFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAsK5mFECuMGgR50rXAeLaCUcNRMz4ZZlFC+5J+hnOUNM1
mzk9cDFttwOGJkJeUBOUAQYsUtJTd9rVP5p/xgv6Tb2QeYIlhNkaoYLdu33amdCK
nS9VGVONzkw1LJq+bwsUrM4TWMuM/48JHyQ5sBLZ6EPYNZb5HNM8ppYGxnd0jucv
8j1Cj4NXqbwh4QKVgtDElz3dSk5kg3A1xYBd7PvBiG7sFQH01St7oYddSHluzlu/
1QDqJsBGizh3xwXx24nr4GNcyN6+S4BzbbRlKtrtGcPyDW79RgKWofAI6YONl9gJ
S2cZpeXiMllU7oUFF/1pW6Or/dH5ogfuguH5HO2SbQIDAQABo28wbTAdBgNVHQ4E
FgQUIbLgYl5hPuORnVP3A2cya3lo+fwwHwYDVR0jBBgwFoAUIbLgYl5hPuORnVP3
A2cya3lo+fwwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh
bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAFntBua2bTsGyQJwfEOmYIpn31jPAIEk
BF8e281SQ1I9Ucv8IQDKjwq2sZ2H7f1/8Vu0GSFAViocB7XdQN+k01ccvDsgWi9N
1K7doGHvMPNBccX9dIMCAEEdFoYQxCrjTQjQSakriddVwnRlndwI22X1swLp+4Oi
NYCir1V5WVakaI9ZA9c4mrV+TLKDOMvRqwWdGjXbdWdkKSN98zLVfwXpXsKFIAu3
sMlUD8C8e9nTFVbsAGAefGT4Gjrx1HMkJQVlilVa+qhuEgTVB1qlFtZ3+BV2FcRC
nxqmFem1y56v9SOoCxE1xIuEJyT3eRcQgAKDq7s12w8R0OljOxzlU3o=
-----END CERTIFICATE-----
`;

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwrmYUQK4waBHn
StcB4toJRw1EzPhlmUUL7kn6Gc5Q0zWbOT1wMW23A4YmQl5QE5QBBixS0lN32tU/
mn/GC/pNvZB5giWE2Rqhgt27fdqZ0IqdL1UZU43OTDUsmr5vCxSszhNYy4z/jwkf
JDmwEtnoQ9g1lvkc0zymlgbGd3SO5y/yPUKPg1epvCHhApWC0MSXPd1KTmSDcDXF
gF3s+8GIbuwVAfTVK3uhh11IeW7OW7/VAOomwEaLOHfHBfHbievgY1zI3r5LgHNt
tGUq2u0Zw/INbv1GApah8Ajpg42X2AlLZxml5eIyWVTuhQUX/Wlbo6v90fmiB+6C
4fkc7ZJtAgMBAAECggEAD4bsGqiKhl+G/0Qg/B3zGnCflmXLCKa9HizNXIjrDEhb
hC42G4eEhFpvbipT/oaR8bsYpxir1DMrnYDW7NE9qJpZuYv5/yBTSlFlaiZH0U+1
9tVjjau9oR0qaSaaSMj5AqzDn4CX/heUbiOxXCtz8gkQVblUYDeiM2Oo6cUyvaIn
OsKNxUIcVz1dFCZixtM2T+zmCyZocfKo03aI5TEeHaQY8fra+mTocVVJe+1lGw41
yVd47AHxGKe9e9p6ghPg6N9JVLu26Ea/NV2BbZcF9Mjb/JJm2dfDO1/f1CYbtaeS
4p07C9M4eAlwQF/lmiFhdNGerGyaPSaQ0/5/KzkCIwKBgQDbfmf+hZW0G9Z88G1n
2iDcjtT92pYMFhMZgMrpi/0IZDWIp2eg2sjtOgGf5A9EpXsLU8goiYHsyScbtAJy
AMY+O3frhansXTneFOmV5nsllkR82VH3gsyEoHAe60OxQbbcMjtmBzk0e/hlDGEz
vdvbSoY3AMJYrhJjSd6yVhA8twKBgQDOER9+Ot8C0Esxy7yVxQuvnzDvnQmMWWba
ymStFbijBFhjIsLBcXHgPsZ8pM2u1w5+bl025Fg8tPDLi+R7DTfd4bdcuf4NsSFW
HTjUEDGphQRvYkckBV4SC1Fpffl1+4gHG+B87HgsC5cVoNa5JhU3eQJ0ebQ8Wu6t
cfsoTDlN+wKBgQCxNe1gYRnswEz7smGiZ0oAyJDOI5zhRTFGdeVdidhQ3hcarY3N
INb4MMz++nIZSkF9c7c2g06SjhU1GLCgul9T/09iqBf47Yu68cdlbyAdyKSi6BJ1
cvUMXzwmumt8wUGRpjyus0ZMSYrSipwv2imXcyPJZKOEVYYjA5D5CuMxIQKBgQCM
4socXJWyb8SpU/kokKLPvNARUtV/XnRi6/NvHyWwVr0zckWjSjOoNGMyPt7dRe2D
5WLXr8DgKHllQMzCkKP8kGD0Bbm7lLoNDUeYPUYm92mz2YZ4Cy9ouNI9hMJ0trcm
3Rlbb7Utr/Lo96E2zuG8noBeMANZLHZ4oTAtOggH1wKBgFcnlC2MQKy//6TcvHoP
pjDnZvr9EdSD6HSRGKtPVkioGfTt9usWAs7kbPMBN+DysxBP+wVKLE/p0ZKlb2XU
agQxPTCQqhXo2eZqzeAuFuAJg+ouaiNzvPz5o1NJvXIqbN3Ikn1HumMcp25bzyUU
dBWORNdGWbOfQ7Rc9FfWpSS2
-----END PRIVATE KEY-----
`;

let originalCAs: string[] = [];
before(() => {
  originalCAs = getCACertificates("default");
  setDefaultCACertificates([...originalCAs, TEST_CERT]);
});
after(() => {
  setDefaultCACertificates(originalCAs);
});

type Mailbox = {
  username: string;
  password: string;
  /** newest-last, as POP3 UIDL returns them */
  messages: { uid: string; raw: string }[];
};

type ServerOptions = {
  /** RFC 2595: whether the server offers an encrypted upgrade on a plain connection. */
  supportsStls?: boolean;
};

/** True once the wire has stopped looking like POP3 text and started looking like a TLS record. */
function looksLikeTlsHandshake(chunk: Buffer): boolean {
  // TLS record header: ContentType(0x16=Handshake) + ProtocolVersion(2 bytes).
  return chunk.length > 0 && chunk[0] === 0x16;
}

function startPop3Server(
  mailbox: Mailbox,
  options: ServerOptions = {},
): Promise<{ server: Server; port: number; sawPlaintextCredentials: boolean[] }> {
  const supportsStls = options.supportsStls ?? true;
  const sawPlaintextCredentials: boolean[] = [];

  return new Promise((resolve) => {
    const server = createServer((rawSocket: Socket) => {
      let buffer = "";
      let authedUser: string | null = null;
      let active: Socket | TLSSocket = rawSocket;

      // Sniffs bytes actually arriving on the *raw* socket, before any TLS
      // upgrade. Deliberately not attached inside `attach()`: once STLS has
      // wrapped the connection, the TLSSocket's own "data" event delivers
      // already-decrypted plaintext to the protocol handler below (correct
      // and expected), which is a different thing entirely from a credential
      // crossing the physical wire unencrypted (what this exists to catch).
      // Removed by `removeAllListeners("data")` at the moment of upgrade —
      // exactly when it stops being meaningful, since nothing on the raw
      // socket after that point is anything but an opaque TLS record.
      rawSocket.on("data", (chunk: Buffer) => {
        if (looksLikeTlsHandshake(chunk)) return;
        const text = chunk.toString("utf8");
        if (/^(USER|PASS)\s/i.test(text)) {
          sawPlaintextCredentials.push(true);
        }
      });

      function attach(socket: Socket | TLSSocket, { greet }: { greet: boolean }) {
        active = socket;
        buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("latin1");
          let idx: number;
          while ((idx = buffer.indexOf(CRLF)) !== -1) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handleLine(line);
          }
        });
        if (greet) socket.write(`+OK POP3 test server ready${CRLF}`);
      }

      function handleLine(line: string) {
        const [command, ...rest] = line.split(" ");
        const arg = rest.join(" ");

        switch (command.toUpperCase()) {
          case "STLS": {
            if (!supportsStls) {
              active.write(`-ERR STLS not supported${CRLF}`);
              return;
            }
            active.write(`+OK Begin TLS negotiation${CRLF}`);
            const plain = active as Socket;
            plain.removeAllListeners("data");
            const tlsSocket = new TLSSocket(plain, {
              isServer: true,
              cert: TEST_CERT,
              key: TEST_KEY,
            });
            attach(tlsSocket, { greet: false });
            return;
          }
          case "USER":
            authedUser = arg;
            active.write(`+OK${CRLF}`);
            return;
          case "PASS":
            if (authedUser === mailbox.username && arg === mailbox.password) {
              active.write(`+OK Logged in${CRLF}`);
            } else {
              active.write(`-ERR invalid credentials${CRLF}`);
            }
            return;
          case "STAT":
            active.write(`+OK ${mailbox.messages.length} 0${CRLF}`);
            return;
          case "UIDL": {
            const lines = mailbox.messages
              .map((message, index) => `${index + 1} ${message.uid}`)
              .join(CRLF);
            active.write(`+OK${CRLF}${lines}${CRLF}.${CRLF}`);
            return;
          }
          case "TOP": {
            const [indexStr] = rest;
            const index = Number(indexStr) - 1;
            const message = mailbox.messages[index];
            if (!message) {
              active.write(`-ERR no such message${CRLF}`);
              return;
            }
            // Dot-stuff any line that starts with "." so the client's
            // un-stuffing is genuinely exercised, not just trusted.
            const stuffed = message.raw
              .split("\n")
              .map((l) => (l.startsWith(".") ? `.${l}` : l))
              .join(CRLF);
            active.write(`+OK${CRLF}${stuffed}${CRLF}.${CRLF}`);
            return;
          }
          case "QUIT":
            active.write(`+OK bye${CRLF}`);
            active.end();
            return;
          default:
            active.write(`-ERR unknown command${CRLF}`);
        }
      }

      attach(rawSocket, { greet: true });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, sawPlaintextCredentials });
    });
  });
}

/** For the direct-TLS ("secure: true") path: the server never speaks plaintext at all. */
function startImplicitTlsPop3Server(mailbox: Mailbox): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    // Reuse the same line protocol by wrapping a plain net server's handler
    // isn't possible for implicit TLS (the handshake is the first thing on
    // the wire), so this one is a small dedicated `tls.createServer`.
    const server = createTlsServer({ cert: TEST_CERT, key: TEST_KEY }, (socket) => {
      let buffer = "";
      let authedUser: string | null = null;

      socket.write(`+OK POP3 test server ready${CRLF}`);
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        let idx: number;
        while ((idx = buffer.indexOf(CRLF)) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const [command, ...rest] = line.split(" ");
          const arg = rest.join(" ");
          switch (command.toUpperCase()) {
            case "USER":
              authedUser = arg;
              socket.write(`+OK${CRLF}`);
              break;
            case "PASS":
              socket.write(
                authedUser === mailbox.username && arg === mailbox.password
                  ? `+OK Logged in${CRLF}`
                  : `-ERR invalid credentials${CRLF}`,
              );
              break;
            case "STAT":
              socket.write(`+OK ${mailbox.messages.length} 0${CRLF}`);
              break;
            case "QUIT":
              socket.write(`+OK bye${CRLF}`);
              socket.end();
              break;
            default:
              socket.write(`-ERR unknown command${CRLF}`);
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

const activeServers: Server[] = [];
after(() => {
  for (const server of activeServers) server.close();
});

describe("POP3 client against a real socket server", () => {
  test("authenticates, lists and retrieves only unseen messages, over an STLS-upgraded channel", async () => {
    const { server, port, sawPlaintextCredentials } = await startPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: [
        { uid: "uid-1", raw: "Subject: first\n\nAlready read." },
        { uid: "uid-2", raw: "Subject: second\n\nA reply the poller has not seen yet." },
        { uid: "uid-3", raw: "Subject: third\nX-Note: line starting with a dot below\n\n.this line was dot-stuffed on the wire" },
      ],
    });
    activeServers.push(server);

    const { messages, lastUid } = await fetchPop3Messages(
      {
        host: "127.0.0.1",
        port,
        secure: false,
        username: "hello@example.com",
        password: "correct-horse",
      },
      "uid-1",
      25,
    );

    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((m) => m.uid), ["uid-2", "uid-3"]);
    assert.match(messages[0].raw, /A reply the poller has not seen yet\./);
    // The dot-stuffed line is un-stuffed back to a single leading dot.
    assert.match(messages[1].raw, /^\.this line was dot-stuffed on the wire$/m);
    assert.equal(lastUid, "uid-3");
    // The whole point of the fix: USER/PASS never crossed the wire unencrypted.
    assert.equal(sawPlaintextCredentials.length, 0);
  });

  test("a pruned cursor (the stored uid no longer exists) falls back to the newest `limit` only", async () => {
    const { server, port } = await startPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: [
        { uid: "uid-10", raw: "Subject: a" },
        { uid: "uid-11", raw: "Subject: b" },
        { uid: "uid-12", raw: "Subject: c" },
      ],
    });
    activeServers.push(server);

    const { messages } = await fetchPop3Messages(
      {
        host: "127.0.0.1",
        port,
        secure: false,
        username: "hello@example.com",
        password: "correct-horse",
      },
      "uid-that-was-deleted",
      2,
    );

    // Never floods the poller with the whole mailbox history — only the
    // newest `limit` are treated as new.
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((m) => m.uid), ["uid-11", "uid-12"]);
  });

  test("an empty `after` on first connection takes only the newest `limit`", async () => {
    const { server, port } = await startPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: Array.from({ length: 5 }, (_, i) => ({
        uid: `uid-${i}`,
        raw: `Subject: message ${i}`,
      })),
    });
    activeServers.push(server);

    const { messages, lastUid } = await fetchPop3Messages(
      { host: "127.0.0.1", port, secure: false, username: "hello@example.com", password: "correct-horse" },
      null,
      3,
    );

    assert.equal(messages.length, 3);
    assert.deepEqual(messages.map((m) => m.uid), ["uid-2", "uid-3", "uid-4"]);
    assert.equal(lastUid, "uid-4");
  });

  test("verifyPop3 succeeds over an STLS-upgraded channel against a real accepting server", async () => {
    const { server, port } = await startPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: [],
    });
    activeServers.push(server);

    await assert.doesNotReject(
      verifyPop3({
        host: "127.0.0.1",
        port,
        secure: false,
        username: "hello@example.com",
        password: "correct-horse",
      }),
    );
  });

  test("verifyPop3 rejects a wrong password rather than silently succeeding", async () => {
    const { server, port } = await startPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: [],
    });
    activeServers.push(server);

    await assert.rejects(
      verifyPop3({
        host: "127.0.0.1",
        port,
        secure: false,
        username: "hello@example.com",
        password: "wrong-password",
      }),
      /invalid credentials/i,
    );
  });

  test("direct TLS (secure: true) authenticates without any STLS negotiation", async () => {
    const { server, port } = await startImplicitTlsPop3Server({
      username: "hello@example.com",
      password: "correct-horse",
      messages: [],
    });
    activeServers.push(server);

    await assert.doesNotReject(
      verifyPop3({
        host: "127.0.0.1",
        port,
        secure: true,
        username: "hello@example.com",
        password: "correct-horse",
      }),
    );
  });

  test(
    "security regression: a server that does not offer STLS is refused, never sent the password in the clear",
    async () => {
      const { server, port, sawPlaintextCredentials } = await startPop3Server(
        {
          username: "hello@example.com",
          password: "correct-horse",
          messages: [],
        },
        { supportsStls: false },
      );
      activeServers.push(server);

      await assert.rejects(
        verifyPop3({
          host: "127.0.0.1",
          port,
          secure: false,
          username: "hello@example.com",
          password: "correct-horse",
        }),
        /does not support an encrypted upgrade/i,
      );

      // The refusal has to happen before USER/PASS, not after.
      assert.equal(sawPlaintextCredentials.length, 0);
    },
  );

  test(
    "security regression: fetchPop3Messages (the poller's own entry point) also refuses a non-upgradeable server",
    async () => {
      const { server, port, sawPlaintextCredentials } = await startPop3Server(
        {
          username: "hello@example.com",
          password: "correct-horse",
          messages: [{ uid: "uid-1", raw: "Subject: x" }],
        },
        { supportsStls: false },
      );
      activeServers.push(server);

      await assert.rejects(
        fetchPop3Messages(
          {
            host: "127.0.0.1",
            port,
            secure: false,
            username: "hello@example.com",
            password: "correct-horse",
          },
          null,
          25,
        ),
        /does not support an encrypted upgrade/i,
      );

      assert.equal(sawPlaintextCredentials.length, 0);
    },
  );
});
