/**
 * Visual-regression capture and comparison for the designed public pages.
 *
 *   npm run test:visual            # capture, then diff against the baseline
 *   npm run test:visual:record     # replace the baseline with what ships now
 *
 * What is committed and what is not:
 *
 *   * `tests/visual/baseline/component--*.png` — the ten component crops. Small
 *     enough to live in the repo and specific enough to review in a diff.
 *   * full-page captures go to `.qa-shots/visual/` (git-ignored). They are for
 *     eyeballing a whole page; committing seventeen megabytes of them every
 *     time a heading moves is not a trade worth making.
 *
 * Everything is captured with `prefers-reduced-motion: reduce` so the entrance
 * animations are already finished. Without that the diff is dominated by
 * whichever frame the shutter caught.
 *
 * The comparison runs inside the browser: two PNGs are drawn to a canvas and
 * compared there, which keeps the whole harness free of image dependencies.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONSENT_SCRIPT, launch, open, sleep } from "./lib/headless-chrome.mjs";

const origin = process.env.E2E_ORIGIN ?? "http://127.0.0.1:3000";
const record = process.argv.includes("--record");
/**
 * Optional CSS appended to every page. Used to prove the harness is sensitive:
 * capture once without it and once with, and the diff must be non-zero and
 * confined to whatever the rule touches.
 */
const injectCss = process.argv.includes("--inject")
  ? process.argv[process.argv.indexOf("--inject") + 1]
  : "";

const BASELINE = "tests/visual/baseline";
const CURRENT = ".qa-shots/visual/current";
const DIFF = ".qa-shots/visual/diff";

/** Anti-aliasing moves a channel a point or two between runs. */
const TOLERANCE = 6;
/** Share of differing pixels that counts as a regression. */
const THRESHOLD = 0.0002;

const VIEWPORTS = [
  { name: "1440x900", w: 1440, h: 900 },
  { name: "1366x768", w: 1366, h: 768 },
  { name: "1024x768", w: 1024, h: 768 },
  { name: "768x1024", w: 768, h: 1024 },
  { name: "390x844", w: 390, h: 844 },
  { name: "844x390", w: 844, h: 390 },
];

const PAGES = ["/product/find-leads", "/affiliates"];

const COMPONENTS = [
  { page: "/product/find-leads", name: "hero", sel: ".fl-appframe" },
  { page: "/product/find-leads", name: "sourcing", sel: ".fl-cards > :nth-child(1)" },
  { page: "/product/find-leads", name: "prospects", sel: ".fl-cards > :nth-child(2)" },
  { page: "/product/find-leads", name: "scoring", sel: ".fl-cards > :nth-child(3)" },
  { page: "/product/find-leads", name: "intent", sel: "#campaigns .fl-cards > :nth-child(1)" },
  { page: "/product/find-leads", name: "campaign", sel: "#campaigns .fl-cards > :nth-child(2)" },
  { page: "/product/find-leads", name: "promotion", sel: "#campaigns .fl-cards > :nth-child(3)" },
  { page: "/product/find-leads", name: "analytics", sel: "#analytics .fl-split" },
  { page: "/affiliates", name: "affiliate-hero", sel: ".afp-hero-grid" },
  { page: "/affiliates", name: "affiliate-benefits", sel: ".afp-benefits" },
];

const initScript = `
  ${CONSENT_SCRIPT}
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent =
      "html{scrollbar-width:none!important}" +
      "html::-webkit-scrollbar{display:none!important}" +
      ${JSON.stringify(injectCss)};
    document.head.appendChild(style);
  });
`;

mkdirSync(CURRENT, { recursive: true });
mkdirSync(DIFF, { recursive: true });
mkdirSync(BASELINE, { recursive: true });
for (const dir of [CURRENT, DIFF]) {
  for (const file of readdirSync(dir)) rmSync(join(dir, file));
}

const browser = await launch({ reducedMotion: true });

/**
 * One fresh tab per capture. A single tab accumulates enough state across a
 * dozen full-page screenshots to crash its renderer, and a crashed renderer
 * screenshots as Chrome's "this page couldn't load" screen.
 */
async function capture(path, { width, height, clipFor }) {
  const page = await browser.page({ initScript });
  try {
    await open(page, origin + path, { path, width, height });

    let clip;
    if (clipFor) {
      const box = await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(clipFor)});
        if (!el) return null;
        window.scrollTo(0, 0);
        const r = el.getBoundingClientRect();
        return JSON.stringify({
          x: Math.max(0, Math.round(r.left + window.scrollX)),
          y: Math.max(0, Math.round(r.top + window.scrollY)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      })()`);
      if (!box) throw new Error(`selector matched nothing: ${clipFor}`);
      clip = { ...JSON.parse(box), scale: 1 };
      await sleep(300);
    }

    // `clip` is read in viewport space unless captureBeyondViewport is set,
    // and these cards are taller than the viewport. Page coordinates plus
    // captureBeyondViewport is the pairing that actually crops the element.
    const shot = await page.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      ...(clip && { clip }),
      fromSurface: true,
    });
    return Buffer.from(shot.data, "base64");
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------- capturing */

const componentShots = [];

for (const path of PAGES) {
  const slug = path.replace(/\W+/g, "-").replace(/^-|-$/g, "");
  for (const vp of VIEWPORTS) {
    const png = await capture(path, { width: vp.w, height: vp.h });
    writeFileSync(join(CURRENT, `page--${slug}--${vp.name}.png`), png);
    console.log(`captured page--${slug}--${vp.name}`);
  }
}

for (const component of COMPONENTS) {
  const png = await capture(component.page, {
    width: 1440,
    height: 1000,
    clipFor: component.sel,
  });
  const name = `component--${component.name}.png`;
  writeFileSync(join(CURRENT, name), png);
  componentShots.push(name);
  console.log(`captured component--${component.name}`);
}

/* -------------------------------------------------------------- recording */

if (record) {
  for (const file of readdirSync(BASELINE)) rmSync(join(BASELINE, file));
  for (const name of componentShots) {
    writeFileSync(join(BASELINE, name), readFileSync(join(CURRENT, name)));
  }
  browser.close();
  console.log(
    `\nbaseline recorded: ${componentShots.length} component crops in ${BASELINE}`,
  );
  console.log(`full-page captures for review: ${CURRENT}`);
  process.exit(0);
}

/* -------------------------------------------------------------- comparing */

const baselineFiles = readdirSync(BASELINE).filter((f) => f.endsWith(".png"));
if (baselineFiles.length === 0) {
  browser.close();
  console.error(
    `No baseline in ${BASELINE}. Record one with: npm run test:visual:record`,
  );
  process.exit(1);
}

/** Compares two PNGs on a canvas in the browser, and returns a diff mask. */
const comparer = await browser.page();
await comparer.send("Page.navigate", { url: "about:blank" });
await sleep(400);

async function compare(baselinePng, currentPng) {
  const result = await comparer.evaluate(`(async () => {
    const load = (b64) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = "data:image/png;base64," + b64;
    });
    const a = await load(${JSON.stringify(baselinePng.toString("base64"))});
    const b = await load(${JSON.stringify(currentPng.toString("base64"))});
    if (a.width !== b.width || a.height !== b.height) {
      return JSON.stringify({
        size: [a.width, a.height, b.width, b.height],
      });
    }

    const draw = (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c;
    };
    const ca = draw(a).getContext("2d").getImageData(0, 0, a.width, a.height);
    const cb = draw(b).getContext("2d").getImageData(0, 0, b.width, b.height);

    const mask = document.createElement("canvas");
    mask.width = a.width;
    mask.height = a.height;
    const md = mask.getContext("2d").createImageData(a.width, a.height);

    let changed = 0;
    let minX = a.width, minY = a.height, maxX = 0, maxY = 0;
    for (let i = 0; i < ca.data.length; i += 4) {
      const delta = Math.max(
        Math.abs(ca.data[i] - cb.data[i]),
        Math.abs(ca.data[i + 1] - cb.data[i + 1]),
        Math.abs(ca.data[i + 2] - cb.data[i + 2]),
      );
      if (delta > ${TOLERANCE}) {
        changed += 1;
        md.data[i] = 255;
        md.data[i + 1] = 0;
        md.data[i + 2] = 96;
        md.data[i + 3] = 255;
        const p = i / 4;
        const x = p % a.width;
        const y = (p - x) / a.width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    mask.getContext("2d").putImageData(md, 0, 0);

    return JSON.stringify({
      share: changed / (a.width * a.height),
      region: changed ? [minX, minY, maxX, maxY] : null,
      mask: changed ? mask.toDataURL("image/png").split(",")[1] : null,
    });
  })()`);
  return JSON.parse(result);
}

let failures = 0;
const width = Math.max(...baselineFiles.map((f) => f.length));

for (const name of baselineFiles) {
  const currentPath = join(CURRENT, name);
  let current;
  try {
    current = readFileSync(currentPath);
  } catch {
    failures += 1;
    console.log(`FAIL  ${name.padEnd(width)}  not captured in this run`);
    continue;
  }

  const outcome = await compare(readFileSync(join(BASELINE, name)), current);

  if (outcome.size) {
    failures += 1;
    const [aw, ah, bw, bh] = outcome.size;
    console.log(
      `FAIL  ${name.padEnd(width)}  size ${aw}x${ah} -> ${bw}x${bh}`,
    );
    continue;
  }

  if (outcome.share > THRESHOLD) {
    failures += 1;
    writeFileSync(join(DIFF, name), Buffer.from(outcome.mask, "base64"));
    const [x1, y1, x2, y2] = outcome.region;
    console.log(
      `FAIL  ${name.padEnd(width)}  ${(outcome.share * 100).toFixed(3)}% of pixels, ` +
        `region ${x1},${y1} to ${x2},${y2}`,
    );
  } else {
    console.log(
      `ok    ${name.padEnd(width)}  ${(outcome.share * 100).toFixed(4)}%`,
    );
  }
}

const unseen = readdirSync(CURRENT)
  .filter((f) => f.startsWith("component--") && !baselineFiles.includes(f));
for (const name of unseen) {
  console.log(`NEW   ${name.padEnd(width)}  no baseline yet`);
}

browser.close();

console.log(
  `\n${baselineFiles.length} compared, ${failures} changed, ${unseen.length} new`,
);
if (failures) {
  console.log(`diff masks: ${DIFF}`);
  console.log(
    "If the change is intended: npm run test:visual:record",
  );
}
process.exit(failures ? 1 : 0);
