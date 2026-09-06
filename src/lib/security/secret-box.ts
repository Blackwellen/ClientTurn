import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Authenticated encryption for credentials this product stores on a
 * customer's behalf — currently the SMTP and IMAP/POP passwords for a
 * workspace's own mailbox.
 *
 * These are not our secrets to lose: a mail password often unlocks the
 * customer's whole mailbox, so it is encrypted before it reaches Postgres and
 * only ever decrypted inside a job or server action that is about to open a
 * connection. AES-256-GCM binds the ciphertext to its authentication tag, so
 * a tampered row fails to open rather than decrypting to something unintended.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "v1";

export class SecretKeyMissingError extends Error {
  readonly code = "secret_key_missing";
  constructor() {
    super(
      "CREDENTIAL_ENCRYPTION_KEY is not set, so mailbox credentials cannot be stored. " +
        "Generate one with: openssl rand -base64 32",
    );
    this.name = "SecretKeyMissingError";
  }
}

/**
 * The key is derived by SHA-256 over the configured value, so any sufficiently
 * random string works and the key material is always exactly 32 bytes.
 */
function key(): Buffer {
  const configured = serverEnv.credentialEncryptionKey;
  if (!configured || configured.length < 16) throw new SecretKeyMissingError();
  return createHash("sha256").update(configured, "utf8").digest();
}

/** True when the deployment is able to store mailbox credentials at all. */
export function canStoreSecrets(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/** Returns null for anything that is not a well-formed, authentic sealed value. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const payload = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A wrong key, a truncated row or a tampered tag all land here. Callers
    // treat null as "these credentials need re-entering", never as "empty".
    return null;
  }
}

/**
 * A stable, non-reversible fingerprint so the UI can show that a password is
 * stored, and detect that it changed, without ever reading it back.
 */
export function secretFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 12);
}

/** Constant-time compare for tokens that arrive from a URL. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
