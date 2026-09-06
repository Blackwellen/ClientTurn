import "server-only";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { createConnection, type Socket } from "node:net";

/**
 * A minimal POP3 client (RFC 1939), covering exactly what reading replies
 * needs: authenticate, list unique ids, retrieve a message, quit.
 *
 * Written rather than depended on because the useful surface is four commands
 * and the alternatives are unmaintained. Deliberately read-only: this client
 * has no DELE, so connecting ClientTurn to a mailbox can never remove a
 * customer's mail.
 */

const CRLF = "\r\n";
const TIMEOUT_MS = 20_000;
/** A reply is a few KB; anything vastly larger is an attachment we do not need. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

export type Pop3Options = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

class Pop3Error extends Error {
  readonly code: string;
  constructor(message: string, code = "pop3_error") {
    super(message);
    this.name = "Pop3Error";
    this.code = code;
  }
}

type Connection = {
  send(command: string, multiline?: boolean): Promise<string>;
  close(): void;
};

function openSocket(options: Pop3Options): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tlsConnect(
          {
            host: options.host,
            port: options.port,
            servername: options.host,
            minVersion: "TLSv1.2",
          },
          () => resolve(socket),
        )
      : createConnection({ host: options.host, port: options.port }, () =>
          resolve(socket),
        );

    socket.setTimeout(TIMEOUT_MS);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Pop3Error("The mail server did not respond.", "ETIMEDOUT"));
    });
  });
}

/**
 * POP3 framing: a single-line reply ends at the first CRLF; a multi-line reply
 * ends at a lone "." on its own line, with leading dots on content lines
 * un-stuffed by the caller.
 */
function createConnectionReader(socket: Socket | TLSSocket): Connection {
  let buffer = "";
  let pending:
    | {
        multiline: boolean;
        resolve: (value: string) => void;
        reject: (error: Error) => void;
      }
    | null = null;

  function settle() {
    if (!pending) return;

    if (!pending.multiline) {
      const end = buffer.indexOf(CRLF);
      if (end === -1) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const current = pending;
      pending = null;
      if (line.startsWith("-ERR")) {
        current.reject(new Pop3Error(line.slice(4).trim() || "Rejected."));
      } else {
        current.resolve(line);
      }
      return;
    }

    const headerEnd = buffer.indexOf(CRLF);
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd);

    if (header.startsWith("-ERR")) {
      buffer = buffer.slice(headerEnd + 2);
      const current = pending;
      pending = null;
      current.reject(new Pop3Error(header.slice(4).trim() || "Rejected."));
      return;
    }

    const terminator = buffer.indexOf(`${CRLF}.${CRLF}`, headerEnd);
    if (terminator === -1) {
      if (buffer.length > MAX_MESSAGE_BYTES) {
        const current = pending;
        pending = null;
        buffer = "";
        current.reject(new Pop3Error("That message is too large to read."));
      }
      return;
    }

    const body = buffer.slice(headerEnd + 2, terminator);
    buffer = buffer.slice(terminator + 5);
    const current = pending;
    pending = null;
    current.resolve(body.replace(/^\.\./gm, "."));
  }

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    settle();
  });

  const greeting = new Promise<void>((resolve, reject) => {
    pending = {
      multiline: false,
      resolve: () => resolve(),
      reject,
    };
  });

  return {
    async send(command: string, multiline = false) {
      await greeting;
      return new Promise<string>((resolve, reject) => {
        if (pending) {
          reject(new Pop3Error("A command is already in flight."));
          return;
        }
        pending = { multiline, resolve, reject };
        socket.write(command + CRLF);
        settle();
      });
    },
    close() {
      socket.destroy();
    },
  };
}

export type Pop3Message = { uid: string; index: number; raw: string };

/**
 * Lists unique ids newest-last, then retrieves only what the caller has not
 * seen. `after` is the last uid successfully processed; when it is no longer
 * in the mailbox (the customer deleted it) only the newest `limit` messages
 * are read, so a pruned mailbox cannot replay as a flood of "new" replies.
 */
export async function fetchPop3Messages(
  options: Pop3Options,
  after: string | null,
  limit = 25,
): Promise<{ messages: Pop3Message[]; lastUid: string | null }> {
  const socket = await openSocket(options);
  const connection = createConnectionReader(socket);

  try {
    await connection.send(`USER ${options.username}`);
    await connection.send(`PASS ${options.password}`);

    const listing = await connection.send("UIDL", true);
    const entries = listing
      .split(CRLF)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [index, uid] = line.split(/\s+/);
        return { index: Number(index), uid };
      })
      .filter((entry) => Number.isFinite(entry.index) && Boolean(entry.uid));

    const seenAt = after ? entries.findIndex((entry) => entry.uid === after) : -1;
    const candidates =
      after && seenAt >= 0
        ? entries.slice(seenAt + 1)
        : entries.slice(Math.max(0, entries.length - limit));

    const wanted = candidates.slice(0, limit);
    const messages: Pop3Message[] = [];

    for (const entry of wanted) {
      // TOP n 200 fetches headers plus the first 200 lines: enough for any
      // reply, without pulling a megabyte of quoted history and attachments.
      const raw = await connection.send(`TOP ${entry.index} 200`, true);
      messages.push({ uid: entry.uid, index: entry.index, raw });
    }

    return {
      messages,
      lastUid: wanted.at(-1)?.uid ?? after ?? entries.at(-1)?.uid ?? null,
    };
  } finally {
    try {
      await connection.send("QUIT");
    } catch {
      // The server may close first; the socket is destroyed either way.
    }
    connection.close();
  }
}

/** Authenticates and disconnects, for the "test connection" button. */
export async function verifyPop3(options: Pop3Options): Promise<void> {
  const socket = await openSocket(options);
  const connection = createConnectionReader(socket);
  try {
    await connection.send(`USER ${options.username}`);
    await connection.send(`PASS ${options.password}`);
    await connection.send("STAT");
  } finally {
    connection.close();
  }
}
