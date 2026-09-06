import { NextResponse, type NextRequest } from "next/server";
import {
  consumeOAuthState,
  exchangeCodeForToken,
  storeConnection,
} from "@/lib/integrations/oauth";
import {
  getOAuthProviderAdapter,
  isOAuthProvider,
} from "@/lib/integrations/providers/registry";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

const FAILURE_REDIRECT = "/app/settings?section=connections&connect=failed";

/**
 * Shared OAuth callback for every provider on the generic flow. No provider
 * ever gets its own callback route — one endpoint, dispatched by the
 * registered adapter, so the state-verification and storage logic exists
 * exactly once.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const { searchParams, origin } = request.nextUrl;

  if (!isOAuthProvider(provider)) {
    return NextResponse.redirect(`${origin}${FAILURE_REDIRECT}`);
  }

  const errorParam = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (errorParam || !code || !state) {
    return NextResponse.redirect(`${origin}${FAILURE_REDIRECT}`);
  }

  const verified = await consumeOAuthState(provider, state);
  if (!verified) {
    return NextResponse.redirect(`${origin}${FAILURE_REDIRECT}`);
  }

  const adapter = getOAuthProviderAdapter(provider);
  const config = adapter?.getConfig();
  if (!adapter || !config) {
    return NextResponse.redirect(`${origin}${FAILURE_REDIRECT}`);
  }

  try {
    const token = await exchangeCodeForToken(provider, config, code);
    const identity = await adapter.identify(token);

    const { integrationId } = await storeConnection({
      businessId: verified.businessId,
      userId: verified.userId,
      provider,
      externalAccountId: identity.externalAccountId,
      displayName: identity.displayName,
      scopes: identity.scopes,
      token,
    });

    await recordAudit({
      businessId: verified.businessId,
      actorUserId: verified.userId,
      action: "integration.connected",
      entityType: "integration",
      entityId: integrationId,
      metadata: { provider },
    });

    // A lead-source provider needs its first poll scheduled; other kinds are
    // ready to use immediately. The handler is a no-op for provider types
    // that do not register a poll job, so this is safe to call unconditionally.
    await enqueue(
      "lead_source.poll",
      { integrationId, provider },
      { businessId: verified.businessId, idempotencyKey: `poll-init:${integrationId}` },
    );

    return NextResponse.redirect(`${origin}/app/settings?section=connections&connected=${provider}`);
  } catch (error) {
    await recordAudit({
      businessId: verified.businessId,
      actorUserId: verified.userId,
      action: "integration.reconnect_required",
      entityType: "integration",
      metadata: {
        provider,
        error: error instanceof Error ? error.message : "unknown",
      },
    });
    return NextResponse.redirect(`${origin}${FAILURE_REDIRECT}`);
  }
}
