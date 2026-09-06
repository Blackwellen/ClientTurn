/**
 * One-shot repair for src/lib/ai/prompts.ts.
 *
 * The file contains double-quoted string literals with REAL newlines inside
 * them where the escape `\n` was intended:
 *
 *     "...they will review before anything is spent.
 *
 *  " +
 *
 * which is TS1002 (unterminated string literal) and blocks the whole typecheck
 * and build. This scans character by character, tracking whether it is inside a
 * string literal, and rewrites a raw newline that occurs *inside* one into the
 * two-character escape — preserving the intended prompt text exactly, including
 * the blank line that was meant to be a paragraph break.
 *
 * Line structure outside string literals is untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/lib/ai/prompts.ts";
const source = readFileSync(path, "utf8");

let out = "";
let quote = null; // the character that opened the current string, or null
let repairs = 0;

for (let i = 0; i < source.length; i += 1) {
  const char = source[i];
  const previous = source[i - 1];

  if (quote) {
    // An escaped character is copied verbatim, including \" and \\.
    if (previous === "\\" && !isEscapedEscape(source, i - 1)) {
      out += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      out += char;
      continue;
    }

    if (char === "\n") {
      // The bug. Emit the escape instead of ending the line.
      out += "\\n";
      repairs += 1;
      continue;
    }

    if (char === "\r") continue;

    out += char;
    continue;
  }

  // Outside a string: only ' and " open one. Backticks are left alone because a
  // template literal may legitimately span lines.
  if ((char === '"' || char === "'") && previous !== "\\") {
    quote = char;
  }
  out += char;
}

if (quote) {
  throw new Error(`Unbalanced ${quote} — refusing to write a file that is still broken.`);
}

/** True when the backslash at `index` is itself escaped (`\\`). */
function isEscapedEscape(text, index) {
  let count = 0;
  for (let i = index; i >= 0 && text[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 0;
}

writeFileSync(path, out);
console.log(`Repaired ${repairs} raw newline(s) inside string literals in ${path}`);
