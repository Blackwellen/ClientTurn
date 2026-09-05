import "server-only";
import type { ZodType } from "zod";
import { PermanentJobError } from "@/lib/jobs/registry";

/** A malformed payload will never become valid, so it is never retried. */
export function parsePayload<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PermanentJobError(
      `Invalid job payload: ${issue?.path.join(".") || "payload"} ${issue?.message ?? "is not valid"}`,
    );
  }
  return parsed.data;
}
