/**
 * Records the ClientTurn half of each App Review screencast.
 *
 *   node scripts/record-screencasts.mjs --login        # once, sign in
 *   CLIENTTURN_EMAIL=… CLIENTTURN_PASSWORD=… node scripts/record-screencasts.mjs --login
 *   node scripts/record-screencasts.mjs                 # then record every clip
 *   node scripts/record-screencasts.mjs --only inbox-messenger
 *   node scripts/record-screencasts.mjs --list
 *
 * ## What this does and does not capture
 *
 * Meta wants to see a permission being *used*. Most of these flows have two
 * halves: something happening on Facebook or Instagram, and the result
 * appearing in ClientTurn. This records the second half — cleanly, repeatably,
 * at a fixed size, with no notifications or stray tabs in shot.
 *
 * It cannot record the first half. Somebody has to send the DM, leave the
 * comment or submit the lead form from another account, and that is a person
 * with a phone. The intended workflow is: start the action on your phone,
 * record that on the phone, run the matching clip here, and cut the two
 * together — or simply run this immediately after and submit both files.
 *
 * ## What must be true before you record
 *
 * The clip has to show real data that really came from Meta. A workspace
 * carrying seeded demo rows is worse than an empty one: filming forty invented
 * leads tagged "Meta", with `@example.com` addresses, and submitting it as
 * evidence that `leads_retrieval` works is presenting fabricated records as
 * genuine. Meta rejects that, and rightly.
 *
 * So before each clip, make the thing actually happen — Meta's Lead Ads Testing
 * Tool for a lead, a second account for a DM or a comment — and check the row
 * you are about to film is the one that just arrived.
 *
 * ## Signing in
 *
 * `--login` opens a browser and saves the session to `screencasts/.auth.json`.
 * Every later run reuses it. Do it once.
 *
 * With `CLIENTTURN_EMAIL` and `CLIENTTURN_PASSWORD` set it drives the app's own
 * sign-in form and closes the browser itself; without them it waits while you
 * sign in by hand. Either way the session comes through the front door.
 *
 * What it never does is write a session cookie straight into the context.
 * `dev-login-link.mjs` is no help either — it mints an **implicit-flow** magic
 * link (`#access_token=…`) while this app's `/auth/callback` implements
 * **PKCE** and expects `?code=`, so a valid token comes back as
 * `?error=link_invalid`. Forging a session to film a security boundary being
 * respected would make the recording worthless.
 *
 * ## Why a fresh browser rather than yours
 *
 * Playwright records video only for contexts it created, so attaching to an
 * already-running Chrome cannot produce a file. A clean context is better for
 * this anyway: no bookmarks bar, no extensions, no half-open tabs, and a
 * deterministic viewport — a reviewer should see the product, not a desktop.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { CURSOR_SCRIPT } from "./lib-cursor.mjs";

const OUT_DIR = join(process.cwd(), "screencasts");
const AUTH_FILE = join(OUT_DIR, ".auth.json");
const VIEWPORT = { width: 1440, height: 900 };

/**
 * The pause between beats.
 *
 * Generous on purpose. A reviewer is seeing this product for the first time and
 * has to find the thing being demonstrated before they can judge it; a clip
 * paced for somebody who already knows the UI is a clip that gets rewatched or
 * rejected. Every clip runs well under Meta's two-minute ceiling even at this
 * speed.
 */
const BEAT = 2600;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

/**
 * The clips, one per permission Meta will review.
 *
 * `manualFirst` is what a person has to do before running the clip. It is
 * printed rather than assumed, because a recording of an empty inbox proves
 * nothing and wastes a submission.
 */
const CLIPS = [
  {
    key: "connect",
    permissions: [
      "pages_show_list",
      "pages_read_engagement",
      "business_management",
      "pages_manage_metadata",
    ],
    manualFirst: null,
    title: "Connecting a Facebook Page",
    async run(page, base) {
      await visit(page, `${base}/app`, "Dashboard");
      await settle(page);

      // Navigate the way a customer does. A reviewer watching a URL change on
      // its own learns nothing about whether the product works.
      await clickNav(page, "Settings");
      await settle(page);

      const connections = await firstVisible(page, [
        page.getByRole("link", { name: /Connections/i }),
        page.getByRole("button", { name: /Connections/i }),
        page.getByText("Connections", { exact: false }),
      ]);
      if (connections) await pointAndClick(page, connections, "Connections");
      await settle(page);

      // Connections opens on the sending mailbox, which is not what this clip
      // is about — walk down to the Meta card and hold there.
      await reveal(page, "Meta Lead Ads");

      // Scoped to the Meta card on purpose. `.first()` here used to pick the
      // sending-mailbox card's identical "Test connection" button, higher up
      // the page — so the clip showed an IMAP check being run and captioned it
      // as proof the Facebook connection works.
      const test = await controlNearest(page, "Meta Lead Ads", /Test connection/i);
      if (test) {
        await pointAndClick(page, test, "Test connection (Meta)");
        await settle(page);
      } else {
        process.stdout.write("    ! no Test connection button on the Meta card\n");
      }
    },
  },
  {
    key: "comments",
    // No permission is submitted for this one. It demonstrates the `feed`
    // webhook, which is why `pages_read_user_content` is not requested.
    permissions: ["(feed webhook — no permission requested)"],
    manualFirst:
      "From a second Facebook account, comment on one of your Page's posts. Wait ~10 seconds.",
    title: "A commenter becoming a prospect",
    async run(page, base) {
      await visit(page, `${base}/app`, "Dashboard");
      await settle(page);
      await clickNav(page, "Find Leads");
      await settle(page);
      await browseList(page);
    },
  },
  {
    key: "inbox-messenger",
    permissions: ["pages_messaging"],
    manualFirst:
      "From a second Facebook account, send your Page a message. Wait ~10 seconds.",
    title: "A Messenger conversation, and replying to it",
    async run(page, base) {
      await visit(page, `${base}/app`, "Dashboard");
      await settle(page);
      await clickNav(page, "Inbox");
      await settle(page);
      await openChannel(page, /Messenger/i);
      await openFirstConversation(page);
    },
  },
  {
    key: "inbox-instagram",
    permissions: ["instagram_basic", "instagram_manage_messages"],
    manualFirst:
      "From a second Instagram account, DM your professional account. Wait ~10 seconds.",
    title: "An Instagram conversation, and replying to it",
    async run(page, base) {
      await visit(page, `${base}/app`, "Dashboard");
      await settle(page);
      await clickNav(page, "Inbox");
      await settle(page);
      await openChannel(page, /Instagram/i);
      await openFirstConversation(page);
    },
  },
  {
    key: "leads",
    permissions: ["leads_retrieval", "pages_manage_ads"],
    manualFirst:
      "Submit your own lead form using Meta's Lead Ads Testing Tool. Wait ~10 seconds.",
    title: "A lead form submission arriving",
    async run(page, base) {
      await visit(page, `${base}/app`, "Dashboard");
      await settle(page);
      await clickNav(page, "Leads");
      await settle(page);
      await browseList(page);
    },
  },
  {
    key: "data-deletion",
    permissions: ["(data deletion callback)"],
    manualFirst:
      "Remove ClientTurn from your Facebook settings, then note the confirmation code Facebook shows you.",
    title: "The data deletion status page",
    async run(page, base) {
      await visit(page, `${base}/data-deletion`, "Data deletion");
      await settle(page);
      await scrollThrough(page);
    },
  },
];

/* --------------------------------------------------- shared clip movements */

/** Clicks a primary sidebar destination by its label. */
async function clickNav(page, label) {
  const item = await firstVisible(page, [
    page.getByRole("link", { name: new RegExp(`^${label}$`, "i") }),
    page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }),
    page.getByText(label, { exact: true }),
  ]);
  if (!item) {
    process.stdout.write(`    ! no "${label}" in the navigation
`);
    return false;
  }
  return pointAndClick(page, item, label);
}

/** Switches the Inbox to one channel, however that control is rendered. */
async function openChannel(page, pattern) {
  const tab = await firstVisible(page, [
    page.getByRole("tab", { name: pattern }),
    page.getByRole("button", { name: pattern }),
    page.getByText(pattern),
  ]);
  if (!tab) {
    process.stdout.write(`    ! no ${pattern} channel control on the Inbox
`);
    return false;
  }
  const clicked = await pointAndClick(page, tab, String(pattern));
  await settle(page);
  return clicked;
}

/**
 * Opens the first conversation, and shows the composer.
 *
 * Nothing is typed and nothing is sent. A reviewer needs to see that a reply
 * can be written; putting words into somebody's real inbox to prove it would
 * be sending a stranger a message for the sake of a video.
 */
async function openFirstConversation(page) {
  const row = page
    .getByRole("listitem")
    .or(page.locator('[data-conversation-id], [role="row"], li'))
    .first();

  if (!(await row.isVisible().catch(() => false))) {
    process.stdout.write("    ! no conversation to open — record after a real message arrives\n");
    return;
  }
  await pointAndClick(page, row, "the first conversation");
  await settle(page);

  const composer = await firstVisible(page, [
    page.getByRole("textbox"),
    page.locator("textarea"),
  ]);
  if (composer) {
    await glideTo(page, composer).catch(() => {});
    await page.waitForTimeout(BEAT);
  }
}

/** Moves down a list so the reviewer sees it is real, then back to the top. */
async function browseList(page) {
  await moveMouse(page, VIEWPORT.width / 2, VIEWPORT.height / 2, 20);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 220);
    await resyncCursor(page);
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(BEAT);
  await page.mouse.wheel(0, -1100);
  await resyncCursor(page);
  await page.waitForTimeout(BEAT);
}

/** A single unhurried pass down a public page. */
async function scrollThrough(page) {
  await moveMouse(page, VIEWPORT.width / 2, VIEWPORT.height / 2, 20);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 200);
    await resyncCursor(page);
    await page.waitForTimeout(820);
  }
  await page.waitForTimeout(BEAT);
}

async function visit(page, url, label) {
  process.stdout.write(`    → ${label}
`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // A fresh document means a fresh cursor, drawn at the middle of the viewport
  // regardless of where the mouse actually is. Put it back.
  await resyncCursor(page);
  await page.waitForTimeout(BEAT);
}

/**
 * Lets the page finish, then holds a beat.
 *
 * `networkidle` rather than a fixed sleep: a clip that cuts while a skeleton is
 * still showing looks like a broken product, which is the opposite of what a
 * screencast is for.
 */
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(BEAT);
}

/**
 * Scrolls the named thing into shot and holds there.
 *
 * Several of these pages open on something other than the part the permission
 * is about — Connections leads with the sending mailbox, for instance. Missing
 * text is reported rather than thrown: a clip that is merely framed badly is
 * still worth having, and a run that dies half way leaves you with fewer files
 * than you started with.
 */
async function reveal(page, text) {
  const target = page.getByText(text, { exact: false }).first();
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await page.waitForTimeout(BEAT);
  } catch {
    process.stdout.write(`    ! "${text}" not on the page — clip framed on the default view\n`);
  }
}

/**
 * Where the real (synthetic) mouse currently is.
 *
 * Playwright does not expose the pointer position, and the drawn cursor only
 * learns about moves from `mousemove` events. Anything that changes the page
 * without one — a navigation, which resets the injected cursor to the middle of
 * a fresh document, or a wheel scroll, which fires no move at all — leaves the
 * drawn pointer somewhere the mouse is not. That is what put the cursor in the
 * wrong place: not a positioning bug, a *synchronisation* one.
 *
 * So the position is tracked here and replayed whenever the page may have
 * dropped it.
 */
let mouseAt = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

async function moveMouse(page, x, y, steps = 45) {
  await page.mouse.move(x, y, { steps });
  mouseAt = { x, y };
}

/** Re-asserts the pointer after something that may have lost it. */
async function resyncCursor(page) {
  // A one-pixel round trip: enough to emit `mousemove` and put the drawn
  // cursor back under the real one, too small to read as movement on video.
  await page.mouse.move(mouseAt.x + 1, mouseAt.y, { steps: 1 });
  await page.mouse.move(mouseAt.x, mouseAt.y, { steps: 1 });
}

/**
 * Moves the pointer to the middle of a thing, unhurriedly.
 *
 * The box is read *after* the scroll has settled, not before. Reading it first
 * was the other half of the wrong-cursor problem: `scrollIntoViewIfNeeded`
 * returns before the scroll finishes, so the coordinates were stale by the time
 * the mouse moved — the pointer glided to where the element used to be, and the
 * click that followed landed on whatever had taken its place.
 *
 * `steps` is what makes it readable: a single jump dispatches one event and the
 * drawn cursor teleports, which looks like a cut.
 */
async function glideTo(page, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await settleScroll(page);

  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");

  await moveMouse(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);
  return box;
}

/** Waits for scrolling to actually stop before anybody reads a coordinate. */
async function settleScroll(page) {
  await page
    .waitForFunction(
      () => {
        const y = window.scrollY;
        if (window.__ctLastY === y) return true;
        window.__ctLastY = y;
        return false;
      },
      undefined,
      { timeout: 5_000, polling: 120 },
    )
    .catch(() => {});
}

/**
 * Moves to something, pauses so the viewer's eye catches up, then clicks it.
 *
 * The box is checked again immediately before the click. If the page shifted
 * under us — a banner loading, an image reflowing — the pointer is walked to
 * the new position rather than clicking empty space, which is both a better
 * recording and a click that actually hits.
 *
 * Returns whether it happened. Callers carry on either way: a clip missing one
 * beat is still submittable, whereas a run that throws half way leaves you with
 * fewer files than you started with.
 */
async function pointAndClick(page, locator, label) {
  try {
    const box = await glideTo(page, locator);

    const now = await locator.boundingBox();
    if (now && (Math.abs(now.x - box.x) > 2 || Math.abs(now.y - box.y) > 2)) {
      await moveMouse(page, now.x + now.width / 2, now.y + now.height / 2, 12);
      await page.waitForTimeout(320);
    }

    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    process.stdout.write(`    · clicked ${label}
`);
    await page.waitForTimeout(BEAT);
    return true;
  } catch {
    process.stdout.write(`    ! could not click ${label} — skipped
`);
    return false;
  }
}

/**
 * The control belonging to a particular card, chosen by position.
 *
 * Settings -> Connections renders one card per provider, each with the same
 * button labels. A role-and-name lookup therefore matches every card at once,
 * and `.first()` silently returns whichever happens to sit highest in the DOM
 * — a different provider's button, clicked with confidence.
 *
 * Rather than depend on class names or DOM shape, this picks the nearest
 * matching control *below* the card's heading, which is where a card's own
 * buttons are. Returns null instead of guessing when nothing sits below it.
 */
async function controlNearest(page, cardText, name) {
  const heading = page.getByText(cardText, { exact: false }).first();
  if (!(await heading.isVisible().catch(() => false))) return null;

  const anchor = await heading.boundingBox();
  if (!anchor) return null;

  const candidates = page.getByRole("button", { name });
  const count = await candidates.count();

  let best = null;
  let bestGap = Infinity;
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const box = await candidate.boundingBox().catch(() => null);
    if (!box) continue;
    const gap = box.y - anchor.y;
    // Below the heading, and within a card's height of it.
    if (gap >= -8 && gap < bestGap && gap < 400) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/** The first of several candidates that is actually on the page. */
async function firstVisible(page, candidates) {
  for (const locator of candidates) {
    if (await locator.first().isVisible().catch(() => false)) return locator.first();
  }
  return null;
}

/* ------------------------------------------------------------------- run */

if (has("list")) {
  console.log("\nClips:\n");
  for (const clip of CLIPS) {
    console.log(`  ${clip.key.padEnd(18)} ${clip.permissions.join(", ")}`);
    if (clip.manualFirst) console.log(`  ${"".padEnd(18)} first: ${clip.manualFirst}`);
  }
  console.log();
  process.exit(0);
}

const base = (arg("base") ?? "http://localhost:3000").replace(/\/$/, "");

/* ------------------------------------------------------------- sign in once */

if (has("login")) {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });

  const email = process.env.CLIENTTURN_EMAIL;
  const password = process.env.CLIENTTURN_PASSWORD;

  if (email && password) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign in")');

    // Staying on /login means the credentials were refused. Saving that session
    // would produce six clips of a sign-in page — files that look fine in a
    // listing and waste a submission — so fail here instead.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 45_000,
    });
    console.log(`Signed in as ${email}, landed on ${new URL(page.url()).pathname}`);
  } else {
    console.log(
      `\nA browser is open at ${base}/login.\n` +
        "Sign in as you normally would, then press Enter here.\n",
    );
    await new Promise((resolve) => process.stdin.once("data", resolve));
  }

  await context.storageState({ path: AUTH_FILE });
  await browser.close();

  console.log(`Saved to ${AUTH_FILE}. Now run the recorder without --login.\n`);
  process.exit(0);
}

if (!existsSync(AUTH_FILE)) {
  console.error(
    "No saved session.\n\n" +
      "  node scripts/record-screencasts.mjs --login\n\n" +
      "signs in once and stores it. Clips reuse that session, so each one opens\n" +
      "on the real product rather than a login screen.",
  );
  process.exit(1);
}

const only = arg("only");
const clips = only ? CLIPS.filter((c) => c.key === only) : CLIPS;

if (clips.length === 0) {
  console.error(`No clip named "${only}". Try --list.`);
  process.exit(1);
}

// Clear only the clips about to be re-recorded, plus any stray unnamed video
// Playwright left behind. This used to wipe the whole directory, which meant
// `--only leads` silently deleted the five clips you had already recorded —
// and you found out at submission time.
const doomed = new Set(clips.map((clip) => `${clip.key}.webm`));
const keep = new Set(CLIPS.map((clip) => `${clip.key}.webm`));
for (const file of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
  if (file === ".auth.json") continue;
  // Either it is being re-recorded, or it is not a clip at all (Playwright's
  // own id-named leftovers). Anything else is a clip from an earlier run for a
  // key not selected now, and it stays.
  if (doomed.has(file) || !keep.has(file)) rmSync(join(OUT_DIR, file), { force: true });
}
mkdirSync(OUT_DIR, { recursive: true });

console.log(`\nRecording ${clips.length} clip(s) to ./screencasts\n`);

const browser = await chromium.launch({ headless: false });

for (const clip of clips) {
  if (clip.manualFirst) {
    console.log(`\n  ${clip.key} — ${clip.title}`);
    console.log(`  BEFORE THIS CLIP: ${clip.manualFirst}`);
    console.log("  Press Enter when done, or Ctrl+C to stop.");
    await new Promise((resolve) => process.stdin.once("data", resolve));
  } else {
    console.log(`\n  ${clip.key} — ${clip.title}`);
  }

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
    storageState: AUTH_FILE,
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  await context.addInitScript(CURSOR_SCRIPT);

  const page = await context.newPage();

  try {
    // Park the pointer somewhere sensible before the first move, so the opening
    // frame is not a cursor sitting in the very corner.
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);

    await clip.run(page, base);

    // A clip that quietly recorded the login screen is worse than one that
    // failed: it looks fine in the file listing and wastes a submission.
    if (/\/login|\/signup/.test(page.url())) {
      console.log("    ! landed on the sign-in page — run --login again, the session has expired");
    }
  } catch (error) {
    console.log(`    ! ${error.message.split("\n")[0]}`);
  }

  await context.close(); // flushes the video file

  // Playwright names videos by an internal id; rename to the clip so the files
  // are submittable without anybody having to work out which is which.
  const written = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm") && !f.includes("-"));
  const newest = written.sort().pop();
  if (newest) {
    renameSync(join(OUT_DIR, newest), join(OUT_DIR, `${clip.key}.webm`));
    console.log(`    saved screencasts/${clip.key}.webm`);
  }
}

await browser.close();

console.log(
  "\nDone.\n\n" +
    "These cover the ClientTurn half. For each clip with a 'BEFORE THIS CLIP'\n" +
    "step, record that action on your phone and submit both, or cut them\n" +
    "together — a reviewer needs to see the data arrive, not just exist.\n",
);
process.exit(0);
