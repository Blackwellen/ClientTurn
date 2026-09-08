import * as React from "react";
import {
  ArrowDown,
  AtSign,
  Clock,
  Eye,
  Handshake,
  MessageSquare,
  Send,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  socialPlanSteps,
  socialPlanSummary,
  type PlanStep,
} from "@/lib/outreach/social-plan";
import type { SocialSequenceSettings } from "@/lib/outreach/social-sequence";

/**
 * The sequence, drawn.
 *
 * The settings were real and invisible: five columns on `business_data_controls`
 * that combine into a specific sequence, with no way for a customer to see what
 * they combined into. Four numbers on a settings screen and one legible diagram
 * are not equivalent — only the second lets somebody notice their sequence is
 * wrong *before* it runs at three hundred people.
 *
 * A Server Component: it derives from settings and has no interactivity of its
 * own. Editing happens on the settings form, and this reflects it.
 */
export function SequencePlan({
  settings,
  className,
}: {
  settings: SocialSequenceSettings;
  className?: string;
}) {
  const steps = socialPlanSteps(settings);

  return (
    <section className={cn("rounded-xl border border-line bg-surface p-5 shadow-xs", className)}>
      <h3 className="text-[13px] font-semibold text-content">What happens to each prospect</h3>
      <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-relaxed text-content-muted">
        {socialPlanSummary(settings)} Every step re-checks suppression, quiet hours and the
        account&rsquo;s limits in the moment before it runs — so this is the plan, not a promise.
      </p>

      <ol className="mt-5 space-y-0">
        {steps.map((step, index) => (
          <li key={step.position}>
            {step.after && (
              <div className="flex items-center gap-2 py-1.5 pl-4 text-[11.5px] text-content-subtle">
                <ArrowDown aria-hidden className="size-3" />
                <Clock aria-hidden className="size-3" />
                <span>{step.after}</span>
              </div>
            )}
            <StepCard step={step} first={index === 0} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Returns the rendered icon rather than the component behind it.
 *
 * Binding the component to a local (`const Icon = iconFor(step)`) and rendering
 * `<Icon />` reads naturally but trips `react-hooks/static-components`: the
 * linter cannot see that the returned reference is one of a fixed set, so it
 * treats it as a component defined during render — which would reset its state
 * on every pass. Returning the element sidesteps the question entirely, and
 * these icons carry no state to lose.
 */
function stepIcon(step: PlanStep) {
  const className = "size-3.5";
  if (step.channel === "EMAIL") return <AtSign className={className} />;
  if (step.title.startsWith("View")) return <Eye className={className} />;
  if (step.title.startsWith("Send a connection")) return <UserPlus className={className} />;
  if (step.title.startsWith("They accept")) return <Handshake className={className} />;
  if (step.title.startsWith("Withdraw")) return <UserMinus className={className} />;
  if (step.title.startsWith("Send the first")) return <Send className={className} />;
  return <MessageSquare className={className} />;
}

function StepCard({ step, first }: { step: PlanStep; first: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-3",
        // A conditional step is drawn differently on purpose: it is the branch
        // a customer most often does not realise exists, and making it look
        // identical to the main line hides that.
        step.conditional
          ? "border-dashed border-line-strong bg-surface-sunken/50"
          : "border-line bg-surface-subtle",
        first && "mt-0",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          step.channel === "EMAIL"
            ? "bg-accent-100 text-content-accent"
            : "bg-info-100 text-info-700",
        )}
      >
        {stepIcon(step)}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-content">{step.title}</span>

          {step.waitsOnRecipient && (
            // Named explicitly. A customer reading a sequence assumes every gap
            // is a delay somebody chose, and this one is the platform's.
            <span className="rounded-full bg-warning-50 px-1.5 py-0.5 text-[10.5px] font-medium text-warning-700">
              Their move, not ours
            </span>
          )}
          {step.conditional && (
            <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-content-muted">
              Only if needed
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-content-muted">{step.detail}</p>
      </div>
    </div>
  );
}
