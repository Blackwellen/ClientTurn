---
title: Connecting an AI assistant (MCP)
summary: Let Claude, Codex, Gemini or another MCP client work inside your workspace safely, with the permissions you choose
category: developers
keywords: [mcp, model context protocol, ai assistant, claude, claude code, codex, gemini, approvals, tools, mcp server]
order: 30
updated: 2026-09-26
---

ClientTurn is an MCP server. An AI assistant that supports the Model Context Protocol, such as Claude, Codex or Gemini, can connect to it and read or work your leads, prospects, agents and settings, within the permissions you give it.

## Connect the assistant

1. Create an API key in **Settings → Developer → New key**, with only the permissions the assistant needs. See [API keys](/help/developers/api-keys). The same key works for the API and for MCP.
2. Copy the **MCP endpoint** from **Settings → Developer**. It is your ClientTurn address followed by `/api/mcp`.
3. Add the server to your assistant with the key as a bearer header.

In Claude Code, for example:

```
claude mcp add --transport http clientturn https://<your ClientTurn address>/api/mcp --header "Authorization: Bearer ct_live_…"
```

Other clients have an equivalent setting for an HTTP MCP server with a custom `Authorization` header.

> **Note:** **Settings → Developer** also has an **Assistant connections** panel with **New connection**. It lists assistant connections and holds the requests waiting for your approval. For connecting a client, a workspace API key is the recommended credential, because it does not expire after an hour.

## What the assistant can do

The assistant can do what you granted and nothing else:

- It only sees the tools its permissions allow. A tool it has no permission for is not even listed, so it cannot discover a capability it cannot use.
- It cannot outrank you. It acts with the access of the person the key belongs to, and that person's current role is checked on every call.
- It can never set an AI model, a prompt or a token budget, or change an agent's own limits unattended.

For the full list of tools, see [MCP tools and approvals](/help/developers/mcp-tools-and-approvals).

## Actions that wait for a person

Anything with lasting consequences does not run when the assistant asks. Sending a message, launching a campaign, starting an agent, archiving a lead or disconnecting a system parks in your workspace for a person to approve, with a plain-English summary of what was requested.

> **Note:** The assistant is told clearly that nothing has happened, so it cannot report success. When you approve, the action runs on your authority, once; approving twice cannot do it twice.

Every call the assistant makes, and every refusal, is recorded. Revoking the key disconnects it immediately.

## Related

- [MCP tools and approvals](/help/developers/mcp-tools-and-approvals)
- [Leads from MCP](/help/finding-leads/leads-from-mcp)
- [Using Copilot](/help/copilot/using-copilot), the assistant built into ClientTurn
