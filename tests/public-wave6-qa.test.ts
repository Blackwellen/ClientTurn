import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formBotVerdict } from "@/lib/security/form-bot-check";
import { formatSalesEnquiryEmail, headerSafe } from "@/lib/marketing/sales-enquiry-email";
import { queueStatus } from "@/lib/status/types";
import { PLANS } from "@/lib/billing/plans";

/**
 * Pins the fixes from the public-site surface QA (wave 6, 2026-09-30). Each
 * test names the defect it guards.
 */

const read = (path: string) => readFileSync(path, "utf8");
const NOW = 1_790_000_000_000;

describe("public form bot checks", () => {
  test("a submission without startedAt is not waved through (it used to skip the timing check)", () => {
    for (const startedAt of [null, "", "abc", "0", "-5", "1e12"]) {
      assert.equal(formBotVerdict({ honeypot: "", startedAt, minSeconds: 3, now: NOW }), "no-timing", String(startedAt));
    }
  });

  test("a start time in the future is not credible", () => {
    assert.equal(formBotVerdict({ honeypot: null, startedAt: String(NOW + 5 * 60_000), minSeconds: 3, now: NOW }), "no-timing");
  });

  test("honeypot, too fast and a real person", () => {
    assert.equal(formBotVerdict({ honeypot: "http://spam", startedAt: String(NOW - 60_000), minSeconds: 3, now: NOW }), "honeypot");
    assert.equal(formBotVerdict({ honeypot: "", startedAt: String(NOW - 1_000), minSeconds: 3, now: NOW }), "too-fast");
    assert.equal(formBotVerdict({ honeypot: "", startedAt: String(NOW - 30_000), minSeconds: 3, now: NOW }), "ok");
  });

  test("both forms send startedAt from a ref at submit (a hidden input was reset to defaultValue on re-render) and submit without React's form reset", () => {
    for (const file of [
      "src/components/marketing/public/contact-sales/sales-form.tsx",
      "src/components/marketing/public/privacy-request/privacy-request-form.tsx",
    ]) {
      const source = read(file);
      assert.match(source, /formData\.set\("startedAt", String\(startedAt\.current\)\)/, file);
      assert.doesNotMatch(source, /startedAt\.current\.value/, file);
      assert.match(source, /<form onSubmit=\{onSubmit\}/, file);
    }
  });

  test("both actions use the shared verdict, and contact-sales uses the atomic limiter", () => {
    const sales = read("src/app/(marketing)/contact-sales/actions.ts");
    const privacy = read("src/app/(marketing)/privacy-request/actions.ts");
    assert.match(sales, /formBotVerdict\(/);
    assert.match(privacy, /formBotVerdict\(/);
    assert.match(sales, /checkRateLimit\("marketing:enquiry"/);
  });
});

describe("sales enquiries reach a person", () => {
  test("the action emails the enquiry to the sales mailbox after recording it", () => {
    const source = read("src/app/(marketing)/contact-sales/actions.ts");
    assert.match(source, /await notifySales\(input\)/);
    assert.match(source, /to: \[COMPANY\.supportEmail\]/);
  });

  test("the email is plain text with the enquirer as Reply-To and no header injection", () => {
    const email = formatSalesEnquiryEmail({
      firstName: "Ada\r\nBcc: victim@example.com",
      lastName: "Lovelace",
      email: "ada@example.com",
      company: "Analytical <b>Engines</b>",
      companySize: "1–10",
      leadVolume: "Under 250",
      useCase: "Something else",
      currentSystems: ["CRM", "Email"],
      message: "<script>alert(1)</script>",
      marketingConsent: false,
    });
    assert.doesNotMatch(email.subject, /[\r\n]/);
    assert.equal(email.replyTo, "ada@example.com");
    assert.match(email.text, /Current systems: CRM, Email/);
    assert.match(email.text, /Marketing consent: No/);
    assert.equal(headerSafe("a\u0000b\nc"), "a b c");
  });
});

describe("public contact details", () => {
  test("no public page or form error points at the unmonitored privacy@clientturn.co.uk", () => {
    for (const file of [
      "src/app/(marketing)/privacy-request/actions.ts",
      "src/app/(marketing)/data-deletion/page.tsx",
    ]) {
      assert.doesNotMatch(read(file), /privacy@clientturn\.co\.uk/, file);
    }
  });
});

describe("unsubscribe page", () => {
  test("'You've been unsubscribed' comes from the record, not from ?status=done", () => {
    const page = read("src/app/unsubscribe/[token]/page.tsx");
    assert.match(page, /subject\.unsubscribed\s*\?\s*\{ kind: "done"/);
    assert.doesNotMatch(page, /status === "done"\s*\?/);
    const lib = read("src/lib/email/unsubscribe.ts");
    assert.match(lib, /unsubscribed: lead\.opted_out === true/);
    assert.match(lib, /unsubscribed: prospect\.status === "UNSUBSCRIBED"/);
  });
});

describe("public status page", () => {
  test("one dead job does not publish an outage (it did: 1 of 3 message.send)", () => {
    assert.equal(queueStatus(1, 3), "OPERATIONAL");
    assert.equal(queueStatus(2, 2), "OPERATIONAL");
    assert.equal(queueStatus(3, 6), "OUTAGE");
    assert.equal(queueStatus(5, 50), "DEGRADED");
    assert.equal(queueStatus(3, 10_000), "OPERATIONAL");
    assert.equal(queueStatus(0, 0), "OPERATIONAL");
  });

  test("two degraded services headline as degraded, not as an outage", () => {
    assert.doesNotMatch(read("src/lib/status/service.ts"), /degraded >= 2/);
  });
});

describe("marketing copy and markup", () => {
  test("home and product demos use the B2B ICP, not construction or property samples", () => {
    for (const file of [
      "src/components/marketing/public/home/capabilities.tsx",
      "src/components/marketing/public/home/growth-path.tsx",
      "src/components/marketing/public/home/how-it-works.tsx",
      "src/components/marketing/lead-conversion/data.ts",
      "src/components/marketing/lead-conversion/leak/leak-section.tsx",
      "src/app/(marketing)/results/page.tsx",
    ]) {
      assert.doesNotMatch(
        read(file),
        /Riverside Homes|Oakwood Developments|Smith Construction|Acme Construction|Residential developer|Property developer|new roof|Property location|project located|Commercial builders/,
        file,
      );
    }
  });

  test("marketing components read reduced motion hydration-safely (motion's hook mismatched the server HTML)", () => {
    for (const file of [
      "src/components/marketing/public/revenue/journey.tsx",
      "src/components/marketing/public/revenue/live-call.tsx",
      "src/components/marketing/public/home/product-proof.tsx",
      "src/components/marketing/public/reveal.tsx",
      "src/components/marketing/public/sdr-calculator/calculator.tsx",
      "src/components/marketing/lead-conversion/motion.tsx",
      "src/components/marketing/lead-conversion/use-stage.ts",
    ]) {
      const source = read(file);
      assert.match(source, /from "@\/components\/marketing\/use-reduced-motion"/, file);
      assert.doesNotMatch(source, /import\s*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from "motion\/react"/, file);
    }
  });

  test("the affiliates title is not doubled by the root template", () => {
    assert.doesNotMatch(read("src/app/(marketing)/affiliates/page.tsx"), /title: `\$\{affiliatesTitle\} \| ClientTurn`/);
  });

  test("capability links have descriptive text", () => {
    assert.match(read("src/components/marketing/public/home/capabilities.tsx"), /Learn more<span className="sr-only"> about \{capability\.title\}<\/span>/);
  });

  test("next.config drops X-Powered-By", () => {
    assert.match(read("next.config.ts"), /poweredByHeader: false/);
  });

  test("plan lead limits the public pages advertise are the code's (Growth is 400, not the 500 Stripe used to say)", () => {
    assert.equal(PLANS.growth.leadLimit, 400);
    assert.equal(PLANS.pro.leadLimit, 1000);
    const help = read("content/help/billing/plans-and-pricing.md");
    assert.match(help, /\| New leads \| 100 \| 400 \| 1,000 \| Custom \|/);
  });
});
