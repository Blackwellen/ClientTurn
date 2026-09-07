/**
 * A small Chrome DevTools Protocol driver.
 *
 * The public-page checks need a real browser, and the two things they care
 * about are things a fetch cannot see: whether React hydrated, and what the
 * page actually looks like once it has settled. Chrome's own `--screenshot`
 * flag fires on the load event, before hydration, so every capture taken that
 * way is a picture of the server HTML rather than of the page.
 *
 * Deliberately dependency-free — Node 22+ ships a global `WebSocket`, and
 * Chrome is already on any machine that can look at the site. Adding a browser
 * automation framework to run two scripts is not a trade worth making.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

/** Where Chrome usually lives, by platform. `CHROME_PATH` overrides. */
const CANDIDATES = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
};

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const path of CANDIDATES[platform()] ?? []) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    "No Chrome found. Set CHROME_PATH to a Chrome or Edge executable.",
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launches Chrome and returns a client plus a `page()` factory.
 *
 * Each page is a fresh target. That is not tidiness: a single long-lived tab
 * accumulates enough state across a dozen full-page screenshots to crash its
 * renderer, and a crashed renderer screenshots as Chrome's "this page couldn't
 * load" screen — which then compares perfectly stable between runs and looks
 * like a passing check.
 */
export async function launch({ profile, reducedMotion = false } = {}) {
  const port = 9200 + Math.floor(Math.random() * 600);
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    `--remote-debugging-port=${port}`,
    "--window-size=1440,900",
  ];
  if (profile) args.push(`--user-data-dir=${profile}`);
  if (reducedMotion) args.push("--force-prefers-reduced-motion");
  args.push("about:blank");

  const chrome = spawn(findChrome(), args, { stdio: "ignore" });

  const wsUrl = await (async () => {
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        const json = await res.json();
        if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      } catch {
        /* Chrome is still starting. */
      }
      await sleep(150);
    }
    chrome.kill();
    throw new Error("Chrome never exposed a debugging endpoint");
  })();

  const client = await connect(wsUrl);

  return {
    /** Opens a new tab and returns a `send` bound to it, plus a closer. */
    async page({ initScript } = {}) {
      const { targetId } = await client.send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await client.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const send = (method, params) => client.send(method, params, sessionId);

      await send("Page.enable");
      await send("Runtime.enable");
      if (reducedMotion) {
        await send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
      }
      if (initScript) {
        await send("Page.addScriptToEvaluateOnNewDocument", {
          source: initScript,
        });
      }

      return {
        send,
        async evaluate(expression) {
          const res = await send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
          });
          if (res.exceptionDetails) {
            throw new Error(
              res.exceptionDetails.exception?.description ??
                `evaluate threw: ${expression.slice(0, 80)}`,
            );
          }
          return res.result?.value;
        },
        async close() {
          try {
            await client.send("Target.closeTarget", { targetId });
          } catch {
            /* already gone */
          }
        },
      };
    },
    close() {
      client.close();
      chrome.kill();
    },
  };
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve: ok, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(JSON.stringify(message.error)));
      else ok(message.result);
    });

    ws.addEventListener("error", reject);
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}, sessionId) {
          id += 1;
          ws.send(
            JSON.stringify({
              id,
              method,
              params,
              ...(sessionId && { sessionId }),
            }),
          );
          return new Promise((ok, fail) =>
            pending.set(id, { resolve: ok, reject: fail }),
          );
        },
        close: () => ws.close(),
      }),
    );
  });
}

/**
 * Navigates and waits for the page to be usable, then proves it is the page
 * that was asked for.
 *
 * The geometry assertion matters for the visual checks: a capture set whose
 * dimensions drift between runs cannot gate anything, because then every
 * image differs on size and the one real change is invisible.
 */
export async function open(page, url, { path, width, height, settleMs = 2600 }) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send("Page.navigate", { url });

  for (let i = 0; i < 80; i += 1) {
    const ready = await page.evaluate(
      "document.readyState === 'complete' && !!document.querySelector('main *')",
    );
    if (ready) break;
    await sleep(250);
  }
  await sleep(settleMs);
  await page.evaluate("window.scrollTo(0, 0)");
  await sleep(500);

  const state = JSON.parse(
    await page.evaluate(`JSON.stringify({
      path: location.pathname,
      chrome: !!document.querySelector("header") && !!document.querySelector("footer"),
      heading: (document.querySelector("h1") || {}).textContent || "",
      layoutWidth: document.documentElement.clientWidth,
    })`),
  );

  if (path && state.path !== path) {
    throw new Error(`expected ${path}, landed on ${state.path}`);
  }
  if (!state.chrome || !state.heading.trim()) {
    throw new Error(
      `${url} did not render the page: ${JSON.stringify(state)}`,
    );
  }
  if (state.layoutWidth !== width) {
    throw new Error(
      `${url} laid out at ${state.layoutWidth}px, expected ${width}px — ` +
        "geometry must match across runs for a diff to mean anything",
    );
  }
}

/** Accepts the cookie banner so it cannot cover the page under test. */
export const CONSENT_SCRIPT = `
  try { localStorage.setItem("lr.cookie-consent", "accepted"); } catch {}
`;

/** Collects page errors so a check can assert the console stayed clean. */
export const ERROR_COLLECTOR = `
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push(String(e.message)));
  addEventListener("unhandledrejection", (e) =>
    window.__errors.push("unhandled rejection: " + String(e.reason)));
  const original = console.error;
  console.error = (...args) => {
    window.__errors.push(args.map(String).join(" ").slice(0, 240));
    original.apply(console, args);
  };
`;
