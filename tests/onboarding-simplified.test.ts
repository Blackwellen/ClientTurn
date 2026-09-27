import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ONBOARDING_STEPS,
  OPTIONAL_STEPS,
  canSkipToGoLive,
  defaultQualifyQuestions,
  defaultServicesFor,
  isOptionalStep,
  resolveOnboardingStep,
  suggestedServicesFor,
} from "../src/lib/onboarding/steps.ts";
import {
  INDUSTRY_KEYWORDS,
  extractSitePrefill,
  findPhone,
  guessIndustry,
  nameFromTitle,
  normaliseWebsite,
} from "../src/lib/onboarding/prefill.ts";
import {
  UNNAMED_WORKSPACE,
  isUnnamedWorkspace,
  validateWorkspaceName,
  workspaceNamePlaceholder,
} from "../src/lib/auth/workspace-name.ts";
import { signUpSchema } from "../src/lib/validation/auth.ts";
import { INDUSTRIES } from "../src/lib/settings/types.ts";

/** Phase 8.29: shorter onboarding, a hand-named workspace, website prefill. */

describe("workspace name is required and typed by hand", () => {
  test("empty, whitespace, placeholder, too short and too long are refused", () => {
    assert.equal(validateWorkspaceName("").ok, false);
    assert.equal(validateWorkspaceName("   ").ok, false);
    assert.equal(validateWorkspaceName(undefined).ok, false);
    assert.equal(validateWorkspaceName(42).ok, false);
    assert.equal(validateWorkspaceName(UNNAMED_WORKSPACE).ok, false);
    assert.equal(validateWorkspaceName(" unnamed WORKSPACE ").ok, false);
    assert.equal(validateWorkspaceName("A").ok, false);
    assert.equal(validateWorkspaceName("x".repeat(121)).ok, false);
  });

  test("a real name is trimmed and accepted, at both length limits", () => {
    assert.deepEqual(validateWorkspaceName("  Acme   Digital  "), { ok: true, name: "Acme Digital" });
    assert.equal(validateWorkspaceName("AB").ok, true);
    assert.equal(validateWorkspaceName("x".repeat(120)).ok, true);
  });

  test("the placeholder counts as unnamed; a real name does not", () => {
    assert.equal(isUnnamedWorkspace(UNNAMED_WORKSPACE), true);
    assert.equal(isUnnamedWorkspace(""), true);
    assert.equal(isUnnamedWorkspace(null), true);
    assert.equal(isUnnamedWorkspace("Acme"), false);
  });

  test("the domain guess is only ever a placeholder hint", () => {
    assert.equal(workspaceNamePlaceholder("sam@acme-digital.co.uk"), "e.g. Acme Digital");
    assert.equal(workspaceNamePlaceholder("sam@gmail.com"), "e.g. Acme Digital Ltd");
    assert.equal(workspaceNamePlaceholder(""), "e.g. Acme Digital Ltd");
  });

  test("signup no longer asks for a business name", () => {
    const parsed = signUpSchema.safeParse({
      firstName: "Sam",
      lastName: "Lee",
      email: "sam@acme.co.uk",
      password: "password1",
      terms: "on",
    });
    assert.equal(parsed.success, true);
    assert.equal("businessName" in signUpSchema.shape, false);
    const form = readFileSync("src/app/(auth)/signup/signup-form.tsx", "utf8");
    assert.doesNotMatch(form, /name="businessName"/);
  });

  test("the onboarding page never pre-fills the name and the action validates it server-side", () => {
    const page = readFileSync("src/app/onboarding/page.tsx", "utf8");
    assert.match(page, /isUnnamedWorkspace\(workspace\.businessName\) \? "" :/);
    const actions = readFileSync("src/lib/onboarding/actions.ts", "utf8");
    assert.match(actions, /validateWorkspaceName\(value\)\.ok/);
    const step = readFileSync("src/components/onboarding/steps/business-step.tsx", "utf8");
    assert.match(step, /placeholder=\{initial\.namePlaceholder\}/);
    assert.match(step, /const naming = validateWorkspaceName\(business\.name\)/);
  });
});

describe("step order, resume and skipping", () => {
  test("an unnamed workspace always opens on the business step, whatever was stored", () => {
    assert.equal(resolveOnboardingStep("qualify_book", true), "business");
    assert.equal(resolveOnboardingStep("copilot", true), "business");
    assert.equal(resolveOnboardingStep(null, true), "business");
  });

  test("a named workspace resumes where it left off; junk starts at the beginning", () => {
    assert.equal(resolveOnboardingStep("qualify_book", false), "qualify_book");
    assert.equal(resolveOnboardingStep("copilot", false), "copilot");
    assert.equal(resolveOnboardingStep("nonsense", false), ONBOARDING_STEPS[0]);
    assert.equal(resolveOnboardingStep(undefined, false), ONBOARDING_STEPS[0]);
  });

  test("only the business step and the final go-live are not optional", () => {
    assert.deepEqual(
      ONBOARDING_STEPS.filter((step) => !isOptionalStep(step)),
      ["business", "test_go_live"],
    );
    assert.equal(OPTIONAL_STEPS.length, ONBOARDING_STEPS.length - 2);
  });

  test("skip to go live is offered on every step but the last", () => {
    for (const step of ONBOARDING_STEPS) assert.equal(canSkipToGoLive(step), step !== "test_go_live", step);
  });

  test("the skip action keeps the name check and never skips activation", () => {
    const actions = readFileSync("src/lib/onboarding/actions.ts", "utf8");
    const body = actions.slice(actions.indexOf("export async function applyRecommendedSetup"));
    assert.match(body, /workspaceOrFail\(\)/);
    assert.match(body, /validateWorkspaceName\(business\.name\)\.ok/);
    assert.match(body, /saveQualifyBookStep\(/);
    assert.doesNotMatch(body, /status: "active"/);
  });
});

describe("recommended defaults", () => {
  test("a new workspace starts with three of its industry's services pre-selected", () => {
    for (const industry of INDUSTRIES) {
      const defaults = defaultServicesFor(industry);
      assert.equal(defaults.length, Math.min(3, suggestedServicesFor(industry).length), industry);
    }
    assert.deepEqual(defaultServicesFor(""), suggestedServicesFor("Other").slice(0, 3));
  });

  test("recommended questions are publishable: every choice question has two or more options", () => {
    for (const services of [[], ["SEO Audit"], ["SEO Audit", "Technical SEO", "Local SEO"], ["  ", "x", "SEO Audit", "SEO Audit"]]) {
      for (const question of defaultQualifyQuestions(services)) {
        assert.ok(question.options.length >= 2, `${question.questionText} with ${JSON.stringify(services)}`);
        assert.ok(question.options.length <= 12);
        assert.equal(new Set(question.options).size, question.options.length);
      }
    }
    const [service, timing] = defaultQualifyQuestions(["SEO Audit", "Local SEO"]);
    assert.deepEqual(service.options, ["SEO Audit", "Local SEO"]);
    assert.equal(service.required, true);
    assert.deepEqual(service.rule, { operator: "is_present", comparisonValue: [], result: "review" });
    assert.equal(timing.responseType, "timing");
    assert.equal(timing.rule, null, "timing is context, never a disqualifier");
  });
});

describe("prefill from the owner's website", () => {
  test("addresses are normalised to an origin, junk refused", () => {
    assert.equal(normaliseWebsite("acme.co.uk"), "https://acme.co.uk");
    assert.equal(normaliseWebsite("  https://WWW.Acme.co.uk/about?x=1 "), "https://www.acme.co.uk");
    assert.equal(normaliseWebsite("http://acme.com"), "http://acme.com");
    assert.equal(normaliseWebsite("localhost"), null);
    assert.equal(normaliseWebsite("ftp://acme.com"), null);
    assert.equal(normaliseWebsite(""), null);
  });

  test("the business name comes from the title's non-generic, shortest part", () => {
    assert.equal(nameFromTitle("Home | Acme Digital"), "Acme Digital");
    assert.equal(nameFromTitle("Acme Digital – Award-winning web design in Leeds"), "Acme Digital");
    assert.equal(nameFromTitle("Home"), null);
  });

  test("industry guesses only use onboarding's own labels", () => {
    for (const [label] of INDUSTRY_KEYWORDS) assert.ok((INDUSTRIES as readonly string[]).includes(label), label);
  });

  test("industry is guessed from what the page plainly says", () => {
    assert.equal(guessIndustry("We are a technical SEO agency: link building and local SEO."), "SEO agency");
    assert.equal(guessIndustry("Chartered accountants for year end accounts and corporation tax"), "Accountancy practice");
    assert.equal(guessIndustry("Web design and web development studio"), "Web / design studio");
    assert.equal(guessIndustry("Nothing to see here"), null);
  });

  test("phone from a tel: link first, then UK-shaped text; nothing otherwise", () => {
    assert.equal(findPhone('<a href="tel:+441134960000">Call</a>', ""), "+441134960000");
    assert.equal(findPhone("", "Call us on 0113 496 0000 today"), "0113 496 0000");
    assert.equal(findPhone("", "Order number 12345"), null);
  });

  test("a whole page", () => {
    const html = `<!doctype html><html><head><title>Home | Northwind Studio</title>
      <meta name="description" content="Northwind Studio is a web design &amp; web development studio in Leeds.">
      <meta property="og:site_name" content="Northwind Studio"></head>
      <body><script>var x = "seo agency";</script><h1>Websites that sell</h1>
      <p>Website design, website build and UX design.</p><a href="tel:0113 496 0000">0113 496 0000</a></body></html>`;
    const prefill = extractSitePrefill(html);
    assert.equal(prefill.siteName, "Northwind Studio");
    assert.equal(prefill.industry, "Web / design studio");
    assert.equal(prefill.phone, "0113 496 0000");
    assert.match(prefill.description ?? "", /web design & web development/);
  });
});
