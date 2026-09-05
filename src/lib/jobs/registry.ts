import "server-only";
import type { ClaimedJob, JobType } from "./queue";

/** Signals a failure that must not be retried (bad number, revoked auth, …). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

type Handler = (job: ClaimedJob) => Promise<void>;

const handlers: Partial<Record<JobType, Handler>> = {};

export function registerHandler(type: JobType, handler: Handler) {
  handlers[type] = handler;
}

export async function handleJob(job: ClaimedJob) {
  const handler = handlers[job.type];
  if (!handler) {
    throw new PermanentJobError(`No handler registered for job type ${job.type}`);
  }
  await handler(job);
}
