/**
 * Copilot's final prose, made safe to show as plain text.
 *
 * Markdown markers are removed (the panel renders text, not markdown), and a
 * paragraph the model repeated back to back is shown once. The model
 * sometimes emits the same refusal twice ("I can't pause campaigns from here.
 * ... I can't pause campaigns from here. ..."), which read as a glitch in the
 * panel (surface QA 2026-09-30). Pure, so it is unit-tested.
 */
export function cleanCopilotReply(content: string | null): string {
  if (!content) return "I could not work that out.";
  const stripped = content
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .trim();

  const lines = stripped.split(/\r?\n/);
  const kept: string[] = [];
  let lastText: string | null = null;
  for (const line of lines) {
    const text = line.trim();
    // Blank lines are kept (they separate paragraphs) but do not reset the
    // comparison, so "A\n\nA" collapses as well as "A\nA".
    if (text === "") {
      kept.push(line);
      continue;
    }
    if (text === lastText) continue;
    kept.push(line);
    lastText = text;
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
