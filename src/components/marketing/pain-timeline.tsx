import { Section, SectionHeading } from "./section";
import { cn } from "@/lib/cn";

type Entry = { time: string; text: string };

const WITHOUT: Entry[] = [
  { time: "10:32", text: "Meta lead submitted" },
  { time: "11:55", text: "Business notices lead" },
  { time: "12:10", text: "Business sends first message" },
  { time: "12:14", text: "Customer: “Already booked someone”" },
];

const WITH: Entry[] = [
  { time: "10:32", text: "Meta lead submitted" },
  { time: "10:32", text: "First message sent" },
  { time: "10:34", text: "Customer replies" },
  { time: "10:37", text: "Qualification complete" },
  { time: "10:40", text: "Booking link sent" },
];

function Timeline({
  title,
  caption,
  entries,
  tone,
}: {
  title: string;
  caption: string;
  entries: Entry[];
  tone: "danger" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface p-6 shadow-xs sm:p-7",
        tone === "danger" ? "border-danger-100" : "border-success-100",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            tone === "danger" ? "bg-danger-500" : "bg-success-500",
          )}
        />
        <h3 className="text-[15px] font-semibold text-content">{title}</h3>
      </div>
      <p className="mt-1.5 text-[13px] text-content-muted">{caption}</p>

      <ol className="mt-6 space-y-0">
        {entries.map((entry, index) => {
          const last = index === entries.length - 1;
          return (
            <li key={`${entry.time}-${entry.text}`} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full border-2 bg-surface",
                    tone === "danger"
                      ? "border-danger-500"
                      : "border-success-500",
                  )}
                />
                {!last && (
                  <span
                    aria-hidden
                    className={cn(
                      "w-px flex-1",
                      tone === "danger" ? "bg-danger-100" : "bg-success-100",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0", last ? "pb-0" : "pb-6")}>
                <p className="lr-tabular text-[12px] font-semibold text-content-muted">
                  {entry.time}
                </p>
                <p className="mt-0.5 text-[14px] text-content">{entry.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function PainTimeline() {
  return (
    <Section id="cost-of-delay" tone="sunken">
      <SectionHeading
        eyebrow="The cost of delay"
        title="Your ad spend does not fail at the click. It fails at the reply."
        description="A lead that waits ninety minutes has usually spoken to someone else. The same enquiry, handled two ways."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Timeline
          tone="danger"
          title="Without ClientTurn"
          caption="Manual follow-up, whenever someone gets to it."
          entries={WITHOUT}
        />
        <Timeline
          tone="success"
          title="With ClientTurn"
          caption="Automatic follow-up the moment the form is submitted."
          entries={WITH}
        />
      </div>

      <p className="mt-8 text-[13px] text-content-muted">
        Timings shown are an illustration of the configured product behaviour,
        not measured customer results.
      </p>
    </Section>
  );
}
