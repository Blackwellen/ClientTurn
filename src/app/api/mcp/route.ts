import { NextResponse } from "next/server";
import { authenticate, callTool, listTools } from "@/lib/mcp/gateway";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The ClientTurn MCP endpoint (V4 §88).
 *
 * Speaks JSON-RPC 2.0 over HTTP, which is what MCP clients expect. Only three
 * methods are served — `initialize`, `tools/list` and `tools/call` — because
 * ClientTurn exposes tools and nothing else: no prompts, no resources, no
 * sampling. A client asking for those gets a clean "method not found" rather
 * than a half-implemented surface.
 *
 * Authentication is a bearer token on every request. There is no session: each
 * call re-resolves the token, re-reads the authorising user's live role, and is
 * audited. See `lib/mcp/gateway.ts`.
 */

/**
 * Protocol revisions this server implements. `initialize` echoes the client's
 * version when we speak it and otherwise answers with our newest — which is
 * what the specification asks for, and what stops a client from assuming a
 * revision we do not actually support.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  status = 200,
) {
  // JSON-RPC errors are 200s with an error body; only transport-level failures
  // (bad auth, malformed body) use an HTTP status.
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }

  const ip = clientIdentifier(request.headers);

  // Bounded before the credential is looked up, so guessing a key costs an
  // attacker rate-limit budget rather than a database query.
  const guessLimit = await checkRateLimit("api:unauthenticated", ip);
  if (!guessLimit.allowed) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32029, message: "Too many requests." },
      },
      {
        status: 429,
        headers: { "retry-after": String(Math.max(1, guessLimit.retryAfterSeconds)) },
      },
    );
  }

  const auth = await authenticate(request.headers.get("authorization"), ip);
  if (!auth) {
    // 401 with the standard challenge, so a client knows to re-authorise
    // rather than treating this as a tool failure.
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32001, message: "Unauthorized" },
      },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="clientturn"' } },
    );
  }

  // A resolved credential gets its own budget, so one workspace's runaway
  // assistant cannot degrade anyone else's.
  const callLimit = await checkRateLimit(
    "api:key",
    auth.apiKeyId ?? auth.clientId ?? auth.businessId,
  );
  if (!callLimit.allowed) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32029, message: "Too many requests." },
      },
      {
        status: 429,
        headers: { "retry-after": String(Math.max(1, callLimit.retryAfterSeconds)) },
      },
    );
  }

  switch (body.method) {
    case "initialize":
      return rpcResult(body.id, {
        protocolVersion:
          typeof body.params?.protocolVersion === "string" &&
          SUPPORTED_PROTOCOL_VERSIONS.includes(body.params.protocolVersion)
            ? body.params.protocolVersion
            : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "clientturn", version: "1.0.0" },
      });

    case "ping":
      return rpcResult(body.id, {});

    // A notification carries no id and must not be answered with a result. A
    // client that receives one for a notification it sent treats the stream as
    // corrupt, which shows up as a connection that handshakes and then dies.
    case "notifications/initialized":
    case "notifications/cancelled":
      return new NextResponse(null, { status: 202 });

    case "tools/list":
      return rpcResult(body.id, {
        tools: listTools(auth).map((tool) => ({
          name: tool.name,
          // The description states plainly when a tool will park for approval,
          // so an assistant can tell the user before it tries.
          description:
            tool.kind === "APPROVAL_GATED"
              ? `${tool.description} (Requires approval by a person; calling this does not carry it out.)`
              : tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const name = typeof body.params?.name === "string" ? body.params.name : null;
      if (!name) return rpcError(body.id, -32602, "A tool name is required.");

      const args =
        body.params?.arguments && typeof body.params.arguments === "object"
          ? (body.params.arguments as Record<string, unknown>)
          : {};

      const result = await callTool(auth, name, args);

      // MCP convention: a tool that refused is a successful call with
      // `isError`, not a protocol error. The assistant should read the reason
      // and tell the user, not retry.
      if (!result.ok) {
        return rpcResult(body.id, {
          isError: true,
          content: [{ type: "text", text: result.message }],
        });
      }

      return rpcResult(body.id, {
        content: [{ type: "text", text: JSON.stringify(result.content, null, 2) }],
      });
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method ?? "(none)"}`);
  }
}

/** A plain GET describes the endpoint rather than 405-ing a curious operator. */
export async function GET() {
  return NextResponse.json({
    name: "clientturn",
    transport: "http",
    protocol: "jsonrpc-2.0",
    methods: ["initialize", "ping", "tools/list", "tools/call"],
    authentication:
      "Bearer credential from Settings → Developer. A workspace API key (ct_live_…) is the durable option; an MCP access token also works but expires after an hour.",
  });
}
