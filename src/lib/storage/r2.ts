import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string[]> = {
  logo: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
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
};

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
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 10MB limit");
  }
}

/** Short-lived PUT URL. The bucket is never public. */
export async function createUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 300,
) {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: serverEnv.r2.bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

export async function createDownloadUrl(key: string, expiresIn = 300) {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({ Bucket: serverEnv.r2.bucket, Key: key }),
    { expiresIn },
  );
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
