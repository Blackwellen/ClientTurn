import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "lr_admin_stepup";
export const STEP_UP_WINDOW_MS = 30 * 60 * 1000;

export class StepUpRequiredError extends Error {
  constructor() {
    super("STEP_UP_REQUIRED");
    this.name = "StepUpRequiredError";
  }
}

function signingKey(): string {
  const key =
    process.env.ADMIN_STEP_UP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Missing ADMIN_STEP_UP_SECRET (or SUPABASE_SERVICE_ROLE_KEY) for admin step-up signing",
    );
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function verify(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * Records that this operator re-entered their password just now. The cookie is
 * only a signed timestamp: it never carries the role, so a forged or replayed
 * value cannot grant admin access on its own.
 */
export async function grantStepUp(userId: string): Promise<void> {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const store = await cookies();
  store.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: Math.floor(STEP_UP_WINDOW_MS / 1000),
  });
}

export async function clearStepUp(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/admin", maxAge: 0 });
}

export async function stepUpRemainingMs(userId: string): Promise<number> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return 0;

  const lastDot = raw.lastIndexOf(".");
  if (lastDot < 0) return 0;

  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  if (!verify(payload, signature)) return 0;

  const [cookieUserId, issuedAtRaw] = payload.split(".");
  if (cookieUserId !== userId) return 0;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return 0;

  const remaining = issuedAt + STEP_UP_WINDOW_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

export async function hasStepUp(userId: string): Promise<boolean> {
  return (await stepUpRemainingMs(userId)) > 0;
}

/** Every mutating admin operation calls this before touching any data. */
export async function requireStepUp(userId: string): Promise<void> {
  if (!(await hasStepUp(userId))) throw new StepUpRequiredError();
}
