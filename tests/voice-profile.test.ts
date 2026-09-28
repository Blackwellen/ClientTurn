/**
 * Voice P3: how the assistant sounds (src/lib/voice/voice-profile.ts), and
 * the premium-voice surcharge in minutes and in the cost ledger. Pure.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BRITISH_VOICE_CANDIDATES,
  DEFAULT_VOICE_PROFILE,
  PREMIUM_MINUTE_FACTOR,
  PREMIUM_TTS_EXTRA_USD_PER_MIN,
  isPremiumProfile,
  parseVoiceProfile,
  premiumBilledSec,
  voiceAgentFields,
  voiceProfileProblems,
} from "../src/lib/voice/voice-profile.ts";
import { estimateCallCost, callCostLines } from "../src/lib/voice/cost.ts";
import { agentOverrideOf } from "../src/lib/voice/providers/retell-protocol.ts";
import { voiceSettingsUpdateSchema, sectionsTouched } from "../src/lib/voice/settings-model.ts";

describe("the voice profile", () => {
  test("defaults: no voice forced, a natural conversational feel", () => {
    assert.equal(DEFAULT_VOICE_PROFILE.voiceId, null);
    const fields = voiceAgentFields(DEFAULT_VOICE_PROFILE);
    assert.equal(fields.voice_id, undefined, "no hard-coded voice: the agent's own is used");
    assert.equal(fields.responsiveness, 0.85);
    assert.equal(fields.interruption_sensitivity, 0.75);
    assert.equal(fields.enable_backchannel, true);
    assert.equal(fields.ambient_sound, undefined);
    assert.equal(fields.voice_speed, undefined);
  });

  test("every candidate is British English and ElevenLabs is the only premium provider", () => {
    assert.ok(BRITISH_VOICE_CANDIDATES.length >= 10);
    for (const c of BRITISH_VOICE_CANDIDATES) {
      const p = parseVoiceProfile({ voiceId: c.voiceId });
      assert.equal(voiceProfileProblems(p).length === 0, c.provider !== "elevenlabs", c.voiceId);
    }
  });

  test("a premium voice is used only with the surcharge accepted", () => {
    const refused = parseVoiceProfile({ voiceId: "11labs-Amy" });
    assert.deepEqual(voiceProfileProblems(refused), ["PREMIUM_NOT_ACCEPTED"]);
    assert.equal(voiceAgentFields(refused).voice_id, undefined);
    assert.equal(isPremiumProfile(refused), false);
    const accepted = parseVoiceProfile({ voiceId: "11labs-Amy", premiumAccepted: true });
    assert.equal(voiceAgentFields(accepted).voice_id, "11labs-Amy");
    assert.equal(isPremiumProfile(accepted), true);
  });

  test("an unknown voice id is refused; a bad stored profile reads as the default", () => {
    assert.deepEqual(voiceProfileProblems(parseVoiceProfile({ voiceId: "made-up-voice" })), ["UNKNOWN_VOICE"]);
    assert.deepEqual(parseVoiceProfile({ speed: 9 }), DEFAULT_VOICE_PROFILE);
    assert.deepEqual(parseVoiceProfile("nonsense"), DEFAULT_VOICE_PROFILE);
  });

  test("the fields ride on the per-call agent override", () => {
    const o = agentOverrideOf({ voice: voiceAgentFields(parseVoiceProfile({ voiceId: "cartesia-Willa", speed: 1.05, ambient: "call-center" })) });
    assert.deepEqual(o, {
      agent: { responsiveness: 0.85, interruption_sensitivity: 0.75, enable_backchannel: true, backchannel_frequency: 0.5, ambient_sound: "call-center", voice_id: "cartesia-Willa", voice_speed: 1.05 },
    });
  });

  test("Settings accepts a voice profile under the agent section", () => {
    const parsed = voiceSettingsUpdateSchema.parse({ voiceProfile: { voiceId: "openai-Amy" } });
    assert.deepEqual(sectionsTouched(parsed), ["agent"]);
  });
});

describe("premium voice: +£0.20 a minute", () => {
  test("the minute factor covers the surcharge at the cheapest pack rate", () => {
    assert.equal(PREMIUM_MINUTE_FACTOR, 1.45);
    assert.ok(0.449 * PREMIUM_MINUTE_FACTOR >= 0.449 + 0.2);
    assert.equal(premiumBilledSec(60), 87);
    assert.equal(premiumBilledSec(0), 0);
  });

  test("the extra TTS cost is its own estimated ledger line; a provider figure already includes it", () => {
    assert.equal(Math.round(PREMIUM_TTS_EXTRA_USD_PER_MIN * 1000) / 1000, 0.025);
    const lines = estimateCallCost({ callId: "c", durationSec: 120, toE164: "+447700900123", recording: false, premiumTtsExtraUsdPerMin: PREMIUM_TTS_EXTRA_USD_PER_MIN });
    const premium = lines.find((l) => l.metric === "PREMIUM_VOICE_MINUTE");
    assert.equal(premium?.totalUsd, 0.05);
    const provider = callCostLines({ callId: "c", durationSec: 120, toE164: null, recording: false, providerCostCents: 30, premiumTtsExtraUsdPerMin: PREMIUM_TTS_EXTRA_USD_PER_MIN });
    assert.deepEqual(provider.map((l) => l.metric), ["VOICE_AI_MINUTE"]);
  });
});

describe("the provisional default voice and a human feel (voice QA pass)", () => {
  test("the default is a listed, standard-price British voice; the male alternative too", async () => {
    const { PROVISIONAL_DEFAULT_VOICE_ID, MALE_ALTERNATIVE_VOICE_ID, candidateFor } = await import("../src/lib/voice/voice-profile.ts");
    for (const id of [PROVISIONAL_DEFAULT_VOICE_ID, MALE_ALTERNATIVE_VOICE_ID]) {
      const c = candidateFor(id);
      assert.ok(c, id);
      assert.notEqual(c!.provider, "elevenlabs", "the default never carries the premium surcharge");
    }
    assert.equal(BRITISH_VOICE_CANDIDATES.length, 23);
  });

  test("British backchannel, speed 1, no fake background", async () => {
    const { BRITISH_BACKCHANNEL_WORDS, DEFAULT_VOICE_FEEL, END_CALL_AFTER_SILENCE_MS, REMINDER_AFTER_SILENCE_MS } = await import("../src/lib/voice/voice-profile.ts");
    assert.deepEqual([...BRITISH_BACKCHANNEL_WORDS], ["mm", "right", "yeah", "okay"]);
    assert.equal(DEFAULT_VOICE_FEEL.speed, 1);
    assert.equal(DEFAULT_VOICE_FEEL.ambient, "none");
    assert.ok(REMINDER_AFTER_SILENCE_MS < END_CALL_AFTER_SILENCE_MS);
  });
});
