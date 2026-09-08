import { CONSENT_SCRIPT, ERROR_COLLECTOR, launch, open, sleep } from "./lib/headless-chrome.mjs";
const origin = process.env.E2E_ORIGIN ?? "http://127.0.0.1:3001";
const browser = await launch({ reducedMotion: false });
const page = await browser.page({ initScript: CONSENT_SCRIPT + ERROR_COLLECTOR });
await open(page, origin + "/product/find-leads", { path: "/product/find-leads", width: 1440, height: 900 });

// scroll to the prospects section area first, mimicking a user
console.log("errors after load:", await page.evaluate("JSON.stringify(window.__errors)"));

const btnInfo = await page.evaluate(`(() => {
  const btns = [...document.querySelectorAll(".fl-filter")];
  return JSON.stringify(btns.map(b => b.textContent.trim()));
})()`);
console.log("filter buttons found:", btnInfo);

const rectInfo = await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(".fl-filter")].find(b => b.textContent.includes("A Grade"));
  if (!btn) return "not found";
  const r = btn.getBoundingClientRect();
  return JSON.stringify({top: r.top, left: r.left, w: r.width, h: r.height, visible: r.top >=0 && r.top < 900});
})()`);
console.log("A Grade button rect:", rectInfo);

// scroll it into view for real, then click via evaluate
await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(".fl-filter")].find(b => b.textContent.includes("A Grade"));
  btn.scrollIntoView({block:"center"});
})()`);
await sleep(600);

const before = await page.evaluate('document.querySelectorAll(".fl-table tbody tr").length');
console.log("rows before:", before);

await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(".fl-filter")].find(b => b.textContent.includes("A Grade"));
  btn.click();
})()`);
await sleep(900);

const after = await page.evaluate('document.querySelectorAll(".fl-table tbody tr").length');
console.log("rows after:", after);
console.log("errors after click:", await page.evaluate("JSON.stringify(window.__errors)"));
const pressed = await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(".fl-filter")].find(b => b.textContent.includes("A Grade"));
  return btn.getAttribute("aria-pressed");
})()`);
console.log("aria-pressed:", pressed);

await page.close();
browser.close();
