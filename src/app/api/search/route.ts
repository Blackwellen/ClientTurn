import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveWorkspace } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { globalSearch } from "@/lib/search/queries";
import {
  allGroupsFailed,
  EMPTY_SEARCH_RESULT,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchResponse,
} from "@/lib/search/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const querySchema = z.object({
  q: z.string().trim().max(SEARCH_MAX_QUERY_LENGTH).optional().default(""),
});

/**
 * Command palette search.
 *
 * 200 with `failed: []` — real answers (possibly none).
 * 200 with some `failed` groups — partial answers; the palette marks those groups.
 * 500 `search_failed` — nothing could be searched; the palette shows a retry state.
 * A failure is never reported as an empty result.
 */
export async function GET(request: Request) {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: NO_STORE });
  }

  const term = parsed.data.q;

  if (term.length < SEARCH_MIN_QUERY_LENGTH) {
    const body: SearchResponse = { query: term, results: EMPTY_SEARCH_RESULT, failed: [] };
    return NextResponse.json(body, { headers: NO_STORE });
  }

  try {
    const entitlements = await getV4Entitlements(workspace.businessId);
    // Same capability rule the app layout uses to build the sidebar.
    const capabilities = {
      sourcing: entitlements.sourcingEnabled,
      analytics: entitlements.plan !== "trial",
    };

    const { results, failed } = await globalSearch(workspace.businessId, term, {
      capabilities,
    });

    if (allGroupsFailed(results, failed)) {
      console.error("[search] every search group failed", { failed });
      return NextResponse.json({ error: "search_failed" }, { status: 500, headers: NO_STORE });
    }

    const body: SearchResponse = { query: term, results, failed };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    console.error("[search] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "search_failed" }, { status: 500, headers: NO_STORE });
  }
}
