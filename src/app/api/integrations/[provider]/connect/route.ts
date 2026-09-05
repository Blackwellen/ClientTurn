import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createOAuthState, buildAuthorizeUrl } from "@/lib/integrations/oauth";
import { getOAuthProviderConfig, isOAuthProvider } from "@/lib/integrations/providers/registry";

export const dynamic = "force-dynamic";

/**
 * Starts an OAuth connection for any workspace-connected provider. Only an
 * admin or owner may connect a new external account to the workspace.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!isOAuthProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  let workspace;
  try {
    workspace = await requireRole("admin");
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

  const state = await createOAuthState(provider, workspace.businessId, workspace.userId);
  const authorizeUrl = buildAuthorizeUrl(provider, config, state);

  return NextResponse.redirect(authorizeUrl);
}
