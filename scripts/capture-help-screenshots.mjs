/**
 * Captures the help-centre screenshots from the DEMO workspace "Blackwellen
 * Ltd" (scripts/seed-help-demo.mjs), annotates them and wires them into the
 * articles, following content/help/README.md section 5.
 *
 * ## Run it
 *
 *   1. Seed (or refresh) the demo workspace:
 *        node --experimental-transform-types --env-file=.env --env-file=.env.local \
 *          --import ./scripts/e2e-resolver.mjs --import ./scripts/lib/egress-guard.mjs \
 *          scripts/seed-help-demo.mjs
 *   2. Serve the app with every outbound provider call blocked. A production
 *      build avoids the dev overlay and the dev-server lock:
 *        NODE_OPTIONS=--import=./scripts/lib/egress-guard.mjs npx next build
 *        NODE_OPTIONS=--import=./scripts/lib/egress-guard.mjs npx next start -p 3100
 *   3. Capture:
 *        HELP_DEMO_EMAIL=alex.morgan@blackwellen-demo.example HELP_DEMO_PASSWORD=... \
 *        node --env-file=.env --env-file=.env.local --import ./scripts/lib/egress-guard.mjs \
 *          scripts/capture-help-screenshots.mjs [--only id,id] [--list] [--explore /app/path]
 *   4. node scripts/generate-help-content.mjs
 *
 * The password is never stored: it is printed once by the seed (or reset with
 * `seed-help-demo.mjs --reset-password`) and passed in the environment.
 *
 * ## Simulated connections
 *
 * Shots marked `simulated` need a connected provider. For those, this script
 * creates SIMULATED connections (scripts/lib/help-demo-simulated.mjs: fictional
 * names, no tokens, marked `help_demo_simulated`) and deletes them, with
 * everything derived from them, in a `finally` block when it finishes, even on
 * failure. It then re-runs the safety check (lib/help-demo-safety.mjs), which
 * fails if any simulated row or claimable job is left.
 *
 * ## What each image is
 *
 * 2x device pixel ratio, at most 1440 CSS px wide, PNG (palette-optimised),
 * numbered markers (lime #B7F34A disc, midnight outline) at each control the
 * caption mentions, a midnight box around it (lime on dark UI), and the
 * branded caption band (midnight, lime rule, favicon, white caption). The
 * browser may only reach localhost and the Supabase project; every other
 * request (analytics, provider widgets) is aborted.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHOTS, card } from "./lib/help-shots.mjs";

const ROOT = process.cwd();
const BASE = (process.env.HELP_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const OUT = join(ROOT, "public", "help", "screenshots");
const AUTH = join(tmpdir(), "clientturn-help-demo-auth.json");
const VIEWPORT = { width: 1440, height: 1000 };
const MIDNIGHT = "#0B1020";
const LIME = "#B7F34A";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const only = opt("only")?.split(",").map((s) => s.trim()) ?? null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

/* ------------------------------------------------------------ browser */

async function newContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: "en-GB",
    timezoneId: "Europe/London",
    colorScheme: "light",
    reducedMotion: "reduce",
    storageState: existsSync(AUTH) ? AUTH : undefined,
  });
  // Tours already seen (the server copy is seeded too): nothing opens over a shot.
  await context.addInitScript(() => {
    try {
      const seen = { version: 99, outcome: "skipped", at: new Date().toISOString() };
      localStorage.setItem("ct-product-tour", JSON.stringify(seen));
      const keys = ["dashboard", "leads", "follow-up", "reactivation", "settings", "find-leads", "agents", "analytics", "inbox"];
      localStorage.setItem("ct-section-tours", JSON.stringify(Object.fromEntries(keys.map((k) => [k, seen]))));
    } catch {
      /* storage unavailable: the server copy still applies */
    }
  });
  const supabaseHost = url ? new URL(url).hostname : "";
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === supabaseHost || host.startsWith("fonts.g")) return route.continue();
    return route.abort();
  });
  return context;
}

async function signIn(browser) {
  const email = process.env.HELP_DEMO_EMAIL;
  const password = process.env.HELP_DEMO_PASSWORD;
  if (!email || !password) throw new Error("Set HELP_DEMO_EMAIL and HELP_DEMO_PASSWORD (the seed prints the password once).");
  if (!/\.example$/.test(email)) throw new Error("Refusing: the demo login is always on a .example domain.");
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  }
  await context.storageState({ path: AUTH });
  await context.close();
}

/** Hides anything transient that must never appear in a help image. */
const TIDY_CSS = `
  [data-sonner-toaster], [data-nextjs-toast], nextjs-portal, #__next-build-watcher { display: none !important; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`;

async function settle(page, ms = 900) {
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function open(page, path, { tidy = true } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("session expired: landed on /login");
  await page.addStyleTag({ content: tidy ? TIDY_CSS : TIDY_CSS.replace(/^.*sonner.*$/m, "") }).catch(() => {});
  await settle(page);
}

/* ------------------------------------------------------------ annotate */

async function rectOf(locator, { viewport = false } = {}) {
  await locator.first().waitFor({ state: "visible", timeout: 15_000 });
  return locator.first().evaluate((el, viewport) => {
    const r = el.getBoundingClientRect();
    return viewport
      ? { x: r.left, y: r.top, w: r.width, h: r.height }
      : { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }, viewport);
}

function union(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Frames the union of `regionLocators`, draws the numbered markers, and
 * returns that area as a 2x PNG. The viewport grows when the area is taller
 * than it; the page is scrolled so the area sits just below the sticky top
 * bar; then everything is re-measured in viewport coordinates, which is what
 * makes fixed drawers and dialogs frame correctly too.
 */
async function captureRegion(page, regionLocators, markers, { dark = false, pad = 16 } = {}) {
  const locators = [regionLocators].flat();
  const first = union(await Promise.all(locators.map((l) => rectOf(l))));
  const needed = Math.min(Math.max(VIEWPORT.height, Math.ceil(first.h + pad * 2 + 120)), 3200);
  if (needed !== page.viewportSize().height) {
    await page.setViewportSize({ width: VIEWPORT.width, height: needed });
    await page.waitForTimeout(500);
  }
  const doc = union(await Promise.all(locators.map((l) => rectOf(l))));
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 88)), doc.y - pad);
  await page.waitForTimeout(400);

  // The floating support button sits over the bottom-right corner of every
  // page; it is not part of what any caption describes.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 140 && r.height < 140 && r.right > innerWidth - 160 && r.bottom > innerHeight - 160) el.style.visibility = 'hidden';
    }
  });
  const region = union(await Promise.all(locators.map((l) => rectOf(l, { viewport: true }))));
  const boxes = [];
  for (const marker of markers) {
    const r = await rectOf(marker.locator, { viewport: true });
    if (r.w < 2 || r.h < 2) throw new Error(`marker ${marker.n} has no visible box`);
    // The disc sits above-left of its target; where that would fall outside
    // the crop (a target at the crop's left edge) it overlaps the target instead.
    const dx = r.x - 34 < region.x - pad ? r.x - 10 : r.x - 34;
    boxes.push({ ...r, dx, n: marker.n, box: marker.box !== false });
  }
  await page.evaluate(
    ({ boxes, dark, MIDNIGHT, LIME }) => {
      document.getElementById("help-annotations")?.remove();
      const layer = document.createElement("div");
      layer.id = "help-annotations";
      layer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
      const edge = dark ? LIME : MIDNIGHT;
      for (const b of boxes) {
        if (b.box) {
          const box = document.createElement("div");
          box.style.cssText = `position:fixed;left:${b.x - 5}px;top:${b.y - 5}px;width:${b.w + 10}px;height:${b.h + 10}px;border:3px solid ${edge};border-radius:10px;box-shadow:0 0 0 3px ${dark ? "rgba(183,243,74,.25)" : "rgba(11,16,32,.12)"};`;
          layer.appendChild(box);
        }
        const dot = document.createElement("div");
        dot.textContent = String(b.n);
        const dx = b.dx;
        const dy = b.y - 26;
        dot.style.cssText = `position:fixed;left:${dx}px;top:${dy}px;width:28px;height:28px;border-radius:50%;background:${LIME};border:2.5px solid ${MIDNIGHT};color:${MIDNIGHT};font:700 15px/28px system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;box-sizing:content-box;`;
        layer.appendChild(dot);
      }
      document.body.appendChild(layer);
    },
    { boxes, dark, MIDNIGHT, LIME },
  );
  const vp = page.viewportSize();
  // Grow the crop so no marker disc is cut off.
  const dotLeft = Math.min(region.x, ...boxes.map((b) => b.dx - 4));
  const dotTop = Math.min(region.y, ...boxes.map((b) => b.y - 30));
  const x0 = Math.max(0, Math.floor(Math.min(region.x - pad, dotLeft)));
  const y0 = Math.max(0, Math.floor(Math.min(region.y - pad, dotTop)));
  const x1 = Math.min(vp.width, Math.ceil(region.x + region.w + pad));
  const y1 = Math.min(vp.height, Math.ceil(region.y + region.h + pad));
  const png = await page.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, animations: "disabled" });
  await page.evaluate(() => document.getElementById("help-annotations")?.remove());
  await page.setViewportSize(VIEWPORT);
  return png;
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Appends the branded caption band and writes a palette-optimised PNG. */
async function finish(png, caption, file) {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const band = 112;
  const rule = 6;
  const icon = await sharp(join(ROOT, "public", "favicon-192.png")).resize(52, 52).png().toBuffer();
  // Shrink the caption to fit narrow crops (about 0.5em per character).
  const fontSize = Math.max(18, Math.min(34, Math.floor((width - 170) / (caption.length * 0.52))));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${band}">
      <rect width="100%" height="100%" fill="${MIDNIGHT}"/>
      <rect width="100%" height="${rule}" fill="${LIME}"/>
      <text x="${40 + 52 + 32}" y="${rule + (band - rule) / 2 + fontSize * 0.35}" fill="#FFFFFF" font-family="Geist, Inter, 'Segoe UI', Arial, sans-serif" font-size="${fontSize}" font-weight="500">${escapeXml(caption)}</text>
    </svg>`,
  );
  const bandPng = await sharp(svg).composite([{ input: icon, left: 40, top: rule + Math.round((band - rule - 52) / 2) }]).png().toBuffer();
  const out = await sharp({ create: { width, height: height + band, channels: 4, background: MIDNIGHT } })
    .composite([
      { input: png, left: 0, top: 0 },
      { input: bandPng, left: 0, top: height },
    ])
    .png({ palette: true, quality: 92, effort: 8, compressionLevel: 9 })
    .toBuffer();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, out);
  return { width, height: height + band, bytes: out.length };
}

/* ------------------------------------------------------------ docs */

const yamlQuote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Adds (or updates) one entry in an article's `screenshots:` frontmatter. */
function addToFrontmatter(category, slug, src, alt, caption) {
  const file = join(ROOT, "content", "help", category, `${slug}.md`);
  const text = readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 4);
  let fm = text.slice(0, end);
  const body = text.slice(end);
  const entry = `  - src: ${src}\n    alt: ${yamlQuote(alt)}\n    caption: ${yamlQuote(caption)}`;
  const lines = fm.split("\n");
  const start = lines.findIndex((l) => l.startsWith("screenshots:"));
  if (start < 0) {
    fm = `${fm}\nscreenshots:\n${entry}`;
  } else {
    let stop = start + 1;
    while (stop < lines.length && /^\s/.test(lines[stop])) stop += 1;
    const block = lines.slice(start + 1, stop).join("\n");
    const items = block.split(/\n(?=  - src: )/).filter(Boolean);
    const kept = items.filter((item) => !item.includes(`src: ${src}`));
    kept.push(entry);
    kept.sort((a, b) => {
      const num = (s) => Number((/-(\d+)\.png/.exec(s) ?? [0, 0])[1]);
      const name = (s) => (/src: (\S+)/.exec(s) ?? [0, ""])[1].replace(/-\d+\.png$/, "");
      return name(a) === name(b) ? num(a) - num(b) : 0;
    });
    lines.splice(start, stop - start, "screenshots:", ...kept.join("\n").split("\n"));
    fm = lines.join("\n");
  }
  writeFileSync(file, fm + body);
}

/** Sets the Status cell of the shot-list row for this file. */
function markShotList(article, rowFile, status) {
  const file = join(ROOT, "content", "help", "SCREENSHOTS.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(`| ${article} | `) && l.includes(rowFile));
  if (i < 0) return false;
  const cells = lines[i].split(" | ");
  // Keep a hand-written note on a row that already records this file.
  const shotFile = /`([^`]+)`/.exec(status)?.[1];
  if (shotFile && cells[cells.length - 1].startsWith("Done") && cells[cells.length - 1].includes(shotFile)) return true;
  cells[cells.length - 1] = `${status} |`;
  lines[i] = cells.join(" | ");
  writeFileSync(file, lines.join("\n"));
  return true;
}

/* ------------------------------------------------------------ simulated */

async function demoContext() {
  const { data: business } = await admin.from("businesses").select("id, name, job_claims_paused").eq("slug", "blackwellen-demo").single();
  if (business.name !== "Blackwellen Ltd" || !business.job_claims_paused) throw new Error("Refusing: not the paused demo workspace.");
  const { data: owner } = await admin.from("profiles").select("id").eq("email", "alex.morgan@blackwellen-demo.example").single();
  const { LEADS } = await import("./seed-help-demo.mjs");
  const { data: leads } = await admin.from("leads").select("id, email").eq("business_id", business.id);
  const leadIds = {};
  for (const l of LEADS) {
    const core = l.company.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");
    const email = `${l.first.toLowerCase()}.${l.last.toLowerCase().replace(/[^a-z]/g, "")}@${core}.example`;
    const hit = (leads ?? []).find((r) => r.email === email);
    if (hit) leadIds[l.key] = hit.id;
  }
  const now = Date.now();
  return {
    admin,
    businessId: business.id,
    users: { owner: owner.id },
    leadIds,
    ago: (days, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000).toISOString(),
    bump: () => {},
  };
}

/* ------------------------------------------------------------ run */

async function explore(browser, path) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await open(page, path);
  // --click "Text one|role:button:Name|css:selector": steps to reach a state.
  for (const step of (opt("click") ?? "").split("|").filter(Boolean)) {
    const [kind, ...rest] = step.split(":");
    const target =
      kind === "role" ? page.getByRole(rest[0], { name: rest.slice(1).join(":") }).first()
      : kind === "css" ? page.locator(rest.join(":")).first()
      : kind === "in" ? card(page, rest[0]).getByRole("button", { name: rest[1], exact: true }).first()
      : page.getByText(step, { exact: true }).first();
    await target.click({ timeout: 15_000 }).catch((e) => console.log(`click ${step}: ${e.message.split("\n")[0]}`));
    await settle(page, 700);
  }
  const file = join(tmpdir(), `help-explore-${path.replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}.png`);
  await page.screenshot({ path: file, fullPage: !opt("click") });
  console.log(file);
  await context.close();
}

async function main() {
  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`${s.id.padEnd(48)} ${s.simulated ? "[simulated] " : ""}${s.file}`);
    return;
  }
  const browser = await chromium.launch();
  let simulatedCtx = null;
  const results = [];
  try {
    await signIn(browser);
    if (opt("explore")) {
      if (argv.includes("--simulated")) {
        const { seedSimulatedConnections } = await import("./lib/help-demo-simulated.mjs");
        await seedSimulatedConnections(await demoContext());
      }
      await explore(browser, opt("explore"));
      return;
    }
    // Shots needing a server without the Companies House key run only when named.
    const shots = SHOTS.filter((s) => (only ? only.includes(s.id) : !s.needsNoCompaniesHouseKey));
    const ctx = await demoContext();
    if (shots.some((s) => s.simulated)) {
      simulatedCtx = ctx;
      const { seedSimulatedConnections } = await import("./lib/help-demo-simulated.mjs");
      await seedSimulatedConnections(simulatedCtx);
      console.log("Simulated connections created (removed when this run ends).");
    }
    // Shots without simulated connections first, then those that need them.
    for (const shot of shots) {
      const context = await newContext(browser);
      const page = await context.newPage();
      try {
        if (shot.once && existsSync(join(OUT, shot.file))) {
          console.log(`  --  ${shot.id}: kept (one-time shot already captured)`);
          continue;
        }
        if (shot.before) await shot.before(ctx);
        await open(page, shot.resolveUrl ? shot.resolveUrl(ctx, shot.url) : shot.url, { tidy: shot.tidy !== false });
        if (shot.prepare) await shot.prepare(page);
        await settle(page, 500);
        const markers = (shot.markers?.(page) ?? []).map((m, i) => ({ n: i + 1, ...m }));
        const png = await captureRegion(page, shot.region(page), markers, { dark: shot.dark, pad: shot.pad });
        const file = join(OUT, shot.file);
        const info = await finish(png, shot.caption, file);
        const src = `/help/screenshots/${shot.file}`;
        const [category, name] = shot.file.split("/");
        addToFrontmatter(category, shot.article, src, shot.alt, shot.caption);
        if (shot.row) markShotList(shot.article, shot.row, `Done: \`${shot.file}\``);
        results.push({ id: shot.id, file: shot.file, ...info });
        console.log(`  ok  ${shot.id} -> ${shot.file} (${info.width}x${info.height}, ${Math.round(info.bytes / 1024)} KB)`);
      } catch (error) {
        results.push({ id: shot.id, error: error.message.split("\n")[0] });
        console.log(`  !!  ${shot.id}: ${error.message.split("\n")[0]}`);
        await page.screenshot({ path: join(tmpdir(), `help-fail-${shot.id}.png`), fullPage: true }).catch(() => {});
      } finally {
        if (shot.after) await shot.after(ctx).catch((e) => console.log(`  after ${shot.id}: ${e.message}`));
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (admin) {
      const { removeSimulatedConnections } = await import("./lib/help-demo-simulated.mjs");
      const { data: business } = await admin.from("businesses").select("id").eq("slug", "blackwellen-demo").maybeSingle();
      if (business) {
        const removed = await removeSimulatedConnections(admin, business.id);
        console.log("Simulated connections removed:", JSON.stringify(removed));
        const { finalSafetyCheck } = await import("./lib/help-demo-safety.mjs");
        console.log("Safety:", JSON.stringify(await finalSafetyCheck(admin, business.id)));
      }
    }
  }
  writeFileSync(join(tmpdir(), "help-capture-results.json"), JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
