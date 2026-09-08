/**
 * Records the ClientTurn half of each App Review screencast.
 *
 *   node scripts/record-screencasts.mjs --login        # once, sign in by hand
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
 * ## Signing in
 *
 * `--login` opens a browser, waits while you sign in normally, and saves the
 * session to `screencasts/.auth.json`. Every later run reuses it. Do it once.
 *
 * Deliberately not automated. `dev-login-link.mjs` mints an **implicit-flow**
 * magic link (`#access_token=…`) while this app's `/auth/callback` implements
 * **PKCE** and expects `?code=` — so a perfectly valid token comes back as
 * `?error=link_invalid`. PKCE cannot be driven from a script by design: the
 * code verifier only ever exists in the browser that started the flow.
 *
 * The alternative would be writing a session cookie straight into the context,
 * which is forging a login to record a video of a security boundary being
 * respected. Signing in once by hand is both simpler and honest.
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

const OUT_DIR = join(process.cwd(), "screencasts");
const AUTH_FILE = join(OUT_DIR, ".auth.json");
const VIEWPORT = { width: 1440, height: 900 };

/** Long enough for a reviewer to read the screen, short enough to hold attention. */
const BEAT = 1800;

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
      await visit(page, `${base}/app/settings/connections`, "Settings → Connections");
      await settle(page);
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
      await visit(page, `${base}/app/find-leads`, "Find Leads");
      await settle(page);
    },
  },
  {
    key: "inbox-messenger",
    permissions: ["pages_messaging"],
    manualFirst:
      "From a second Facebook account, send your Page a message. Wait ~10 seconds.",
    title: "A Messenger conversation, and replying to it",
    async run(page, base) {
      await visit(page, `${base}/app/inbox?channel=messenger`, "Inbox → Messenger");
      await settle(page);
    },
  },
  {
    key: "inbox-instagram",
    permissions: ["instagram_basic", "instagram_manage_messages"],
    manualFirst:
      "From a second Instagram account, DM your professional account. Wait ~10 seconds.",
    title: "An Instagram conversation, and replying to it",
    async run(page, base) {
      await visit(page, `${base}/app/inbox?channel=instagram`, "Inbox → Instagram");
      await settle(page);
    },
  },
  {
    key: "leads",
    permissions: ["leads_retrieval", "pages_manage_ads"],
    manualFirst:
      "Submit your own lead form using Meta's Lead Ads Testing Tool. Wait ~10 seconds.",
    title: "A lead form submission arriving",
    async run(page, base) {
      await visit(page, `${base}/app/leads`, "Leads");
      await settle(page);
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
    },
  },
];

async function visit(page, url, label) {
  process.stdout.write(`    → ${label}\n`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
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

  console.log(
    `\nA browser is open at ${base}/login.\n` +
      "Sign in as you normally would, then press Enter here.\n",
  );
  await new Promise((resolve) => process.stdin.once("data", resolve));

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

// Old clips go; the saved session stays.
for (const file of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
  if (file !== ".auth.json") rmSync(join(OUT_DIR, file), { force: true });
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

  const page = await context.newPage();

  try {
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
