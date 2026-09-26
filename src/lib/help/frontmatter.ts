/**
 * A deliberately small YAML-frontmatter parser for help articles.
 *
 * Help articles use a fixed, documented subset of YAML (see
 * `content/help/README.md`): scalar strings, numbers, dates, inline or block
 * lists of strings, and one block list of small objects (`screenshots`). A full
 * YAML library would accept far more than the contract allows — anchors, tags,
 * multi-document streams — and every extra feature is a way for an article to
 * be valid YAML and still wrong. So this parses exactly the subset and reports
 * anything else as a problem instead of guessing.
 *
 * Pure: no imports, no I/O. The loader and the tests both call it.
 */

export type FrontmatterValue =
  | string
  | number
  | string[]
  | Record<string, string>[];

export type ParsedFrontmatter = {
  data: Record<string, FrontmatterValue>;
  body: string;
  problems: string[];
};

const FENCE = /^---\s*$/;

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const problems: string[] = [];

  if (!FENCE.test(lines[0] ?? "")) {
    return { data: {}, body: text, problems: ["missing frontmatter: the file must start with ---"] };
  }

  const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (end === -1) {
    return { data: {}, body: text, problems: ["unterminated frontmatter: no closing ---"] };
  }

  const header = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  const data: Record<string, FrontmatterValue> = {};

  let index = 0;
  while (index < header.length) {
    const line = header[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(line);
    if (!match) {
      problems.push(`line ${index + 2}: expected "key: value", got "${line.trim()}"`);
      index += 1;
      continue;
    }

    const key = match[1];
    const rest = match[2].trim();
    if (key in data) problems.push(`duplicate key "${key}"`);

    if (rest !== "") {
      data[key] = parseScalarOrInlineList(rest, key, problems);
      index += 1;
      continue;
    }

    // A block value: every following indented line belongs to it.
    const block: string[] = [];
    index += 1;
    while (index < header.length && (/^\s+\S/.test(header[index]) || !header[index].trim())) {
      if (header[index].trim()) block.push(header[index]);
      index += 1;
    }
    data[key] = parseBlockList(block, key, problems);
  }

  return { data, body, problems };
}

function parseScalarOrInlineList(
  raw: string,
  key: string,
  problems: string[],
): FrontmatterValue {
  if (raw.startsWith("[")) {
    if (!raw.endsWith("]")) {
      problems.push(`"${key}": inline list is not closed with ]`);
      return [];
    }
    return splitInlineList(raw.slice(1, -1)).map((item) => unquote(item, key, problems));
  }
  const value = unquote(raw, key, problems);
  if (!/^["']/.test(raw) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Splits `a, "b, c", 'd'` on commas outside quotes. */
function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"' && i + 1 < inner.length) {
        current += inner[i + 1];
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items.filter((item) => item !== "");
}

function unquote(raw: string, key: string, problems: string[]): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) {
      problems.push(`"${key}": unterminated double-quoted string`);
      return value.slice(1);
    }
    return value
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_, char: string) =>
        char === "n" ? "\n" : char === "t" ? "\t" : char,
      );
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      problems.push(`"${key}": unterminated single-quoted string`);
      return value.slice(1);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  // A bare value: strip a trailing ` # comment`.
  return value.replace(/\s+#.*$/, "");
}

/**
 * A block list is either `- scalar` items or `- key: value` objects whose
 * further keys are indented beneath the dash.
 */
function parseBlockList(
  block: string[],
  key: string,
  problems: string[],
): string[] | Record<string, string>[] {
  if (block.length === 0) return [];

  const items: { head: string; more: string[] }[] = [];
  for (const line of block) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed === "-") {
      items.push({ head: trimmed.slice(1).trim(), more: [] });
    } else if (items.length > 0) {
      items[items.length - 1].more.push(trimmed);
    } else {
      problems.push(`"${key}": expected a list item starting with "- "`);
      return [];
    }
  }

  const isObjectList = items.some((item) => /^[A-Za-z_][A-Za-z0-9_]*:/.test(item.head) || item.more.length > 0);

  if (!isObjectList) {
    return items.map((item) => unquote(item.head, key, problems));
  }

  return items.map((item) => {
    const record: Record<string, string> = {};
    for (const pair of [item.head, ...item.more]) {
      if (!pair) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(pair);
      if (!match) {
        problems.push(`"${key}": expected "field: value" in a list item, got "${pair}"`);
        continue;
      }
      record[match[1]] = unquote(match[2].trim(), `${key}.${match[1]}`, problems);
    }
    return record;
  });
}
