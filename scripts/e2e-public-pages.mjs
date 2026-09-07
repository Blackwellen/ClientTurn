/**
 * End-to-end checks for the designed public pages.
 *
 *   npm run test:e2e                       # against http://127.0.0.1:3000
 *   E2E_ORIGIN=http://localhost:3210 npm run test:e2e
 *
 * Run against a production build (`next build && next start`). These assert on
 * the hydrated page, so they cover the class of fault that unit tests and a
 * server-rendered HTML check both miss: a filter that does not filter, a
 * drawer that will not open, an entrance animation that never clears and
 * leaves a panel invisible.
 *
 * Exits non-zero on the first failing assertion count, so it can gate a
 * release.
 */

import {
  CONSENT_SCRIPT,
  ERROR_COLLECTOR,
  launch,
  open,
  sleep,
} from "./lib/headless-chrome.mjs";

const origin = process.env.E2E_ORIGIN ?? "http://127.0.0.1:3000";

const results = [];
let failures = 0;

function check(name, outcome) {
  const ok = outcome === true;
  if (!ok) failures += 1;
  results.push({ name, ok });
  const detail = ok || outcome === false ? "" : `  — ${outcome}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail}`);
}

const browser = await launch({ reducedMotion: false });

/** Opens a page with the shared init scripts already installed. */
async function visit(path, { width = 1440, height = 900 } = {}) {
  const page = await browser.page({
    initScript: CONSENT_SCRIPT + ERROR_COLLECTOR,
  });
  await open(page, origin + path, { path, width, height });
  return page;
}

try {
  /* ======================================================== find-leads */

  console.log("\n─── /product/find-leads ───");
  let page = await visit("/product/find-leads");

  check(
    "one H1 carrying the approved headline",
    await page.evaluate(`(() => {
      const h1 = document.querySelectorAll("h1");
      if (h1.length !== 1) return h1.length + " H1 elements";
      const t = h1[0].textContent;
      return /Describe your ideal customer/.test(t) &&
        /Build a verified prospect pipeline/.test(t)
        ? true : "unexpected headline: " + t.slice(0, 60);
    })()`),
  );

  check(
    "the ten section headings appear as H2s, in order",
    await page.evaluate(`(() => {
      const want = [
        "ClientTurn learns what your business",
        "Review the interpretation",
        "See what ClientTurn is doing",
        "Review sourced prospects",
        "A score should explain itself",
        "Prioritise companies showing a reason",
        "Coordinate acquisition without building",
        "When a prospect engages",
        "See what it costs to build pipeline",
        "Tell ClientTurn",
      ];
      const got = [...document.querySelectorAll("h2")]
        .map((h) => h.textContent.replace(/\\s+/g, " "));
      let cursor = 0;
      for (const phrase of want) {
        const at = got.findIndex((g, i) => i >= cursor && g.includes(phrase));
        if (at === -1) return "missing or out of order: " + phrase;
        cursor = at + 1;
      }
      return true;
    })()`),
  );

  check(
    "the console stayed clean",
    await page.evaluate(
      "window.__errors.length === 0 ? true : JSON.stringify(window.__errors.slice(0, 2))",
    ),
  );

  check(
    "the hero workspace is visible, not stranded by its entrance animation",
    await page.evaluate(`(() => {
      const el = document.querySelector(".fl-appframe");
      if (!el) return "no hero workspace";
      const o = getComputedStyle(el).opacity;
      return o === "1" ? true : "opacity " + o;
    })()`),
  );

  check(
    "six example prompts are offered",
    await page.evaluate(`(() => {
      const n = document.querySelectorAll(".fl-chips .fl-chip").length;
      return n === 6 ? true : n + " chips";
    })()`),
  );

  check(
    "both hero calls to action resolve",
    await page.evaluate(`(() => {
      const primary = [...document.querySelectorAll("a")]
        .find((a) => a.textContent.includes("Start Finding Leads"));
      const secondary = [...document.querySelectorAll("a")]
        .find((a) => a.textContent.includes("See how sourcing works"));
      if (!primary || !secondary) return "a hero CTA is missing";
      return primary.getAttribute("href").startsWith("/signup") &&
        secondary.getAttribute("href") === "#sourcing" &&
        !!document.querySelector("#sourcing")
        ? true : "hrefs: " + primary.getAttribute("href") + ", " +
          secondary.getAttribute("href");
    })()`),
  );

  /* --- the previous-searches drawer ---------------------------------- */

  await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll(".fl-mini-link")]
      .find((b) => b.textContent.includes("View all"));
    trigger.click();
  })()`);
  await sleep(700);

  check(
    "the search-history drawer opens as a modal dialog",
    await page.evaluate(`(() => {
      const d = document.querySelector('.fl-drawer[role="dialog"]');
      if (!d) return "no dialog";
      return d.getAttribute("aria-modal") === "true" ? true : "not aria-modal";
    })()`),
  );
  check(
    "the drawer takes focus",
    await page.evaluate(
      "!!document.activeElement.closest('.fl-drawer') ? true : 'focus stayed outside'",
    ),
  );

  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await sleep(600);
  check(
    "Escape closes the drawer",
    await page.evaluate(
      "!document.querySelector('.fl-drawer') ? true : 'drawer stayed open'",
    ),
  );

  /* --- the hero demo ------------------------------------------------- */

  check(
    "choosing an example rewrites the request and unfolds the plan",
    await page.evaluate(`(() => {
      const chip = [...document.querySelectorAll(".fl-chip")]
        .find((c) => c.textContent.includes("Hotels planning refurbishment"));
      if (!chip) return "example chip missing";
      chip.click();
      return new Promise((done) => setTimeout(() => {
        const bubble = document.querySelector(".fl-bubble-user");
        const rows = document.querySelectorAll(".fl-bubble dl > div").length;
        done(
          bubble && /hotels planning refurbishment/i.test(bubble.textContent) &&
          rows >= 8
            ? true
            : "bubble=" + !!bubble + " planRows=" + rows,
        );
      }, 1000));
    })()`),
  );

  /* --- sourcing run -------------------------------------------------- */

  check(
    "all twelve sourcing stages use the product's own titles",
    await page.evaluate(`(() => {
      const want = ["Understanding target","Planning search","Finding companies",
        "Finding contacts","Cheap pre-filtering","Enriching high-fit records",
        "Verifying emails","Deduplicating","Compliance / contactability",
        "Scoring and grading","Intent matching","Preparing outreach"];
      const got = [...document.querySelectorAll("#sourcing .fl-stage .fl-stage-name")]
        .map((n) => n.textContent.trim());
      if (got.length !== 12) return got.length + " stages";
      const wrong = want.findIndex((w, i) => got[i] !== w);
      return wrong === -1 ? true : "stage " + (wrong + 1) + ": " + got[wrong];
    })()`),
  );

  check(
    "run progress is completed stages over twelve, not a timer",
    await page.evaluate(`(() => {
      const bar = document.querySelector('[aria-label="Sourcing run progress"]');
      const done = document.querySelectorAll(
        '#sourcing .fl-stage[data-status="COMPLETED"]').length;
      const shown = Number(bar.getAttribute("aria-valuenow"));
      const expected = Math.round((done / 12) * 100);
      return shown === expected ? true : shown + "% shown, " + expected + "% earned";
    })()`),
  );

  /* --- prospects ----------------------------------------------------- */

  check(
    "the prospect quick filters really filter",
    await page.evaluate(`(() => {
      const before = document.querySelectorAll(".fl-table tbody tr").length;
      const btn = [...document.querySelectorAll(".fl-filter")]
        .find((b) => b.textContent.includes("A Grade"));
      btn.click();
      return new Promise((done) => setTimeout(() => {
        const after = document.querySelectorAll(".fl-table tbody tr").length;
        done(
          before === 10 && after === 2 &&
          btn.getAttribute("aria-pressed") === "true"
            ? true
            : before + " -> " + after,
        );
      }, 800));
    })()`),
  );

  /* --- explainable scoring ------------------------------------------- */

  check(
    "score factors are disclosures that open their evidence",
    await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll(".fl-factor-btn")];
      if (buttons.length !== 6) return buttons.length + " factors";
      const shut = buttons.find((b) => b.getAttribute("aria-expanded") === "false");
      if (!shut) return "no collapsed factor to open";
      shut.click();
      return new Promise((done) => setTimeout(() => {
        const panel = document.getElementById(shut.getAttribute("aria-controls"));
        done(
          shut.getAttribute("aria-expanded") === "true" &&
          panel && panel.offsetHeight > 10
            ? true
            : "panel did not open",
        );
      }, 700));
    })()`),
  );

  check(
    "the headline score is the sum of the factors beneath it",
    await page.evaluate(`(() => {
      const total = Number(document.querySelector(".fl-ring-value").textContent);
      const sum = [...document.querySelectorAll(".fl-factor-points")]
        .reduce((a, el) => a + Number(el.textContent.trim().split(" ")[0]), 0);
      return total === sum ? true : total + " shown, factors sum to " + sum;
    })()`),
  );

  /* --- intent, campaigns, promotion ---------------------------------- */

  check(
    "the intent filters switch the signal feed",
    await page.evaluate(`(() => {
      const before = document.querySelectorAll(".fl-events .fl-event").length;
      const btn = [...document.querySelectorAll(".fl-filter")]
        .find((b) => b.textContent.includes("High intent"));
      btn.click();
      return new Promise((done) => setTimeout(() => {
        const after = document.querySelectorAll(".fl-events .fl-event").length;
        done(before === 5 && after === 2 ? true : before + " -> " + after);
      }, 800));
    })()`),
  );

  check(
    "the campaign stepper shows the product's six steps",
    await page.evaluate(`(() => {
      const labels = [...document.querySelectorAll(".fl-stepper li > span:last-child")]
        .map((s) => s.textContent.trim());
      const want = ["Goal","Audience","Intent & Score","Outreach",
        "Budget & Limits","Review & Launch"];
      return JSON.stringify(labels) === JSON.stringify(want)
        ? true : JSON.stringify(labels);
    })()`),
  );

  check(
    "stepping the wizard moves the panel and updates aria-current",
    await page.evaluate(`(() => {
      const dots = [...document.querySelectorAll(".fl-step-dot")];
      dots[3].click();
      return new Promise((done) => setTimeout(() => {
        done(
          dots[3].getAttribute("aria-current") === "step" &&
          !dots[0].getAttribute("aria-current")
            ? true : "aria-current did not move",
        );
      }, 800));
    })()`),
  );

  check(
    "cold outreach is email only",
    await page.evaluate(`(() => {
      const seq = document.querySelector(".fl-seq");
      const steps = [...seq.querySelectorAll("li strong")].map((s) => s.textContent);
      if (steps.length !== 4) return steps.length + " steps";
      if (!steps.every((s) => /Email/.test(s))) return "a step is not email";
      return /SMS|WhatsApp/i.test(seq.textContent)
        ? "another channel appears in the sequence" : true;
    })()`),
  );

  check(
    "promotion swaps the entity and keeps the same conversation",
    await page.evaluate(`(() => {
      const thread = () =>
        [...document.querySelectorAll(".fl-thread li p")].map((p) => p.textContent);
      const before = thread();
      const chipBefore = document.querySelector(".fl-entity-chip").textContent.trim();
      const btn = [...document.querySelectorAll("button")]
        .find((b) => /Promote to lead/.test(b.textContent));
      if (!btn) return "no promote control";
      btn.click();
      return new Promise((done) => setTimeout(() => {
        const chipAfter = document.querySelector(".fl-entity-chip").textContent.trim();
        const after = thread();
        done(
          chipBefore === "Prospect" && chipAfter === "Lead" &&
          before.length === 3 && JSON.stringify(before) === JSON.stringify(after)
            ? true
            : chipBefore + "->" + chipAfter + ", messages " +
              before.length + "->" + after.length,
        );
      }, 1100));
    })()`),
  );

  check(
    "the warm-lead actions appear once promoted",
    await page.evaluate(`(() => {
      const actions = [...document.querySelectorAll(".fl-lead-actions li")]
        .map((l) => l.textContent.trim());
      return JSON.stringify(actions) === JSON.stringify(["Qualify","Follow-Up","Book"])
        ? true : JSON.stringify(actions);
    })()`),
  );

  /* --- analytics, CTA, SEO ------------------------------------------- */

  check(
    "the acquisition funnel narrows at every step",
    await page.evaluate(`(() => {
      const values = [...document.querySelectorAll(".fl-funnel li .fl-funnel-value")]
        .map((v) => Number(v.textContent.replace(/[^0-9]/g, "")));
      if (values.length !== 7) return values.length + " steps";
      const rise = values.findIndex((v, i) => i > 0 && v > values[i - 1]);
      return rise === -1 ? true : "step " + rise + " grows";
    })()`),
  );

  check(
    "the closing CTA offers signup and contact sales",
    await page.evaluate(`(() => {
      const paths = [...document.querySelectorAll(".fl-final-actions a")]
        .map((a) => a.getAttribute("href").split("?")[0]);
      return JSON.stringify(paths) === JSON.stringify(["/signup", "/contact-sales"])
        ? true : JSON.stringify(paths);
    })()`),
  );

  check(
    "every onward link points at a route that exists",
    await page.evaluate(`(() => {
      const allowed = ["/#how-it-works","/#industries","/#pricing","/#faq","/contact-sales"];
      const hrefs = [...document.querySelectorAll('.fl nav[aria-label="Related pages"] a')]
        .map((a) => a.getAttribute("href"));
      const stray = hrefs.filter((h) => !allowed.includes(h));
      return hrefs.length === 5 && stray.length === 0 ? true : JSON.stringify(stray);
    })()`),
  );

  check(
    "the page uses the shared site chrome",
    await page.evaluate(`(() => {
      const headers = document.querySelectorAll("header").length;
      return headers === 1 && !!document.querySelector("footer")
        ? true : headers + " headers";
    })()`),
  );

  check(
    "structured data parses and claims no rating or price",
    await page.evaluate(`(() => {
      const el = document.querySelector('script[type="application/ld+json"]');
      const json = JSON.parse(el.textContent);
      const text = JSON.stringify(json);
      if (!Array.isArray(json["@graph"])) return "no @graph";
      return /aggregateRating|"offers"/.test(text)
        ? "carries a rating or price claim" : true;
    })()`),
  );

  await page.close();

  /* ------------------------------------------------- find-leads, phone */

  console.log("\n─── /product/find-leads at 390×844 ───");
  page = await visit("/product/find-leads", { width: 390, height: 844 });

  check(
    "the page does not scroll sideways",
    await page.evaluate(`(() => {
      const d = document.documentElement;
      return d.scrollWidth <= d.clientWidth + 1
        ? true : d.scrollWidth + " > " + d.clientWidth;
    })()`),
  );
  check(
    "the wide table gives way to prospect cards",
    await page.evaluate(`(() => {
      const table = getComputedStyle(document.querySelector(".fl-table-scroll")).display;
      const cards = document.querySelectorAll(".fl-pcard").length;
      return table === "none" && cards === 10
        ? true : "table " + table + ", " + cards + " cards";
    })()`),
  );
  check(
    "a prospect card still carries eligibility, outreach and last activity",
    await page.evaluate(`(() => {
      const t = document.querySelector(".fl-pcard").textContent;
      return /Eligible|Review/.test(t) &&
        /Ready|Replied|In outreach|Not contacted/.test(t) && /ago/.test(t)
        ? true : "a field is missing from the card";
    })()`),
  );
  check(
    "the search plan collapses behind a disclosure",
    await page.evaluate(`(() => {
      const btn = document.querySelector(".fl-plan-toggle");
      if (!btn || getComputedStyle(btn).display === "none") return "no toggle";
      const panel = document.getElementById(btn.getAttribute("aria-controls"));
      const startedClosed = btn.getAttribute("aria-expanded") === "false";
      btn.click();
      return new Promise((done) => setTimeout(() => {
        done(
          startedClosed && btn.getAttribute("aria-expanded") === "true" &&
          panel.offsetHeight > 40
            ? true : "disclosure did not open",
        );
      }, 700));
    })()`),
  );

  await page.close();

  /* --------------------------------------------------- reduced motion */

  console.log("\n─── reduced motion ───");
  const quiet = await launch({ reducedMotion: true });
  const quietPage = await quiet.page({
    initScript: CONSENT_SCRIPT + ERROR_COLLECTOR,
  });
  await open(quietPage, `${origin}/product/find-leads`, {
    path: "/product/find-leads",
    width: 1440,
    height: 900,
  });

  check(
    "nothing is left invisible when less movement is asked for",
    await quietPage.evaluate(`(() => {
      const stranded = [...document.querySelectorAll(".fl *")].filter((el) => {
        const cs = getComputedStyle(el);
        return Number(cs.opacity) === 0 && el.getBoundingClientRect().width > 0;
      });
      return stranded.length === 0
        ? true : stranded.length + " elements still at opacity 0";
    })()`),
  );
  check(
    "the demos resolve straight to their final state",
    await quietPage.evaluate(`(() => {
      const done = document.querySelectorAll(
        '#sourcing .fl-stage[data-status="COMPLETED"]').length;
      const rows = document.querySelectorAll(".fl-bubble dl > div").length;
      return done === 8 && rows === 8
        ? true : "stages " + done + ", plan rows " + rows;
    })()`),
  );

  await quietPage.close();
  quiet.close();

  /* ========================================================= affiliates */

  console.log("\n─── /affiliates ───");
  page = await visit("/affiliates");

  check(
    "one H1 carrying the approved headline",
    await page.evaluate(`(() => {
      const h1 = document.querySelectorAll("h1");
      if (h1.length !== 1) return h1.length + " H1 elements";
      const t = h1[0].textContent;
      return /Earn by helping/.test(t) && /businesses grow/.test(t)
        ? true : t.slice(0, 60);
    })()`),
  );
  check(
    "the console stayed clean",
    await page.evaluate(
      "window.__errors.length === 0 ? true : JSON.stringify(window.__errors.slice(0, 2))",
    ),
  );
  check(
    "the partner dashboard is visible",
    await page.evaluate(`(() => {
      const el = document.querySelector(".afp-panel-wrap");
      if (!el) return "no dashboard";
      const o = getComputedStyle(el).opacity;
      return o === "1" ? true : "opacity " + o;
    })()`),
  );
  check(
    "it mounts the shared portal frame rather than a second copy of it",
    await page.evaluate(`(() => {
      const frame = document.querySelector('.afp-panel-wrap [role="img"][aria-label]');
      return frame && /partner portal/i.test(frame.getAttribute("aria-label"))
        ? true : "no labelled portal frame in the hero";
    })()`),
  );
  check(
    "the example figures are labelled as an example",
    await page.evaluate(`(() => {
      const note = document.querySelector(".afp-panel-note");
      return note && /not a forecast|example|illustrat/i.test(note.textContent)
        ? true : "no illustrative-data note beside the dashboard";
    })()`),
  );
  check(
    "no unevidenced customer-count claim",
    await page.evaluate(`(() => {
      return /thousands of businesses|loved by thousands/i.test(document.body.textContent)
        ? "an unevidenced volume claim is on the page" : true;
    })()`),
  );
  check(
    "both hero calls to action resolve",
    await page.evaluate(`(() => {
      const links = [...document.querySelectorAll(".afp-hero-actions a")];
      return links.length === 2 &&
        links.every((a) => (a.getAttribute("href") || "").startsWith("/"))
        ? true : links.length + " links";
    })()`),
  );
  check(
    "the benefit strip carries four items",
    await page.evaluate(`(() => {
      const n = document.querySelectorAll(".afp-benefits li").length;
      return n === 4 ? true : n + " items";
    })()`),
  );

  /* The two token faults that made the evaluation pages look like a
     different, bluer site with white rules drawn across it. */
  check(
    "the public ground is the site's black",
    await page.evaluate(`(() => {
      const v = getComputedStyle(document.querySelector(".ct-marketing"))
        .getPropertyValue("--pub-bg").trim();
      return v === "#020409" ? true : v;
    })()`),
  );
  check(
    "band seams are near-navy, not light hairlines",
    await page.evaluate(`(() => {
      const v = getComputedStyle(document.querySelector(".ct-marketing"))
        .getPropertyValue("--pub-border").trim();
      return v === "#1b2434" ? true : v;
    })()`),
  );

  await page.close();

  console.log("\n─── /affiliates at 390×844 ───");
  page = await visit("/affiliates", { width: 390, height: 844 });
  check(
    "the page does not scroll sideways",
    await page.evaluate(`(() => {
      const d = document.documentElement;
      return d.scrollWidth <= d.clientWidth + 1
        ? true : d.scrollWidth + " > " + d.clientWidth;
    })()`),
  );
  check(
    "the hero and the benefit strip stack to one column",
    await page.evaluate(`(() => {
      const cols = (sel) => {
        const el = document.querySelector(sel);
        return el
          ? getComputedStyle(el).gridTemplateColumns.split(" ").length
          : null;
      };
      const hero = cols(".afp-hero-grid");
      const strip = cols(".afp-benefits");
      return hero === 1 && strip === 1
        ? true : "hero " + hero + ", strip " + strip;
    })()`),
  );
  check(
    "the partner dashboard fits the viewport",
    await page.evaluate(`(() => {
      const el = document.querySelector(".afp-panel-wrap");
      if (!el) return "no dashboard";
      const over = el.getBoundingClientRect().right -
        document.documentElement.clientWidth;
      return over <= 1 ? true : "overflows by " + Math.round(over) + "px";
    })()`),
  );

  await page.close();
} finally {
  browser.close();
}

const passed = results.length - failures;
console.log(`\n${passed}/${results.length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
