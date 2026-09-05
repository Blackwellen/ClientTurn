import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveWorkspace } from "@/lib/auth/session";
import { globalSearch } from "@/lib/search/queries";
import { EMPTY_SEARCH_RESULT, SEARCH_MIN_QUERY_LENGTH } from "@/lib/search/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
});

export async function GET(request: Request) {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const term = parsed.data.q;

  if (term.length < SEARCH_MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { query: term, results: EMPTY_SEARCH_RESULT },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const results = await globalSearch(workspace.businessId, term);
    return NextResponse.json(
      { query: term, results },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // A query/table hiccup should degrade to "nothing found" rather than
    // surface a broken palette — this is a fast, best-effort lookup.
    return NextResponse.json(
      { query: term, results: EMPTY_SEARCH_RESULT },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
