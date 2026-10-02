/**
 * Settings -> Voice QA on a real Pro TEST workspace (2026-09-30). Each test is
 * a defect found in the browser or the pen test:
 *
 * - A calling-as name "<img src=x onerror=alert(1)>" was saved and would have
 *   been spoken in the locked opener and sent to Retell as a variable.
 * - The opener line accepted "{{transfer_number}}" (a Retell template).
 * - A transfer number of +44 909 (premium rate) was accepted: a transfer is a
 *   second outbound leg the platform pays for.
 * - The refusal said "a contact must be a postal address or a freephone
 *   number" whatever was actually wrong.
 * - A paid Pro workspace was told "trials don't place live calls".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { identityReadiness } from "../src/lib/voice/identity.ts";
import { validateEditableSuffix } from "../src/lib/voice/opener.ts";
import { validateVoiceSettingsUpdate } from "../src/lib/voice/settings-model.ts";
import { identityProblemText, STYLE_VIOLATION_TEXT } from "../src/lib/voice/settings-ui.ts";

const good = { callingAsName: "TEST Voice Studio", legalEntityName: "TEST Voice Studio Ltd", identificationContact: "0800 123 4567", personaName: "Ellie" };
const stored = { calling_as_name: good.callingAsName, legal_entity_name: good.legalEntityName, identification_contact: good.identificationContact, assistant_persona_name: "Ellie" };

describe("identity fields are speech, never markup", () => {
  test("a clean identity is ready", () => assert.equal(identityReadiness(good).ready, true));
  for (const field of ["callingAsName", "legalEntityName", "identificationContact", "personaName"] as const) {
    for (const bad of ["<img src=x onerror=alert(1)>", "{{transfer_number}}", "Acme > Co"]) {
      test(`${field} = ${bad} is refused`, () => {
        const r = identityReadiness({ ...good, [field]: field === "identificationContact" ? `1 Test Street, London ${bad}` : bad });
        assert.equal(r.ready, false);
        assert.ok(!r.ready && r.problems.some((p) => p.field === field && p.problem === "CONTAINS_MARKUP"));
      });
    }
  }
  test("the save refuses it and says why", () => {
    const problems = validateVoiceSettingsUpdate({ identity: { ...good, callingAsName: "<b>x</b>" } } as never, stored);
    assert.ok(problems.some((p) => p.field === "identity"));
    assert.equal(identityProblemText("callingAsName:CONTAINS_MARKUP"), "The name you call as can't contain <, >, { or }");
  });
  test("ordinary punctuation in a name still passes", () => {
    assert.equal(identityReadiness({ ...good, callingAsName: "O'Neill & Sons (UK) Ltd." }).ready, true);
  });
});

describe("the opener line", () => {
  test("template braces and markup are refused", () => {
    assert.ok(validateEditableSuffix("Call {{transfer_number}} now").includes("MARKUP"));
    assert.ok(validateEditableSuffix("<script>alert(1)</script>").includes("MARKUP"));
    assert.equal(STYLE_VIOLATION_TEXT.MARKUP, "Remove <, >, { and }.");
  });
  test("a normal line passes", () => assert.deepEqual(validateEditableSuffix("We help studios ship faster websites."), []));
});

describe("transfer numbers", () => {
  const t = (numberE164: string) => validateVoiceSettingsUpdate({ transfer: { mode: "ON_REQUEST", numberE164 } } as never, stored);
  for (const ok of ["+442071234567", "+447700900123", "+443001234567"]) {
    test(`${ok} is allowed`, () => assert.deepEqual(t(ok), []));
  }
  for (const bad of ["+449098790000", "+447012345678", "+448712345678", "+448001234567", "+12125551234", "+447612345678"]) {
    test(`${bad} is refused`, () => assert.ok(t(bad).some((p) => p.field === "transfer.numberE164" && p.problem === "NOT_ALLOWED")));
  }
  test("mode NEVER with no number is fine", () => {
    assert.deepEqual(validateVoiceSettingsUpdate({ transfer: { mode: "NEVER", numberE164: null } } as never, stored), []);
  });
});

describe("copy", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("the trial note shows only to a trialling workspace", () => {
    assert.match(src("src/components/settings/voice/voice-settings-panels.tsx"), /reasons\.includes\("TRIAL_ACCOUNT"\) && <p/);
  });
  test("the INVALID refusal names the real problem", () => {
    assert.match(src("src/lib/services/operations/voice.ts"), /identityInvalidMessage\(p\.identityProblems\)/);
  });
  test("a voice pack checkout returns to Voice, Budget", () => {
    const s = src("src/lib/billing/voice-purchase.ts");
    assert.match(s, /section=voice&panel=budget&voicepack=success/);
    assert.match(s, /section=voice&panel=budget&voicepack=cancelled/);
  });
});
