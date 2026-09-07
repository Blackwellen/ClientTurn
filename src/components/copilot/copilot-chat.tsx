"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { askCopilot, runCopilotTool } from "@/lib/copilot/actions";
import {
  EXAMPLE_PROMPTS,
  MAX_PROMPT_LENGTH,
  SHORTCUTS,
  copilotTool,
  type CopilotMessage,
} from "@/lib/copilot/types";
import { ConfirmToolDialog } from "./confirm-tool-dialog";

const SHORTCUT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  search: Search,
  leads: Users,
  campaigns: Send,
  analytics: BarChart3,
  create: Plus,
  settings: Settings,
};

/** Where a CTA that is really navigation should go. */
const CTA_HREF: Record<string, string> = {
  openLeads: "/app/leads?quick=attention",
  openAnalytics: "/app/analytics",
  openBusinessProfile: "/app/settings?section=business-profile",
  openBilling: "/app/settings?section=billing",
};

/**
 * The Chat tab (V4 §28.4, §28.14).
 *
 * Answers are assembled server-side from real tool results, so what appears
 * here is always traceable to the workspace's own data. Where an answer has an
 * action attached, it appears as a button — and a high-impact one opens a
 * confirmation that states the effect before anything happens.
 */
export function CopilotChat({
  pathname,
  sessionId,
  onSession,
}: {
  pathname: string;
  sessionId: string | null;
  onSession: (id: string) => void;
}) {
  const [messages, setMessages] = React.useState<CopilotMessage[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<{
    tool: string;
    label: string;
    objectId?: string;
  } | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || pending) return;

    setPrompt("");
    setError(null);
    setPending(true);

    // Shown immediately so the conversation reads as a conversation; the
    // server's own copy replaces nothing, because the id is local-only.
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "USER",
        content: trimmed,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const result = await askCopilot({
        sessionId,
        prompt: trimmed,
        route: pathname,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSession(result.data.sessionId);
      setMessages((current) => [...current, ...result.data.messages]);
    } catch {
      setError("Copilot could not answer that. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function runAction(tool: string, objectId: string | undefined, confirmed: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await runCopilotTool({
        sessionId,
        tool,
        args: objectId ? { id: objectId } : {},
        confirmed,
      });

      setMessages((current) => [
        ...current,
        {
          id: `tool-${Date.now()}`,
          role: "TOOL",
          content: result.ok ? result.data.summary : result.error,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setPending(false);
      setConfirming(null);
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {empty ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success-100 bg-success-50/70 p-4">
              <p className="text-[16px] font-semibold text-content">Hi 👋</p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-content-secondary">
                I can help you find leads, analyse performance, create campaigns,
                answer questions and take actions across ClientTurn.
              </p>
              <p className="mt-2 text-[13px] text-content-secondary">
                What would you like to do today?
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-content">
                Try these examples
              </h3>
              <ul className="mt-2 space-y-1.5">
                {EXAMPLE_PROMPTS.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => void send(example)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left",
                        "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                      )}
                    >
                      <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-content-secondary">
                        {example}
                      </span>
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-content-subtle"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {messages.map((message) => (
              <li key={message.id}>
                <MessageBubble
                  message={message}
                  onAction={(tool, objectId) => {
                    const declaration = copilotTool(tool);
                    if (declaration?.requiresConfirmation) {
                      setConfirming({
                        tool,
                        label: declaration.summary,
                        objectId,
                      });
                      return;
                    }
                    void runAction(tool, objectId, false);
                  }}
                />
              </li>
            ))}
            {pending && (
              <li
                role="status"
                className="flex items-center gap-2 text-[12.5px] text-content-muted"
              >
                <Sparkles className="size-3.5 animate-pulse" aria-hidden />
                Working on it…
              </li>
            )}
            <div ref={endRef} />
          </ol>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[12.5px] text-danger-600">
            {error}
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- composer */}
      <div className="shrink-0 space-y-2 border-t border-line px-4 py-3">
        <ul className="flex flex-wrap gap-1.5">
          {SHORTCUTS.map((shortcut) => {
            const Icon = SHORTCUT_ICON[shortcut.id] ?? Sparkles;
            return (
              <li key={shortcut.id}>
                <button
                  type="button"
                  onClick={() => setPrompt(shortcut.prompt)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5",
                    "text-[12px] font-medium text-content-secondary hover:bg-surface-hover",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {shortcut.label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="copilot-prompt">
            Ask Copilot
          </label>
          <Textarea
            id="copilot-prompt"
            rows={2}
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="Ask anything about your business…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline. A composer that needs a
              // mouse click to send is a composer nobody uses twice.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(prompt);
              }
            }}
            className="min-h-[3rem] flex-1 resize-none text-[13px]"
          />
          <Button
            size="md"
            aria-label="Send"
            loading={pending}
            disabled={prompt.trim().length < 2}
            onClick={() => void send(prompt)}
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {confirming && (
        <ConfirmToolDialog
          tool={confirming.tool}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void runAction(confirming.tool, confirming.objectId, true)}
          pending={pending}
        />
      )}
    </>
  );
}

function MessageBubble({
  message,
  onAction,
}: {
  message: CopilotMessage;
  onAction: (tool: string, objectId?: string) => void;
}) {
  if (message.role === "USER") {
    return (
      <div className="ml-8 rounded-xl bg-accent-50 px-3.5 py-2.5">
        <p className="text-[13px] leading-[1.55] text-content">{message.content}</p>
      </div>
    );
  }

  if (message.role === "TOOL") {
    return (
      <div className="rounded-lg border border-line bg-surface-sunken/60 px-3 py-2">
        <p className="text-[12px] text-content-muted">{message.content}</p>
      </div>
    );
  }

  const cta = message.toolSummary?.cta;
  const href = cta ? CTA_HREF[cta.tool] : undefined;

  return (
    <div className="mr-8 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-content-secondary">
        {message.content}
      </p>

      {message.toolSummary?.label && (
        <p className="mt-1.5 text-[11px] text-content-subtle">
          Source: {message.toolSummary.label}
        </p>
      )}

      {cta &&
        (href ? (
          <Link
            href={href}
            className={cn(
              "mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1.5",
              "text-[12px] font-medium text-content hover:bg-surface-hover",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            {cta.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <Button
            size="xs"
            variant="secondary"
            className="mt-2.5"
            onClick={() => onAction(cta.tool, cta.objectId)}
          >
            {cta.label}
          </Button>
        ))}
    </div>
  );
}
