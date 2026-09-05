import { NextResponse } from "next/server";
import { seedWorkspace } from "@/lib/dev/seed";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Development-only. Requires the cron secret so it cannot be triggered by a
 * visitor, and refuses to run in production regardless of the secret.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const secret = serverEnv.cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: { businessId?: string; reset?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body.businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  try {
    const result = await seedWorkspace(body.businessId, { reset: body.reset });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Dev-only route, so the raw provider error is the useful thing to return.
    console.error("seed failed", error);
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify(error)
          : String(error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
