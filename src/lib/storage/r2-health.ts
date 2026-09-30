/**
 * Read-only storage readiness (Admin → System → Readiness).
 *
 * Logos, CSV imports, support attachments, quote PDFs and call recordings all
 * live in one Cloudflare R2 bucket. Until this probe existed nothing anywhere
 * checked that bucket was reachable, so a wrong bucket name or a key without
 * access showed up only as a failed upload in front of a customer.
 *
 * The probe is a single `HeadBucket`: it reads no object, writes nothing and
 * lists nothing. The result carries a state and an HTTP status at most — never
 * the bucket name, the endpoint, the key id or the provider's error message,
 * because this ends up in a page (and the RSC payload behind it).
 *
 * Pure so it can be tested without the S3 client: the caller passes whether
 * storage is configured and a thunk that performs the HeadBucket.
 */

export type StorageProbeState =
  | "OK"
  | "NOT_CONFIGURED"
  | "BUCKET_NOT_FOUND"
  | "ACCESS_DENIED"
  | "UNREACHABLE";

export type StorageProbeResult = {
  state: StorageProbeState;
  /** The HTTP status the provider answered with, when there was one. */
  httpStatus: number | null;
};

const PROBE_TIMEOUT_MS = 5000;

/** Maps an S3 SDK error to a state without keeping any of its text. */
export function classifyStorageError(error: unknown): StorageProbeResult {
  const e = (error ?? {}) as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const status =
    typeof e.$metadata?.httpStatusCode === "number" ? e.$metadata.httpStatusCode : null;
  const name = typeof e.name === "string" ? e.name : typeof e.Code === "string" ? e.Code : "";

  if (status === 404 || name === "NotFound" || name === "NoSuchBucket") {
    return { state: "BUCKET_NOT_FOUND", httpStatus: status ?? 404 };
  }
  if (
    status === 401 ||
    status === 403 ||
    name === "Forbidden" ||
    name === "AccessDenied" ||
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch"
  ) {
    return { state: "ACCESS_DENIED", httpStatus: status ?? 403 };
  }
  return { state: "UNREACHABLE", httpStatus: status };
}

/** Runs the HeadBucket with a timeout and never throws. */
export async function probeStorageBucket(input: {
  configured: boolean;
  head: () => Promise<unknown>;
  timeoutMs?: number;
}): Promise<StorageProbeResult> {
  if (!input.configured) return { state: "NOT_CONFIGURED", httpStatus: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      input.head(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
          input.timeoutMs ?? PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return { state: "OK", httpStatus: 200 };
  } catch (error) {
    return classifyStorageError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StorageReadiness = {
  state: "READY" | "ATTENTION" | "BLOCKED";
  detail: string;
  evidence: { label: string; value: string }[];
};

/** The readiness row for a probe result. Presence-only evidence. */
export function storageReadiness(
  result: StorageProbeResult,
  config: { credentialsSet: boolean; bucketNamed: boolean },
): StorageReadiness {
  const evidence = [
    { label: "Credentials", value: config.credentialsSet ? "set" : "missing" },
    { label: "Bucket name", value: config.bucketNamed ? "set" : "code default" },
    { label: "Probe", value: result.httpStatus ? `HTTP ${result.httpStatus}` : "not run" },
  ];
  switch (result.state) {
    case "OK":
      return {
        state: "READY",
        detail: "The storage bucket answered. Logo uploads, CSV imports and attachments can work.",
        evidence,
      };
    case "NOT_CONFIGURED":
      return {
        state: "BLOCKED",
        detail:
          "Storage is not configured on this deployment (R2 endpoint or keys missing). Logo uploads, CSV imports and attachments will fail.",
        evidence,
      };
    case "BUCKET_NOT_FOUND":
      return {
        state: "BLOCKED",
        detail:
          "Bucket not found. The configured bucket name does not exist for these credentials; check R2_BUCKET.",
        evidence,
      };
    case "ACCESS_DENIED":
      return {
        state: "BLOCKED",
        detail:
          "Access denied. The storage keys cannot read the configured bucket; check the R2 token's bucket permissions.",
        evidence,
      };
    case "UNREACHABLE":
      return {
        state: "ATTENTION",
        detail: "The storage endpoint did not answer in time or returned an unexpected error. Refresh to probe again.",
        evidence,
      };
  }
}
