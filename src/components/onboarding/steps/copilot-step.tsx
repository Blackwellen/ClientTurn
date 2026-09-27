"use client";

import * as React from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Lock,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wand2,
} from "lucide-react";
import { OButton, OPanel, OSectionTitle, OTextarea } from "../ui";
import type { StepActions } from "../step-types";
import { askCopilot } from "@/lib/copilot/actions";
import { COPILOT_CANNOT, MAX_PROMPT_LENGTH, joinList, type CopilotMessage } from "@/lib/copilot/types";
import { FIRST_COPILOT_PROMPTS } from "@/lib/onboarding/steps";

/**
 * Onboarding step 1 — Meet Copilot (Phase 8.3).
 *
 * Introduces Copilot, states its permission model plainly, and has the person
 * ask a first real question against their own workspace. The question goes
 * through the same `askCopilot` action the in-app drawer uses — same role
 * check, same confirmation gate, same audit — so this is not a demo.
 *
 * Every permission claim below is enforced in code, not only described:
 *   - acts with your role: `CopilotToolService` reads the session role
 *     (`src/lib/copilot/tool-service.ts`, rule 2);
 *   - high-impact actions need confirmation: `requiresConfirmation` (rule 3) —
 *     destructive, financial and external operations only; routine edits run
 *     straight away and are audited;
 *   - no sending, launching, suppression, anonymisation, erasure or export:
 *     those operations do not list COPILOT as a caller (`COPILOT_CANNOT`,
 *     checked against `src/lib/services/registry.ts` by a test).
 *
 * Asking is encouraged, not forced: an AI provider outage must not block
 * setting up the rest of the workspace, so "Skip for now" always works.
 */

const CAN_DO = [
  { icon: Search, title: "Answer from your data", body: "Leads, bookings, campaigns and settings — every answer names where it came from." },
  { icon: BarChart3, title: "Explain performance", body: "Which sources convert, what needs attention and why." },
  { icon: Wand2, title: "Draft and prepare", body: "Campaign drafts and next steps, ready for you to review." },
  { icon: MessageSquareText, title: "Take actions for you", body: "Routine changes you ask for, using the same checks as the rest of the app." },
];

const PERMISSIONS = [
  {
    icon: UserCheck,
    title: "It acts with your role",
    body: "Copilot has no permissions of its own. If you could not do something by hand, you cannot do it by asking.",
  },
  {
    icon: ShieldCheck,
    title: "High-impact actions wait for you",
    body: "Archiving a lead, starting or running an agent, disconnecting a system, merging duplicates and closing an opportunity are described first and only run when you confirm. Routine edits you ask for, like updating a lead, happen straight away and are recorded in the audit log.",
  },
  {
    icon: Lock,
    title: "Some things it can never do",
    body: `It cannot ${joinList(COPILOT_CANNOT.map((item) => item.label))}. It can draft messages and campaigns for you to review and send yourself.`,
  },
];

export function CopilotStep({
  onContinue,
  onSaveExit,
  onRegisterActions,
}: {
  onContinue: () => void;
  onSaveExit: () => void;
  onRegisterActions: (actions: StepActions) => void;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<CopilotMessage[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const asked = messages.some((message) => message.role === "ASSISTANT");

  React.useEffect(() => {
    onRegisterActions({
      continue: onContinue,
      saveExit: onSaveExit,
      // Optional (8.29): asking a question is a demonstration, not a gate.
      disabledReason: undefined,
    });
    // The handlers are stable for the life of the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || pending) return;
    setPending(true);
    setError(null);
    setPrompt("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "USER", content: trimmed, createdAt: new Date().toISOString() },
    ]);
    try {
      const result = await askCopilot({ sessionId, prompt: trimmed, route: "/onboarding" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSessionId(result.data.sessionId);
      setMessages((current) => [...current, ...result.data.messages]);
    } catch {
      setError("Copilot could not answer just now. You can skip this step and try it later from the Copilot button.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.15fr]">
      <div className="space-y-5">
        <OPanel className="p-4 sm:p-5">
          <OSectionTitle hint="Copilot sits in the top bar on every page once you are set up.">
            What Copilot can do
          </OSectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CAN_DO.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(168,255,31,0.12)] text-[var(--auth-lime)]"
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#f1f5f9]">{title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-[#96a1b3]">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </OPanel>

        <OPanel className="p-4 sm:p-5">
          <OSectionTitle hint="The rules are enforced by the product, not by the AI.">
            How its permissions work
          </OSectionTitle>
          <ul className="space-y-3.5">
            {PERMISSIONS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--auth-lime)]" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#f1f5f9]">{title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[#96a1b3]">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </OPanel>
      </div>

      <OPanel className="flex min-h-[420px] flex-col p-4 sm:p-5">
        <OSectionTitle hint="Pick a suggestion or write your own. It answers from your workspace.">
          Ask your first question
        </OSectionTitle>

        <div className="min-h-0 flex-1 space-y-3" aria-live="polite">
          {messages.length === 0 ? (
            <ul className="space-y-2">
              {FIRST_COPILOT_PROMPTS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => void ask(suggestion)}
                    disabled={pending}
                    className="flex w-full items-center gap-2.5 rounded-[9px] border border-[rgba(150,170,190,0.28)] bg-[#0b141d] px-3.5 py-3 text-left text-[13.5px] text-[#dfe5ee] transition-colors hover:border-[var(--auth-lime)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)] disabled:opacity-60"
                  >
                    <Sparkles aria-hidden className="size-4 shrink-0 text-[var(--auth-lime)]" />
                    <span className="min-w-0 flex-1">{suggestion}</span>
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-[#6b7688]" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ol className="space-y-3">
              {messages.map((message) => (
                <li key={message.id}>
                  {message.role === "USER" ? (
                    <p className="ml-8 rounded-[10px] bg-[rgba(168,255,31,0.10)] px-3.5 py-2.5 text-[13.5px] text-[#f1f5f9]">
                      {message.content}
                    </p>
                  ) : (
                    <div className="mr-4 rounded-[10px] border border-[rgba(150,170,190,0.24)] bg-[#0b141d] px-3.5 py-2.5">
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#c7d0dc]">
                        {message.content}
                      </p>
                      {message.toolSummary?.label ? (
                        <p className="mt-1.5 text-[11.5px] text-[#6b7688]">Source: {message.toolSummary.label}</p>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
              {pending ? (
                <li role="status" className="flex items-center gap-2 text-[12.5px] text-[#96a1b3]">
                  <Sparkles aria-hidden className="size-3.5 animate-pulse motion-reduce:animate-none" />
                  Copilot is working on it…
                </li>
              ) : null}
            </ol>
          )}

          {asked ? (
            <p className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--auth-lime)]">
              <Check aria-hidden className="size-4" />
              Copilot is set up. Ask another, or continue.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-[12.5px] text-[#ffb020]">
              {error}
            </p>
          ) : null}
        </div>

        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(prompt);
          }}
        >
          <label htmlFor="onboarding-copilot-prompt" className="sr-only">
            Ask Copilot
          </label>
          <OTextarea
            id="onboarding-copilot-prompt"
            rows={2}
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="Ask anything about your workspace…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(prompt);
              }
            }}
            className="min-h-[52px] flex-1"
          />
          <OButton type="submit" loading={pending} disabled={prompt.trim().length < 2}>
            Ask
          </OButton>
        </form>

        {!asked ? (
          <button
            type="button"
            onClick={onContinue}
            className="mt-3 self-start rounded-sm text-[12.5px] font-medium text-[#96a1b3] underline-offset-4 hover:text-[#eef2f7] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
          >
            Skip for now
          </button>
        ) : null}
      </OPanel>
    </div>
  );
}
