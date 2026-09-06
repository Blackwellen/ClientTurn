"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bed,
  Building2,
  CheckCircle2,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ChatComposer } from "../chat-composer";
import { createSearchSessionAction } from "@/lib/find-leads/actions";
import { cn } from "@/lib/cn";

/**
 * The Discover chat launcher.
 *
 * This is the front door, and it is deliberately a conversation rather than a
 * filter form. The first thing a customer sees is "tell me about the businesses
 * you want to find", not twelve dropdowns — the structured plan exists, it is
 * fully editable, and it appears once there is something to edit.
 *
 * Sending here creates a session and navigates into it, so the conversation
 * continues on a URL that can be shared, reopened and reasoned about.
 */

const PROMPTS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  prompt: string;
}[] = [
  {
    icon: Building2,
    title: "Find property managers",
    subtitle: "in Bournemouth",
    prompt:
      "Find property managers within 40 miles of Bournemouth who manage multiple properties and may need a commercial roofing contractor.",
  },
  {
    icon: Building2,
    title: "Look for commercial buildings",
    subtitle: "with flat roofs",
    prompt:
      "Find commercial buildings with flat roofs in Dorset and Hampshire where the owner or facilities manager may need roof maintenance.",
  },
  {
    icon: Users,
    title: "Find facilities managers",
    subtitle: "in Hampshire",
    prompt:
      "Find facilities managers at companies in Hampshire responsible for building maintenance and repairs.",
  },
  {
    icon: Bed,
    title: "Show me hotels",
    subtitle: "in South England",
    prompt:
      "Find hotels and hospitality businesses across South England that own their buildings and may need roofing work.",
  },
];

export function DiscoverChat({
  firstName,
  profileComplete,
}: {
  firstName: string;
  profileComplete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [showExamples, setShowExamples] = React.useState(false);

  const start = (message: string) => {
    startTransition(async () => {
      const result = await createSearchSessionAction(message);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      router.push(`/app/find-leads/search/${result.data.sessionId}`);
    });
  };

  return (
    <section
      aria-label="Search with ClientTurn AI"
      className="flex min-h-[560px] flex-col rounded-xl border border-line bg-surface shadow-xs"
    >
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
          >
            <Sparkles className="size-4.5" />
          </span>
          <h2 className="text-[16px] font-semibold text-content">ClientTurn AI</h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowExamples((value) => !value)}
          aria-expanded={showExamples}
        >
          View example prompts
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-5 py-6 text-center">
        <span
          aria-hidden
          className="mb-5 flex size-16 items-center justify-center rounded-full bg-accent-50"
        >
          <Sparkles className="size-7 text-accent-600" />
        </span>

        <h3 className="max-w-[520px] text-[26px] font-semibold leading-snug tracking-tight text-content">
          {firstName ? `Hi ${firstName}, ` : ""}tell me about the businesses or people
          you want to find.
        </h3>
        <p className="mt-3 max-w-[520px] text-[14px] leading-relaxed text-content-muted">
          Describe your ideal customer in plain language and I&rsquo;ll create a search
          plan, find prospects and help you get them ready for outreach.
        </p>

        {!profileComplete && (
          <p className="mt-3 max-w-[520px] text-[12.5px] leading-relaxed text-content-secondary">
            Setting up your business profile first makes the search plans much more
            accurate — the card on the right does it from your website.
          </p>
        )}

        {showExamples && (
          <ul className="mt-5 w-full max-w-[560px] space-y-1.5 rounded-lg border border-line bg-surface-sunken/60 p-3 text-left">
            {PROMPTS.map((prompt) => (
              <li key={prompt.title} className="text-[12.5px] leading-relaxed text-content-secondary">
                &ldquo;{prompt.prompt}&rdquo;
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 grid w-full max-w-[560px] gap-3 sm:grid-cols-2">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt.title}
              type="button"
              disabled={pending}
              onClick={() => start(prompt.prompt)}
              className={cn(
                "group flex items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left",
                "transition-colors hover:border-accent-200 hover:bg-accent-50/40",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <prompt.icon
                className="mt-0.5 size-4 shrink-0 text-content-subtle group-hover:text-content-accent"
                aria-hidden
              />
              <span className="min-w-0 text-[13px] leading-snug text-content">
                {prompt.title}
                <span className="block text-content-muted">{prompt.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-line-subtle px-5 py-4">
        <ChatComposer
          onSend={start}
          pending={pending}
          placeholder="Describe the businesses or people you want to find..."
        />
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-content-subtle">
          <CheckCircle2 className="size-3.5 text-success-600" aria-hidden />
          Nothing is spent while we plan. You review the plan before any sourcing runs.
        </p>
      </div>
    </section>
  );
}
