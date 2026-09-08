"use client";

import * as React from "react";
import { Check, Copy, Terminal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The header card for Settings → Developer.
 *
 * It exists because the first thing a developer needs is the base URL and a
 * request they can paste, and the second is proof their key works before they
 * write anything real. `GET /api/v1/me` answers both, so it is the example —
 * not a `POST` that would change something in a workspace while somebody is
 * still finding out whether their credentials are right.
 */
export function DeveloperOverview({
  baseUrl,
  secretsAvailable,
}: {
  baseUrl: string;
  secretsAvailable: boolean;
}) {
  const [copied, setCopied] = React.useState<string | null>(null);

  const curl = `curl ${baseUrl}/api/v1/me \\\n  -H "Authorization: Bearer ct_live_…"`;
  const mcp = `claude mcp add --transport http clientturn \\\n  ${baseUrl}/api/mcp \\\n  --header "Authorization: Bearer ct_live_…"`;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused. The value is on screen and selectable.
    }
  }

  return (
    <section
      aria-labelledby="developer-heading"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-content-secondary"
        >
          <Terminal className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="developer-heading" className="text-[14px] font-semibold text-content">
            Build on ClientTurn
          </h3>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Read and update this workspace from your own systems, be told the
            moment something happens, or connect an AI assistant. Everything below
            uses the same permissions and the same audit trail as the app itself.
          </p>
        </div>
      </div>

      {!secretsAvailable && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50/60 px-3 py-2 text-[12px] text-warning-800">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This deployment cannot store webhook signing secrets yet, so webhook
            endpoints cannot be created. API keys and assistant connections are
            unaffected. Ask your administrator to configure credential encryption.
          </span>
        </p>
      )}

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <Snippet
          label="Base URL"
          value={`${baseUrl}/api/v1`}
          copied={copied === "base"}
          onCopy={() => copy("base", `${baseUrl}/api/v1`)}
        />
        <Snippet
          label="MCP endpoint"
          value={`${baseUrl}/api/mcp`}
          copied={copied === "mcp-url"}
          onCopy={() => copy("mcp-url", `${baseUrl}/api/mcp`)}
        />
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Example
          title="Check a key works"
          body={curl}
          copied={copied === "curl"}
          onCopy={() => copy("curl", curl)}
        />
        <Example
          title="Connect an AI assistant"
          body={mcp}
          copied={copied === "mcp"}
          onCopy={() => copy("mcp", mcp)}
          note="The same key works for the API and for MCP. Claude, Codex and Gemini all take a bearer header."
        />
      </div>
    </section>
  );
}

function Snippet({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken px-2.5 py-2">
      <dt className="text-[11.5px] font-medium text-content-secondary">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-content">
          {value}
        </code>
        <Button size="xs" variant="ghost" onClick={onCopy} aria-label={`Copy ${label}`}>
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
        </Button>
      </dd>
    </div>
  );
}

function Example({
  title,
  body,
  note,
  copied,
  onCopy,
}: {
  title: string;
  body: string;
  note?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium text-content-secondary">
          {title}
        </span>
        <Button size="xs" variant="ghost" onClick={onCopy} aria-label={`Copy: ${title}`}>
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
        </Button>
      </div>
      <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-content-muted">
        {body}
      </pre>
      {note && <p className="mt-1.5 text-[11px] text-content-subtle">{note}</p>}
    </div>
  );
}
