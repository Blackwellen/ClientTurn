import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string[]> = {
  // No SVG: an SVG is a document that can carry script. It is inert inside
  // an <img>, but a signed URL opened directly would run that script on the
  // storage origin (gap audit 15 §3). Raster formats only.
  logo: ["image/png", "image/jpeg", "image/webp"],
  import: ["text/csv", "application/vnd.ms-excel"],
  // Support attachments (V4 §23.7). Screenshots, exports and log excerpts —
  // the things people actually attach to a ticket. No archives and no
  // executables: an unopenable attachment is an inconvenience, an executable
  // one is a liability.
  support: [
    "image/png",
    "image/jpeg",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.ms-excel",
    "text/x-log",
  ],
  // Quote PDFs (P2), written by the `quote.render_pdf` job and served only
  // through short-lived signed URLs. Never uploaded from a browser.
  quote_pdf: ["application/pdf"],
  // Call recordings (voice P2), copied from the provider by the
  // `voice.recording_fetch` job and served only through short-lived signed
  // URLs to a workspace member. Never uploaded from a browser.
  voice_recording: ["audio/mpeg", "audio/wav"],
};

/** A seven-minute call recorded as WAV runs past the 10MB default. */
const MAX_BYTES_BY_KIND: Record<string, number> = { voice_recording: 60 * 1024 * 1024 };

export type UploadKind = keyof typeof ALLOWED_TYPES;

let client: S3Client | null = null;

function r2() {
  if (!serverEnv.r2.endpoint || !serverEnv.r2.accessKeyId) {
    throw new Error("R2 is not configured");
  }
  client ??= new S3Client({
    region: "auto",
    endpoint: serverEnv.r2.endpoint,
    credentials: {
      accessKeyId: serverEnv.r2.accessKeyId,
      secretAccessKey: serverEnv.r2.secretAccessKey!,
    },
  });
  return client;
}

/** Keys are namespaced by tenant so one workspace can never guess another's. */
export function objectKey(
  businessId: string,
  kind: UploadKind,
  filename: string,
) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${kind}/${businessId}/${crypto.randomUUID()}-${safe}`;
}

export function assertUploadAllowed(
  kind: UploadKind,
  contentType: string,
  size: number,
) {
  if (!ALLOWED_TYPES[kind].includes(contentType)) {
    throw new Error(`File type ${contentType} is not allowed`);
  }
  const max = MAX_BYTES_BY_KIND[kind] ?? MAX_UPLOAD_BYTES;
  if (size > max) {
    throw new Error(`File exceeds the ${Math.round(max / (1024 * 1024))}MB limit`);
  }
}

/**
 * Short-lived PUT URL. The bucket is never public.
 *
 * When `contentLength` is given it is signed into the URL, so the browser can
 * only upload a body of exactly the size that passed `assertUploadAllowed`.
 * Without it the size check was advisory: a caller could declare 1KB and PUT
 * gigabytes (internal security review 2026-09-28, IR-02).
 */
export async function createUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
  contentLength?: number,
) {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: serverEnv.r2.bucket,
      Key: key,
      ContentType: contentType,
      ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
    }),
    { expiresIn },
  );
}

export async function createDownloadUrl(key: string, expiresIn = 300) {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: serverEnv.r2.bucket,
      Key: key,
      // Logos uploaded before SVG was refused: still render in an <img>, but
      // a direct open downloads instead of executing (audit 15 §3).
      ...(isSvgKey(key) ? { ResponseContentDisposition: "attachment" } : {}),
    }),
    { expiresIn },
  );
}

/** True for an object stored with an .svg name. */
export function isSvgKey(key: string): boolean {
  return /\.svg$/i.test(key);
}

export async function getObjectText(key: string) {
  const result = await r2().send(
    new GetObjectCommand({ Bucket: serverEnv.r2.bucket, Key: key }),
  );
  return result.Body!.transformToString();
}

export async function deleteObject(key: string) {
  await r2().send(
    new DeleteObjectCommand({ Bucket: serverEnv.r2.bucket, Key: key }),
  );
}

/**
 * The object key of a quote revision's PDF. Fixed by revision (0153 CHECK
 * `quotes/<business>/<revision>.pdf`), so re-rendering overwrites the same
 * deterministic bytes rather than piling up copies.
 */
export function quotePdfKey(businessId: string, revisionId: string) {
  return `quotes/${businessId}/${revisionId}.pdf`;
}

/**
 * The object key of a call recording (0150 CHECK
 * `voice/recordings/<business>/<call>/<file>`).
 */
export function voiceRecordingKey(businessId: string, callId: string, contentType: string) {
  return `voice/recordings/${businessId}/${callId}/recording.${contentType === "audio/wav" ? "wav" : "mp3"}`;
}

/** Server-side write (a job's output, never a browser upload). */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
) {
  const kind = key.split("/")[0] === "quotes" ? "quote_pdf" : key.startsWith("voice/recordings/") ? "voice_recording" : null;
  if (kind) assertUploadAllowed(kind, contentType, body.byteLength);
  await r2().send(
    new PutObjectCommand({
      Bucket: serverEnv.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Up to `max` object keys under a tenant prefix (`logo/<business>/` etc.),
 * for the day-90 workspace deletion (billing/workspace-deletion.ts). The
 * prefix must name one workspace, so this can never list the whole bucket.
 */
export async function listObjectKeys(prefix: string, max = 1000): Promise<string[]> {
  if (!/^(logo|import|support|quotes)\/[0-9a-f-]{36}\/$/.test(prefix)) {
    throw new Error("Refusing to list outside one workspace's prefix.");
  }
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: serverEnv.r2.bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: Math.min(1000, max - keys.length),
      }),
    );
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && keys.length < max);
  return keys;
}
