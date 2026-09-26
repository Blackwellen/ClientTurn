// Regenerates the MCP tool table in docs/DEVELOPER_PLATFORM.md from the
// service registry. Run: node scripts/generate-mcp-tools-doc.mjs
// tests/developer-fixes.test.ts fails when the doc and the registry disagree.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withMcpToolsBlock } from "../src/lib/mcp/tool-docs.ts";

const file = path.join(process.cwd(), "docs", "DEVELOPER_PLATFORM.md");
const before = readFileSync(file, "utf8");
const after = withMcpToolsBlock(before);
if (after === before) {
  console.log("DEVELOPER_PLATFORM.md is already up to date (or has no mcp-tools markers).");
} else {
  writeFileSync(file, after);
  console.log("DEVELOPER_PLATFORM.md MCP tool table regenerated.");
}
