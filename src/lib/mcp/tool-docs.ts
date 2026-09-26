/**
 * The MCP tool table in docs/DEVELOPER_PLATFORM.md, generated from the
 * registry rather than typed by hand. Pure.
 *
 * The hand-typed table said 42 tools across twelve domains while the registry
 * offered 77 -- a figure nobody could keep true by editing prose.
 * `node scripts/generate-mcp-tools-doc.mjs` rewrites the block between the
 * markers, and `tests/developer-fixes.test.ts` fails when the doc and the
 * registry disagree.
 */
import { operationsForCaller } from "../services/registry.ts";
import { MCP_TOOLS, mcpKindForRisk } from "./tools.ts";

export const MCP_DOC_START = "<!-- mcp-tools:start (generated: node scripts/generate-mcp-tools-doc.mjs) -->";
export const MCP_DOC_END = "<!-- mcp-tools:end -->";

export function mcpToolRows(): { domain: string; name: string; kind: string; scope: string }[] {
  const service = operationsForCaller("MCP").map((operation) => ({
    domain: operation.domain,
    name: operation.name,
    kind: mcpKindForRisk(operation.risk),
    scope: operation.scope as string,
  }));
  const legacy = MCP_TOOLS.map((tool) => ({
    domain: "(legacy)",
    name: tool.name,
    kind: tool.kind,
    scope: tool.scope as string,
  }));
  return [...service, ...legacy];
}

/** The markdown block, markers included. */
export function mcpToolsDocBlock(): string {
  const rows = mcpToolRows();
  const byDomain = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDomain.get(row.domain) ?? [];
    list.push(row);
    byDomain.set(row.domain, list);
  }
  const domains = [...byDomain.keys()].sort((a, b) =>
    a === "(legacy)" ? 1 : b === "(legacy)" ? -1 : a.localeCompare(b),
  );

  const lines = [
    MCP_DOC_START,
    "",
    `${rows.length} tools are declared for MCP clients, across ${domains.length} domains. A declared operation whose handler is not implemented is not advertised by \`tools/list\`, and \`tools/list\` shows each credential only the tools its scopes allow.`,
    "",
    "| Domain | Tool | Kind | Scope |",
    "|---|---|---|---|",
  ];
  for (const domain of domains) {
    for (const row of byDomain.get(domain)!) {
      lines.push(`| \`${domain}\` | \`${row.name}\` | ${row.kind} | \`${row.scope}\` |`);
    }
  }
  lines.push("", MCP_DOC_END);
  return lines.join("\n");
}

/** The doc with its block replaced (or inserted if the markers are missing). */
export function withMcpToolsBlock(doc: string): string {
  const start = doc.indexOf(MCP_DOC_START);
  const end = doc.indexOf(MCP_DOC_END);
  if (start === -1 || end === -1) return doc;
  // Keep the file's own line endings (a Windows checkout has CRLF).
  const block = doc.includes("\r\n")
    ? mcpToolsDocBlock().replace(/\n/g, "\r\n")
    : mcpToolsDocBlock();
  return doc.slice(0, start) + block + doc.slice(end + MCP_DOC_END.length);
}
