import { wrapUntrustedContent } from "./safety";

/**
 * Builds the compact context block sent alongside a task's system prompt.
 * Callers pass already-fetched, already-scoped data — this module does no
 * database I/O of its own, so it stays reusable across inbound-reply,
 * qualification and reactivation callers without coupling to their queries.
 *
 * Token discipline (§5, §62): only the business facts relevant to the task,
 * only the next unresolved question, only the most recent messages — never
 * the full historical record.
 */

export type BusinessFacts = {
  name: string;
  description?: string | null;
  services: { id: string; name: string; description?: string | null }[];
  serviceAreas?: string[];
  businessHours?: string | null;
  tone: "professional" | "friendly" | "direct";
  replyLength: "short" | "normal";
  handoverInstruction?: string | null;
  bookingUrl?: string | null;
};

export type QualificationContext = {
  nextQuestion?: { id: string; text: string; responseType: string; options?: string[] } | null;
  answeredSoFar?: { question: string; value: string }[];
};

export type ConversationTurn = { role: "lead" | "business"; body: string };

export type BuildContextInput = {
  business: BusinessFacts;
  qualification?: QualificationContext;
  recentMessages: ConversationTurn[];
  /** How many trailing messages to include — keep this small. */
  maxMessages?: number;
};

function formatBusinessBlock(business: BusinessFacts): string {
  const lines = [
    `Business: ${business.name}`,
    business.description ? `About: ${business.description}` : null,
    business.services.length
      ? `Services: ${business.services.map((s) => s.name).join(", ")}`
      : null,
    business.serviceAreas?.length ? `Service areas: ${business.serviceAreas.join(", ")}` : null,
    business.businessHours ? `Hours: ${business.businessHours}` : null,
    `Tone: ${business.tone}. Reply length: ${business.replyLength}.`,
    business.handoverInstruction ? `Handover rule: ${business.handoverInstruction}` : null,
    business.bookingUrl ? `Booking link: ${business.bookingUrl}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function formatQualificationBlock(qualification?: QualificationContext): string | null {
  if (!qualification) return null;
  const lines: string[] = [];
  if (qualification.answeredSoFar?.length) {
    lines.push(
      "Answered so far: " +
        qualification.answeredSoFar.map((a) => `${a.question} = ${a.value}`).join("; "),
    );
  }
  if (qualification.nextQuestion) {
    const options = qualification.nextQuestion.options?.length
      ? ` (options: ${qualification.nextQuestion.options.join(", ")})`
      : "";
    lines.push(`Next unresolved question: ${qualification.nextQuestion.text}${options}`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function buildContext(input: BuildContextInput): string {
  const maxMessages = input.maxMessages ?? 6;
  const recent = input.recentMessages.slice(-maxMessages);

  const conversationBlock = recent.length
    ? recent
        .map((turn) =>
          turn.role === "lead"
            ? `Lead: ${wrapUntrustedContent(turn.body)}`
            : `Business: ${turn.body}`,
        )
        .join("\n")
    : "No prior messages.";

  const blocks = [
    formatBusinessBlock(input.business),
    formatQualificationBlock(input.qualification),
    `Recent conversation:\n${conversationBlock}`,
  ].filter((block): block is string => Boolean(block));

  return blocks.join("\n\n");
}
