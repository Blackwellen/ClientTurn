import { BarChart3, Clock, ListChecks, OctagonX, Repeat2 } from "lucide-react";
import { Section, SectionHeading } from "./section";

const REASONS = [
  {
    icon: Clock,
    title: "Fast first response",
    body: "The gap between the form submission and your first message is where enquiries are lost. ClientTurn closes it to seconds, permanently.",
  },
  {
    icon: Repeat2,
    title: "Consistent follow-up",
    body: "Most enquiries need more than one attempt. The sequence runs the same way for every lead whether you are on a roof, on holiday or flat out.",
  },
  {
    icon: ListChecks,
    title: "Structured questions",
    body: "Every lead is asked the same questions in the same order, so two leads are actually comparable and nobody gets missed out.",
  },
  {
    icon: OctagonX,
    title: "Clear stop conditions",
    body: "Replies, opt-outs, quiet hours and attempt limits are checked immediately before every send. Nobody is chased after they said no.",
  },
  {
    icon: BarChart3,
    title: "Visible conversion attribution",
    body: "Every booking traces back to the campaign and form it came from, so you can see which ads produce work rather than which produce leads.",
  },
] as const;

export function WhyItWorks() {
  return (
    <Section id="why-it-works" tone="sunken">
      <SectionHeading
        eyebrow="Why it works"
        title="Business logic, not clever guessing."
        description="There is no black box making promises on your behalf. Rules you set decide what happens, and anything ambiguous goes to a person."
      />

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {REASONS.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex gap-4 rounded-xl border border-line bg-surface p-6 shadow-xs"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent">
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-content">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-content-secondary">
                {body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
