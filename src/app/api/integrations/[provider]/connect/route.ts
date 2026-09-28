import { NextResponse, type NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/permissions";
import { createOAuthState, buildAuthorizeUrl } from "@/lib/integrations/oauth";
import { getOAuthProviderConfig, isOAuthProvider } from "@/lib/integrations/providers/registry";
import { OAUTH_RETURN_COOKIE, safeOAuthReturnPath } from "@/lib/integrations/catalog";
// Populates that registry. Without it every provider is "unknown" here.
import "@/lib/integrations/providers/all";

export const dynamic = "force-dynamic";

/**
 * Starts an OAuth connection for any workspace-connected provider. Only an
 * admin or owner may connect a new external account to the workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  let workspace;
  try {
    workspace = await requireCapability("manage_integrations");
  } catch {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const config = getOAuthProviderConfig(provider);
  if (!config) {
    return NextResponse.json(
      { error: "This integration is not yet available." },
      { status: 503 },
    );
  }

  let state: string;
  let codeVerifier: string | null;
  try {
    ({ state, codeVerifier } = await createOAuthState(
      provider,
      workspace.businessId,
      workspace.userId,
      config,
    ));
  } catch (error) {
    console.error(`[integrations/${provider}/connect] Could not start OAuth state:`, error);
    return NextResponse.json(
      { error: "Could not start this connection. Try again in a moment." },
      { status: 500 },
    );
  }

  const authorizeUrl = buildAuthorizeUrl(provider, config, state, codeVerifier);

  const response = NextResponse.redirect(authorizeUrl);
  // Started from onboarding: come back there rather than to Settings. Only an
  // allowlisted path is ever stored (see safeOAuthReturnPath).
  const returnPath = safeOAuthReturnPath(request.nextUrl.searchParams.get("return"));
  if (returnPath) {
    response.cookies.set(OAUTH_RETURN_COOKIE, returnPath, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations",
      maxAge: 15 * 60,
    });
  }
  return response;
}
