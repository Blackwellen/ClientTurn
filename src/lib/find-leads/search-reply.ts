/**
 * The chat bubble for one Search Agent turn. Pure.
 *
 * The model returns a reply and, separately, a clarifying question, and it
 * often puts the question in the reply as well. Appending it unconditionally
 * printed it twice ("What area should I target?\n\nWhat area should I
 * target?", the owner's own session, 2026-09-08).
 */
function comparable(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function composeSearchReply(reply: string, question: string | null | undefined): string {
  const body = reply.trim();
  const ask = question?.trim();
  if (!ask) return body;
  if (!body) return ask;
  const q = comparable(ask);
  if (q && comparable(body).includes(q)) return body;
  return `${body}\n\n${ask}`;
}
