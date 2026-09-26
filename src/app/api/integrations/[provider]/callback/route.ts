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
// Populates that registry. Without it the callback rejects the very connection
// it just got a token for.
import "@/lib/integrations/providers/all";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import {
  OAUTH_RETURN_COOKIE,
  oauthLandingPath,
  safeOAuthReturnPath,
} from "@/lib/integrations/catalog";

export const dynamic = "force-dynamic";

/**
 * Where to land, and the outcome for the landing page to announce. The return
 * cookie (set by the connect route when the flow began in onboarding) is read
 * once and cleared on every exit.
 */
function land(request: NextRequest, provider: string, ok: boolean): NextResponse {
  const returnPath = safeOAuthReturnPath(request.cookies.get(OAUTH_RETURN_COOKIE)?.value);
  const response = NextResponse.redirect(
    `${request.nextUrl.origin}${oauthLandingPath({ returnPath, provider, ok })}`,
  );
  if (request.cookies.get(OAUTH_RETURN_COOKIE)) {
    response.cookies.set(OAUTH_RETURN_COOKIE, "", { path: "/api/integrations", maxAge: 0 });
  }
  return response;
}

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
  const { searchParams } = request.nextUrl;

  if (!isOAuthProvider(provider)) {
    return land(request, provider, false);
  }

  const errorParam = searchParams.get("error");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (errorParam || !code || !state) {
    return land(request, provider, false);
  }

  const verified = await consumeOAuthState(provider, state);
  if (!verified) {
    return land(request, provider, false);
  }

  const adapter = getOAuthProviderAdapter(provider);
  const config = adapter?.getConfig({ searchParams });
  if (!adapter || !config) {
    return land(request, provider, false);
  }

  try {
    const token = await exchangeCodeForToken(provider, config, code, verified.codeVerifier);
    const identity = await adapter.identify(token);

    const { integrationId } = await storeConnection({
      config: identity.config,
      businessId: verified.businessId,
      userId: verified.userId,
      provider,
      externalAccountId: identity.externalAccountId,
      displayName: identity.displayName,
      scopes: identity.scopes,
      token,
    });

    if (adapter.afterConnect) {
      await adapter.afterConnect({
        integrationId,
        businessId: verified.businessId,
        token,
        searchParams,
      });
    }

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

    return land(request, provider, true);
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
    return land(request, provider, false);
  }
}
