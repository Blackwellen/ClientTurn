import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  filterOptions,
  initialActiveIndex,
  moveActiveIndex,
  resolveListKey,
  typeaheadMatch,
  type ListOption,
} from "../src/components/ui/listbox-logic.ts";
import {
  computeFloatingPosition,
  isInsideFloatingLayer,
  type Rect,
} from "../src/components/ui/floating.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const OPTIONS: ListOption[] = [
  { value: "a", label: "Aberdeen" },
  { value: "b", label: "Bath" },
  { value: "br", label: "Bristol", disabled: true },
  { value: "bri", label: "Brighton" },
  { value: "c", label: "Cardiff" },
  { value: "d", label: "Derby", disabled: true },
];

/* ------------------------------------------------------------ keyboard */

describe("select keyboard contract", () => {
  test("closed: arrows, Enter and Space open at the selection; Home/End at the ends", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      assert.deepEqual(resolveListKey({ open: false, key }), { type: "open", to: "selected" });
    }
    assert.deepEqual(resolveListKey({ open: false, key: "Home" }), { type: "open", to: "first" });
    assert.deepEqual(resolveListKey({ open: false, key: "End" }), { type: "open", to: "last" });
  });

  test("closed: a printable key starts typeahead, a modifier chord does nothing", () => {
    assert.deepEqual(resolveListKey({ open: false, key: "b" }), { type: "typeahead", char: "b" });
    assert.deepEqual(resolveListKey({ open: false, key: "b", ctrlKey: true }), { type: "none" });
    assert.deepEqual(resolveListKey({ open: false, key: "Tab" }), { type: "none" });
  });

  test("open: movement, choose, close and tab", () => {
    assert.deepEqual(resolveListKey({ open: true, key: "ArrowDown" }), { type: "move", to: "next" });
    assert.deepEqual(resolveListKey({ open: true, key: "ArrowUp" }), { type: "move", to: "prev" });
    assert.deepEqual(resolveListKey({ open: true, key: "PageDown" }), { type: "move", to: "pageDown" });
    assert.deepEqual(resolveListKey({ open: true, key: "Home" }), { type: "move", to: "first" });
    assert.deepEqual(resolveListKey({ open: true, key: "Enter" }), { type: "choose" });
    assert.deepEqual(resolveListKey({ open: true, key: " " }), { type: "choose" });
    assert.deepEqual(resolveListKey({ open: true, key: "Escape" }), { type: "close" });
    assert.deepEqual(resolveListKey({ open: true, key: "Tab" }), { type: "tab" });
    assert.deepEqual(resolveListKey({ open: true, key: "ArrowUp", altKey: true }), {
      type: "chooseAndClose",
    });
  });

  test("Space extends a typeahead buffer instead of choosing", () => {
    assert.deepEqual(resolveListKey({ open: true, key: " ", typing: true }), {
      type: "typeahead",
      char: " ",
    });
  });

  test("in a search box, Home/End/Space/characters edit text", () => {
    for (const key of ["Home", "End", " ", "x"]) {
      assert.deepEqual(resolveListKey({ open: true, key, searching: true }), { type: "none" });
    }
    assert.deepEqual(resolveListKey({ open: true, key: "ArrowDown", searching: true }), {
      type: "move",
      to: "next",
    });
  });
});

describe("active option movement", () => {
  test("skips disabled options and never wraps", () => {
    assert.equal(moveActiveIndex(OPTIONS, 1, "next"), 3); // Bath -> (Bristol disabled) -> Brighton
    assert.equal(moveActiveIndex(OPTIONS, 3, "prev"), 1);
    assert.equal(moveActiveIndex(OPTIONS, 4, "next"), 4); // Derby disabled, stays on Cardiff
    assert.equal(moveActiveIndex(OPTIONS, 0, "prev"), 0);
  });

  test("Home/End land on the first/last enabled option", () => {
    assert.equal(moveActiveIndex(OPTIONS, 2, "first"), 0);
    assert.equal(moveActiveIndex(OPTIONS, 0, "last"), 4);
  });

  test("page moves clamp to the ends", () => {
    assert.equal(moveActiveIndex(OPTIONS, 0, "pageDown"), 4);
    assert.equal(moveActiveIndex(OPTIONS, 4, "pageUp"), 0);
  });

  test("no active option starts from the relevant end; empty lists return -1", () => {
    assert.equal(moveActiveIndex(OPTIONS, -1, "next"), 0);
    assert.equal(moveActiveIndex(OPTIONS, -1, "prev"), 4);
    assert.equal(moveActiveIndex([], 0, "next"), -1);
  });

  test("opening activates the selected option, or the first enabled one", () => {
    assert.equal(initialActiveIndex(OPTIONS, "c", "selected"), 4);
    assert.equal(initialActiveIndex(OPTIONS, "br", "selected"), 0); // disabled selection
    assert.equal(initialActiveIndex(OPTIONS, undefined, "last"), 4);
  });
});

describe("typeahead", () => {
  test("a multi-character buffer matches from the current option inclusive", () => {
    assert.equal(typeaheadMatch(OPTIONS, "bri", 0), 3); // skips disabled Bristol
    assert.equal(typeaheadMatch(OPTIONS, "bri", 3), 3); // stays put once there
  });

  test("a single or repeated character cycles through matches", () => {
    assert.equal(typeaheadMatch(OPTIONS, "b", 0), 1);
    assert.equal(typeaheadMatch(OPTIONS, "b", 1), 3);
    assert.equal(typeaheadMatch(OPTIONS, "bb", 3), 1); // wraps
  });

  test("case and accents are ignored; no match returns -1", () => {
    const opts: ListOption[] = [{ value: "z", label: "Zürich" }];
    assert.equal(typeaheadMatch(opts, "zu", -1), 0);
    assert.equal(typeaheadMatch(OPTIONS, "q", 0), -1);
  });
});

describe("search filtering", () => {
  test("every word must match label, description or group", () => {
    const tz: ListOption[] = [
      { value: "Europe/London", label: "London", group: "Europe" },
      { value: "America/New_York", label: "New York", group: "America" },
    ];
    assert.deepEqual(
      filterOptions(tz, "europe lon").map((o) => o.value),
      ["Europe/London"],
    );
    assert.equal(filterOptions(tz, "  ").length, 2);
    assert.equal(filterOptions(tz, "paris").length, 0);
  });
});

/* ------------------------------------------------------------ placement */

function rect(top: number, left: number, width: number, height: number): Rect {
  return { top, left, width, height, bottom: top + height, right: left + width };
}

const VIEWPORT = { width: 1280, height: 800 };

describe("floating layer placement", () => {
  test("opens below when it fits", () => {
    const pos = computeFloatingPosition({
      anchor: rect(100, 50, 200, 36),
      floating: { width: 200, height: 240 },
      viewport: VIEWPORT,
    });
    assert.equal(pos.placement, "bottom");
    assert.equal(pos.top, 140); // 136 + 4 offset
    assert.equal(pos.left, 50);
  });

  test("flips above near the bottom edge when there is more room above", () => {
    const pos = computeFloatingPosition({
      anchor: rect(700, 50, 200, 36),
      floating: { width: 200, height: 240 },
      viewport: VIEWPORT,
    });
    assert.equal(pos.placement, "top");
    assert.equal(pos.top, 700 - 4 - 240);
  });

  test("stays below and scrolls when below still has more room than above", () => {
    const pos = computeFloatingPosition({
      anchor: rect(300, 50, 200, 36),
      floating: { width: 200, height: 900 },
      viewport: VIEWPORT,
      maxHeight: 900,
    });
    assert.equal(pos.placement, "bottom");
    assert.equal(pos.maxHeight, 800 - 336 - 4 - 8);
  });

  test("respects the max height cap", () => {
    const pos = computeFloatingPosition({
      anchor: rect(10, 10, 100, 30),
      floating: { width: 100, height: 2000 },
      viewport: VIEWPORT,
      maxHeight: 320,
    });
    assert.equal(pos.maxHeight, 320);
  });

  test("end alignment lines the right edges up, and clamps inside the viewport", () => {
    const end = computeFloatingPosition({
      anchor: rect(100, 1000, 100, 30),
      floating: { width: 240, height: 100 },
      viewport: VIEWPORT,
      align: "end",
    });
    assert.equal(end.left, 1100 - 240);

    const clamped = computeFloatingPosition({
      anchor: rect(100, 1200, 70, 30),
      floating: { width: 240, height: 100 },
      viewport: VIEWPORT,
    });
    assert.equal(clamped.left, 1280 - 8 - 240);

    const leftEdge = computeFloatingPosition({
      anchor: rect(100, 2, 40, 30),
      floating: { width: 240, height: 100 },
      viewport: VIEWPORT,
      align: "end",
    });
    assert.equal(leftEdge.left, 8);
  });

  test("a listbox is at least as wide as its trigger, never wider than the viewport", () => {
    const wide = computeFloatingPosition({
      anchor: rect(100, 20, 300, 36),
      floating: { width: 120, height: 100 },
      viewport: VIEWPORT,
      matchAnchorWidth: true,
    });
    assert.equal(wide.width, 300);

    const phone = computeFloatingPosition({
      anchor: rect(100, 16, 328, 36),
      floating: { width: 600, height: 100 },
      viewport: { width: 360, height: 640 },
      matchAnchorWidth: true,
    });
    assert.equal(phone.width, 360 - 16);
    assert.equal(phone.left, 8);
  });

  test("outside-click checks recognise portalled layers", () => {
    const inside = { closest: (sel: string) => (sel === "[data-lr-floating]" ? {} : null) };
    const outside = { closest: () => null };
    assert.equal(isInsideFloatingLayer(inside as unknown as EventTarget), true);
    assert.equal(isInsideFloatingLayer(outside as unknown as EventTarget), false);
    assert.equal(isInsideFloatingLayer(null), false);
  });
});

/* ---------------------------------------------------------- wiring */

describe("select primitive wiring", () => {
  test("form.tsx re-exports the custom Select; the chevron is a token, not a hard-coded colour", () => {
    const form = source("../src/components/ui/form.tsx");
    assert.match(form, /export \{ Select, Combobox \} from "\.\/select"/);
    assert.doesNotMatch(form, /%236b7a8f/);
    const css = source("../src/app/globals.css");
    assert.match(css, /--lr-select-chevron/);
  });

  test("Select keeps a hidden native select for forms and dispatches a real change event", () => {
    const select = source("../src/components/ui/select.tsx");
    assert.match(select, /role="listbox"/);
    assert.match(select, /role="option"/);
    assert.match(select, /aria-activedescendant/);
    assert.match(select, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
    assert.match(select, /createPortal/);
  });
});
