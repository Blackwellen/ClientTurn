import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Pins the fixes from the public site / admin / affiliate / help QA pass of
 * 2026-09-28. Source-level checks: each one names the defect it guards.
 */

const read = (path: string) => readFileSync(path, "utf8");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

describe("metadata", () => {
  test("every public page that sets openGraph also sets an image (a page's openGraph replaces the root's, image included)", () => {
    const files = [...pages("src/app/(marketing)"), "src/app/status/page.tsx"];
    const missing = files.filter((file) => {
      const source = read(file);
      return /openGraph:\s*\{/.test(source) && !/OG_IMAGES/.test(source);
    });
    assert.deepEqual(missing, []);
  });

  test("the root layout declares no canonical or og:url for every route to inherit", () => {
    const layout = read("src/app/layout.tsx");
    assert.doesNotMatch(layout, /alternates:\s*\{\s*canonical/);
    assert.doesNotMatch(layout, /url:\s*"\/"/);
    assert.match(read("src/app/(marketing)/page.tsx"), /alternates:\s*\{\s*canonical:\s*"\/"\s*\}/);
  });

  test("the Terms header shows the version customers accept", () => {
    const terms = read("src/app/(marketing)/terms/page.tsx");
    assert.match(terms, /TERMS_VERSION/);
    assert.match(terms, /version=\{TERMS_VERSION_LABEL\}/);
  });
});

describe("sign-in", () => {
  test("the Google button is a plain anchor, so it is never prefetched into an OAuth redirect", () => {
    const source = read("src/components/auth/google-signin-button.tsx");
    assert.doesNotMatch(source, /from "next\/link"/);
    assert.match(source, /<a\s/);
  });

  test("partner sign-up agrees to the Affiliate Programme Terms, not the customer Terms", () => {
    const source = read("src/app/affiliates/signup/signup-form.tsx");
    assert.match(source, /href="\/affiliates\/terms"/);
    assert.doesNotMatch(source, /href="\/terms"/);
  });
});

describe("reduced motion hydrates cleanly", () => {
  test("ScrollProgress renders on both sides (hidden by CSS), never null on a reduced-motion client", () => {
    const reveal = read("src/components/marketing/public/reveal.tsx");
    const body = reveal.slice(reveal.indexOf("export function ScrollProgress"), reveal.indexOf("export function Drift"));
    assert.doesNotMatch(body, /return null/);
    assert.match(read("src/app/(marketing)/evaluation.css"), /prefers-reduced-motion[\s\S]*\.pub-scroll-progress\s*\{\s*display:\s*none/);
  });

  test("find-leads reads reduced motion through a hook whose server snapshot is used while hydrating", () => {
    const motion = read("src/components/marketing/find-leads/motion.tsx");
    assert.match(motion, /useSyncExternalStore\(subscribeReduced, reducedSnapshot, reducedServerSnapshot\)/);
    assert.doesNotMatch(motion, /useReducedMotion,\s*\n\s*type Transition/);
    assert.match(read("src/components/marketing/find-leads/motion-root.tsx"), /from "\.\/motion"/);
  });
});

describe("copy has a basis", () => {
  test("no public page claims licensed data providers (sources are first-party and free, resolved conflict 7)", () => {
    const files = [
      "src/app/(marketing)/pricing/page.tsx",
      "src/app/(marketing)/how-it-works/page.tsx",
      "src/app/(marketing)/product/find-leads/page.tsx",
      "src/components/marketing/public/how-it-works/architecture.tsx",
      "src/components/marketing/find-leads/data.ts",
      "src/components/marketing/find-leads/intent/intent-panel.tsx",
    ];
    for (const file of files) {
      assert.doesNotMatch(read(file), /licensed (data |company data |contact data )?providers?|Licensed (company|contact) data|Verification providers/i, file);
    }
  });

  test("the sample partner portal is consistent with the tier rules (fewer than 5 paid customers stays on 6%)", () => {
    const frame = read("src/components/marketing/public/home/partner-frame.tsx");
    const paid = Number(/label="Paid customers" value="(\d+)"/.exec(frame)?.[1]);
    assert.ok(paid < 5, `sample shows ${paid} paid customers on the 6% Partner tier`);
    assert.match(frame, /6% one-off commission/);
  });

  test("the home proof section does not call sample screens 'real product proof'", () => {
    assert.doesNotMatch(read("src/components/marketing/public/home/product-proof.tsx"), /Real product proof/);
  });
});

describe("admin", () => {
  test("the scheduled-deletions read re-asserts platform admin before using the service role", () => {
    const source = read("src/lib/admin/workspace-deletions.ts");
    assert.match(source, /await adminRead\(\)/);
    assert.doesNotMatch(source, /createAdminClient\(\)/);
  });

  test("the readiness view asserts the operator role itself", () => {
    const system = read("src/app/admin/(ops)/system/page.tsx");
    const body = system.slice(system.indexOf("async function ReadinessView"), system.indexOf("async function HealthView"));
    assert.match(body, /await requirePlatformAdmin\(\)/);
  });

  test("the affiliate export needs a recent step-up and the buttons offer it", () => {
    const route = read("src/app/admin/(ops)/affiliates/export/route.ts");
    assert.match(route, /hasStepUp\(operator\.id\)/);
    assert.match(route, /step_up_required/);
    const panel = read("src/components/admin/affiliates/programme-panels.tsx");
    assert.match(panel, /StepUpDialog/);
  });
});

describe("help centre", () => {
  test("LinkedIn Assist has an article, linked from the assisted and compliance articles", () => {
    assert.match(read("content/help/finding-leads/linkedin-assist.md"), /Follow-Up → LinkedIn Assist/);
    assert.match(read("content/help/finding-leads/linkedin-sales-navigator-assisted.md"), /\/help\/finding-leads\/linkedin-assist\)/);
    assert.match(read("content/help/compliance/linkedin-and-social-messages.md"), /\/help\/finding-leads\/linkedin-assist\)/);
  });

  test("the voice article no longer says voicemail and inbound calls are missing", () => {
    const voice = read("content/help/voice/setting-up-the-ai-voice-agent.md");
    assert.doesNotMatch(voice, /does not leave voicemail|An inbound call to that number is ended/);
    assert.match(voice, /AI assistant switched on/);
  });

  test("invoice pay links, permissions and the audit export are documented", () => {
    assert.match(read("content/help/booking-and-sales/invoices.md"), /How invoices are paid/);
    assert.match(read("content/help/settings/team-settings.md"), /## Permissions/);
    assert.match(read("content/help/settings/data-controls-settings.md"), /Audit log export/);
  });
});
