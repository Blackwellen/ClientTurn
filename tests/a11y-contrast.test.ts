import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Colour-contrast guard for the design tokens (accessibility audit
 * 2026-09-28, docs/ACCESSIBILITY_AUDIT_2026-09-28.md).
 *
 * Reads the real token values out of globals.css and the marketing
 * stylesheet, resolves `var()` references within each scope, and computes
 * WCAG 2.x contrast ratios for every pairing the product actually paints:
 *
 *   text  >= 4.5:1  (SC 1.4.3)
 *   focus indicators, control boundaries and state fills >= 3:1 (SC 1.4.11)
 *
 * A token change that breaks a pairing fails here with the measured ratio,
 * before it reaches a page. Pure: no DOM, no browser.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const GLOBALS = read("src/app/globals.css");
const MARKETING = read("src/app/(marketing)/clientturn.css");

/** `--name: value;` declarations of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `no "${selector}" rule found`);
  const out = new Map<string, string>();
  const body = match[2].replace(/\/\*[\s\S]*?\*\//g, "");
  for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(decl[1], decl[2].trim());
  return out;
}

const ROOT_TOKENS = block(GLOBALS, ":root");

/** Resolves a token to a hex colour, looking in `scope` first and then :root. */
function resolve(name: string, scope: Map<string, string> = new Map(), depth = 0): string {
  assert.ok(depth < 12, `var() cycle resolving ${name}`);
  const raw = scope.get(name) ?? ROOT_TOKENS.get(name);
  assert.ok(raw, `token ${name} is not defined`);
  const ref = /^var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)$/.exec(raw);
  if (ref) return resolve(ref[1], scope, depth + 1);
  assert.match(raw, /^#[0-9a-f]{6}$/i, `${name} is not a plain hex colour: ${raw}`);
  return raw.toLowerCase();
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground against every background must reach `min`. */
function expectAll(
  label: string,
  fgs: string[],
  bgs: string[],
  min: number,
  scope?: Map<string, string>,
) {
  const failures: string[] = [];
  for (const fg of fgs) {
    for (const bg of bgs) {
      const f = fg.startsWith("#") ? fg : resolve(fg, scope);
      const b = bg.startsWith("#") ? bg : resolve(bg, scope);
      const ratio = contrast(f, b);
      if (ratio < min) failures.push(`${fg} (${f}) on ${bg} (${b}) = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `${label}: below ${min}:1`);
}

describe("contrast maths", () => {
  test("matches the WCAG reference values", () => {
    assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
    assert.equal(contrast("#ffffff", "#ffffff").toFixed(2), "1.00");
    // The brand pairings quoted in the audit document.
    assert.equal(contrast("#b7f34a", "#ffffff").toFixed(2), "1.32");
    assert.equal(contrast("#b7f34a", "#0b1020").toFixed(2), "14.36");
  });
});

describe("brand palette", () => {
  test("lime and soft lime are never text on a light surface; lime text only sits on dark", () => {
    // Recorded, not asserted as a pass: these ratios are why the rule exists.
    assert.ok(contrast(resolve("--ct-lime"), resolve("--ct-white")) < 3);
    assert.ok(contrast(resolve("--ct-lime-soft"), resolve("--ct-white")) < 3);
    // The light theme's text accent is a dark lime-family green, not lime.
    assert.notEqual(resolve("--lr-text-accent"), resolve("--ct-lime"));
    expectAll("lime on the dark grounds", ["--ct-lime"], ["--ct-midnight", "#050814", "#020409"], 4.5);
  });

  test("midnight text reads on lime, soft lime, cloud and white", () => {
    expectAll(
      "midnight",
      ["--ct-midnight"],
      ["--ct-lime", "--ct-lime-soft", "--ct-cloud", "--ct-white", "--lr-primary-hover", "--lr-primary-active"],
      4.5,
    );
  });
});

describe("light app surfaces (:root)", () => {
  const surfaces = ["--lr-neutral-0", "--lr-neutral-50", "--lr-neutral-100"]; // white, cloud, surface-sunken

  test("the text ramp clears 4.5:1 on every surface it is painted on", () => {
    expectAll(
      "text ramp",
      ["--lr-text", "--lr-text-secondary", "--lr-text-muted", "--lr-text-subtle", "--lr-text-accent"],
      surfaces,
      4.5,
    );
  });

  test("status -600 steps are legible as text on white, cloud, sunken and their own tint", () => {
    for (const tone of ["success", "warning", "danger", "info"]) {
      expectAll(`${tone}-600`, [`--lr-${tone}-600`], [...surfaces, `--lr-${tone}-50`], 4.5);
    }
  });

  test("badge text (-700 on -50) and accent text on accent tints", () => {
    for (const tone of ["success", "warning", "danger", "info", "purple"]) {
      expectAll(`${tone} badge`, [`--lr-${tone}-700`], [`--lr-${tone}-50`], 4.5);
    }
    expectAll("accent badge", ["--lr-text-accent"], ["--lr-accent-50", "--lr-accent-100"], 4.5);
  });

  test("white text on filled buttons and the current page chip", () => {
    expectAll(
      "white on fills",
      ["--lr-neutral-0"],
      ["--lr-accent-600", "--lr-danger-600", "--lr-success-600"],
      4.5,
    );
  });

  test("focus indicators and control states clear 3:1 against the surface", () => {
    expectAll(
      "focus ring, field focus border, switch tracks",
      ["--lr-text-accent", "--lr-focus-border", "--lr-switch-off", "--lr-accent-600", "--lr-success-600"],
      surfaces,
      3,
    );
  });
});

describe("dark chrome inside the app", () => {
  const rail = ["#090e14", "#0a1017", "#080d13"]; // --ct-shell-sidebar-from/via/to

  test("the rail remaps the focus/accent colour to lime", () => {
    const railScope = block(GLOBALS, ".ct-rail,\n.ct-on-dark");
    assert.equal(resolve("--lr-text-accent", railScope), resolve("--ct-lime"));
    expectAll("rail focus", ["--lr-text-accent"], rail, 3, railScope);
  });

  test("rail text is legible", () => {
    expectAll("rail text", ["--ct-shell-text", "--ct-shell-text-muted", "--ct-lime"], rail, 4.5);
  });

  test(".ct-force-dark (auth / onboarding) text ramp", () => {
    const dark = block(GLOBALS, ".ct-force-dark");
    expectAll(
      "force-dark text",
      ["--lr-text", "--lr-text-secondary", "--lr-text-muted", "--lr-text-subtle", "--lr-text-accent"],
      ["--lr-bg", "--lr-surface", "--lr-surface-raised", "--lr-surface-sunken"],
      4.5,
      dark,
    );
    expectAll("force-dark field focus", ["--lr-focus-border"], ["--lr-surface", "--lr-surface-raised"], 3, dark);
  });

  test(".ct-auth text on its canvas and inputs", () => {
    const auth = block(GLOBALS, ".ct-auth");
    expectAll(
      "auth text",
      ["--auth-text", "--auth-text-muted", "--auth-text-secondary", "--auth-text-subtle", "--auth-eyebrow", "--auth-danger-text", "--auth-lime"],
      ["--auth-bg", "--auth-bg-raised", "--auth-input-bg"],
      4.5,
      auth,
    );
    expectAll("auth lime button text", ["--auth-on-lime"], ["--auth-lime", "--auth-lime-hover"], 4.5, auth);
  });
});

describe("public marketing canvas (.ct-marketing)", () => {
  const pub = block(MARKETING, ".ct-marketing");
  const grounds = ["--pub-bg", "--pub-bg-raised", "--pub-bg-elevated", "--pub-card", "--pub-card-hover"];

  test("text ramp, accent and remapped status text clear 4.5:1 on every public ground", () => {
    expectAll(
      "public text",
      [
        "--pub-text",
        "--pub-text-secondary",
        "--pub-text-muted",
        "--lr-text-subtle",
        "--lr-text-accent",
        "--lr-success-600",
        "--lr-warning-600",
        "--lr-danger-600",
        "--lr-info-600",
      ],
      grounds,
      4.5,
      pub,
    );
  });

  test("lime buttons carry dark ink", () => {
    expectAll("lime ink", ["--pub-lime-ink"], ["--pub-lime"], 4.5, pub);
  });

  test("focus indicators are lime on the dark canvas", () => {
    expectAll("public focus", ["--lr-text-accent", "--lr-focus-border"], grounds, 3, pub);
  });
});
