"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

/** Ready-to-use copy, with a one-press copy button. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="relative mt-2.5">
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-sunken px-3.5 py-3 pr-24 text-[12.5px] leading-relaxed text-content-secondary">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard access can be refused. The text is on screen and
            // selectable either way, so nothing is actually lost.
          }
        }}
        className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12px] text-content shadow-xs hover:bg-surface-hover"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
