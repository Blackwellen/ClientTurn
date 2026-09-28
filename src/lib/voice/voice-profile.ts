/**
 * How the assistant sounds (voice P3, owner request 2026-09-28: the call must
 * sound genuinely human). Pure: the settings form, the dial path, the setup
 * script and the tests read this one module.
 *
 * A profile is stored per workspace (`voice_settings.voice_profile`, 0162)
 * and sent per call as Retell `agent_override.agent` fields, so one Retell
 * agent serves every workspace with its own voice.
 *
 * Retell agent fields used (docs.retellai.com api-references/create-agent,
 * checked 2026-09-27): `voice_id`, `responsiveness` [0,1],
 * `interruption_sensitivity` [0,1], `enable_backchannel`,
 * `backchannel_frequency` [0,1], `ambient_sound` (coffee-shop |
 * convention-hall | summer-outdoor | mountain-outdoor | static-noise |
 * call-center), `ambient_sound_volume`. UNVERIFIED: `voice_speed` (believed
 * 0.5..2, default 1) was not in the fields read; it is sent only when the
 * owner moves it off 1.0.
 *
 * No final voice is hard-coded. The candidates below are Retell's British
 * English voices as listed by GET /list-voices on 2026-09-28 (read-only);
 * a voice QA pass chooses the default against cost. Until then a workspace
 * with no choice uses the Retell agent's own voice (RETELL_VOICE_ID in the
 * setup script).
 *
 * Premium voice: ElevenLabs costs about $0.025/min more than the stack A
 * TTS ($0.040 against $0.015, 12-voice-provider-research.md §2.1). It is
 * offered only as premium voice at +£0.20 a minute (research §8), which the
 * owner must accept explicitly; minutes on a premium call are settled at
 * PREMIUM_MINUTE_FACTOR (see below).
 */

import { z } from "zod";

export const VOICE_PROVIDERS = ["cartesia", "elevenlabs", "openai", "platform", "inworld", "fish_audio", "minimax"] as const;
export type VoiceProviderKey = (typeof VOICE_PROVIDERS)[number];

export const VOICE_PROVIDER_LABEL: Readonly<Record<VoiceProviderKey, string>> = {
  cartesia: "Cartesia",
  elevenlabs: "ElevenLabs (premium)",
  openai: "OpenAI",
  platform: "Retell",
  inworld: "Inworld",
  fish_audio: "Fish Audio",
  minimax: "MiniMax",
};

/** TTS $/min through Retell (research §2.1: $0.015 standard, ElevenLabs $0.040). */
export const TTS_USD_PER_MIN: Readonly<Record<VoiceProviderKey, number>> = {
  cartesia: 0.015,
  openai: 0.015,
  platform: 0.015,
  inworld: 0.015,
  fish_audio: 0.015,
  minimax: 0.015,
  elevenlabs: 0.04,
};
export const STANDARD_TTS_USD_PER_MIN = 0.015;

/** ElevenLabs over the standard TTS: $0.040 - $0.015 = $0.025 a minute. */
export const PREMIUM_TTS_EXTRA_USD_PER_MIN = TTS_USD_PER_MIN.elevenlabs - STANDARD_TTS_USD_PER_MIN;

export function isPremiumProvider(provider: VoiceProviderKey | null | undefined): boolean {
  return provider === "elevenlabs";
}

/** The retail surcharge for premium voice (research §8, OD-2 table). */
export const PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN = 0.2;
/** The cheapest retail minute: the 1,000-minute pack, £449 (billing/plans.ts). */
export const CHEAPEST_RETAIL_GBP_PER_MIN = 0.449;
/**
 * Prepaid minutes have no money in them, so the surcharge is taken in
 * minutes: a premium call's seconds are settled at this factor, rounded up to
 * two places: 1 + 0.20 / 0.449 = 1.4454 -> 1.45, so one premium minute costs
 * at least £0.651 at the cheapest pack rate (£0.449 + £0.20).
 */
export const PREMIUM_MINUTE_FACTOR = Math.ceil((1 + PREMIUM_VOICE_SURCHARGE_GBP_PER_MIN / CHEAPEST_RETAIL_GBP_PER_MIN) * 100) / 100;

export function premiumBilledSec(actualSec: number): number {
  return Math.ceil(Math.max(0, actualSec) * PREMIUM_MINUTE_FACTOR);
}

export const AMBIENT_SOUNDS = ["none", "coffee-shop", "convention-hall", "summer-outdoor", "mountain-outdoor", "static-noise", "call-center"] as const;
export type AmbientSound = (typeof AMBIENT_SOUNDS)[number];

export type VoiceCandidate = { voiceId: string; provider: VoiceProviderKey; name: string; gender: "female" | "male"; age: string };

/** British English voices from GET /list-voices (2026-09-28). Not a ranking. */
export const BRITISH_VOICE_CANDIDATES: readonly VoiceCandidate[] = [
  { voiceId: "cartesia-Willa", provider: "cartesia", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "cartesia-Eve", provider: "cartesia", name: "Eve", gender: "female", age: "Middle aged" },
  { voiceId: "cartesia-Maren", provider: "cartesia", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "cartesia-Adam", provider: "cartesia", name: "Adam", gender: "male", age: "Middle aged" },
  { voiceId: "cartesia-Anthony", provider: "cartesia", name: "Anthony", gender: "male", age: "Middle aged" },
  { voiceId: "openai-Amy", provider: "openai", name: "Amy", gender: "female", age: "Young" },
  { voiceId: "openai-Anthony", provider: "openai", name: "Anthony", gender: "male", age: "Middle aged" },
  { voiceId: "openai-Fable", provider: "openai", name: "Fable", gender: "male", age: "Young" },
  { voiceId: "retell-Willa", provider: "platform", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "retell-Maren", provider: "platform", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "inworld-Eleanor", provider: "inworld", name: "Eleanor", gender: "female", age: "Middle aged" },
  { voiceId: "inworld-Duncan", provider: "inworld", name: "Duncan", gender: "male", age: "Middle aged" },
  { voiceId: "inworld-Willa", provider: "inworld", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "inworld-Maren", provider: "inworld", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "fish_audio-Willa", provider: "fish_audio", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "fish_audio-Maren", provider: "fish_audio", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "minimax-Willa", provider: "minimax", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "minimax-Maren", provider: "minimax", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "11labs-Willa", provider: "elevenlabs", name: "Willa", gender: "female", age: "Middle aged" },
  { voiceId: "11labs-Dorothy", provider: "elevenlabs", name: "Dorothy", gender: "female", age: "Young" },
  { voiceId: "11labs-Amy", provider: "elevenlabs", name: "Amy", gender: "female", age: "Young" },
  { voiceId: "11labs-Maren", provider: "elevenlabs", name: "Maren", gender: "female", age: "Young" },
  { voiceId: "11labs-Anthony", provider: "elevenlabs", name: "Anthony", gender: "male", age: "Middle aged" },
];

export function candidateFor(voiceId: string | null | undefined): VoiceCandidate | null {
  return BRITISH_VOICE_CANDIDATES.find((c) => c.voiceId === voiceId) ?? null;
}

/**
 * The platform default voice (voice QA pass, 2026-09-28; docs/VOICE.md
 * §16.15). PROVISIONAL until the owner has listened to the shortlist on a
 * test call: no voice was heard in this pass (zero spend), so the choice
 * rests on provider quality, latency and cost, not a listening test.
 *
 *   cartesia-Willa    British, female, middle aged. Cartesia Sonic is built
 *                     for low-latency conversational speech, and the stack A
 *                     TTS price ($0.015/min) keeps the 75% stressed margin.
 *   cartesia-Anthony  the male alternative on the same provider and price.
 *   11labs-*          the most natural prosody on the list, but $0.040/min
 *                     and premium voice only (+£0.20/min, owner accepts).
 */
export const PROVISIONAL_DEFAULT_VOICE_ID = "cartesia-Willa";
export const MALE_ALTERNATIVE_VOICE_ID = "cartesia-Anthony";

/**
 * British backchannel words: short, low-key acknowledgements a UK caller
 * would hear from a person ("mm", "right", "yeah", "okay"). "I see" and
 * "uh-huh" read as American or scripted.
 */
export const BRITISH_BACKCHANNEL_WORDS: readonly string[] = ["mm", "right", "yeah", "okay"];

/** Hang up after this much silence (Retell end_call_after_silence_ms); a reminder is spoken first. */
export const END_CALL_AFTER_SILENCE_MS = 20_000;
/** One gentle "are you still there?" before that (Retell reminder_trigger_ms). */
export const REMINDER_AFTER_SILENCE_MS = 8_000;

/**
 * Conversation feel (voice QA pass, 2026-09-28). A touch slower to jump in
 * than the first defaults (UK B2B callers pause mid-thought, and a reply
 * that lands on a breath sounds robotic), a little less easily interrupted
 * (a bad line or a train should not cut the assistant off), backchannel a
 * little less often (every pause filled sounds scripted), no artificial
 * background (a fake office would be theatre on a call that says it is an
 * AI; real lines add their own noise), normal speed.
 *
 * Second live call (2026-09-28): the assistant was cut off and restarted its
 * own sentence ("Does a call ... Does a call at six"), and landed on the
 * lead's words ("Thanks, ... Michael. A colleague ..."). Interruption
 * sensitivity 0.75 -> 0.6 (a breath, a backchannel or line noise no longer
 * stops it mid-sentence; a real "no, wait" still does), responsiveness
 * 0.85 -> 0.8 (it waits a beat longer for the lead to finish), backchannel
 * 0.5 -> 0.3 (fewer "mm"s over the lead). Stored profiles keep their values;
 * these are the defaults for a profile never edited.
 */
export const DEFAULT_VOICE_FEEL = {
  speed: 1,
  responsiveness: 0.8,
  interruptionSensitivity: 0.6,
  backchannel: true,
  backchannelFrequency: 0.3,
  ambient: "none" as AmbientSound,
};

export const voiceProfileSchema = z
  .object({
    /** A Retell voice id; null = the Retell agent's own voice. */
    voiceId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9_.-]+$/).nullable().default(null),
    speed: z.number().min(0.8).max(1.2).default(DEFAULT_VOICE_FEEL.speed),
    responsiveness: z.number().min(0).max(1).default(DEFAULT_VOICE_FEEL.responsiveness),
    interruptionSensitivity: z.number().min(0).max(1).default(DEFAULT_VOICE_FEEL.interruptionSensitivity),
    backchannel: z.boolean().default(DEFAULT_VOICE_FEEL.backchannel),
    backchannelFrequency: z.number().min(0).max(1).default(DEFAULT_VOICE_FEEL.backchannelFrequency),
    ambient: z.enum(AMBIENT_SOUNDS).default(DEFAULT_VOICE_FEEL.ambient),
    /** The owner accepted +£0.20 a minute for a premium (ElevenLabs) voice. */
    premiumAccepted: z.boolean().default(false),
  })
  .strict();
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const DEFAULT_VOICE_PROFILE: VoiceProfile = voiceProfileSchema.parse({});

/** The stored jsonb, read defensively: anything that does not parse is the default. */
export function parseVoiceProfile(raw: unknown): VoiceProfile {
  const r = voiceProfileSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return r.success ? r.data : DEFAULT_VOICE_PROFILE;
}

export type VoiceProfileProblem = "UNKNOWN_VOICE" | "PREMIUM_NOT_ACCEPTED";

/** Only a listed voice, and a premium one only with the surcharge accepted. */
export function voiceProfileProblems(p: VoiceProfile): VoiceProfileProblem[] {
  if (!p.voiceId) return [];
  const c = candidateFor(p.voiceId);
  if (!c) return ["UNKNOWN_VOICE"];
  if (isPremiumProvider(c.provider) && !p.premiumAccepted) return ["PREMIUM_NOT_ACCEPTED"];
  return [];
}

/** Whether a call on this profile is premium (billed at PREMIUM_MINUTE_FACTOR). */
export function isPremiumProfile(p: VoiceProfile): boolean {
  const c = candidateFor(p.voiceId);
  return Boolean(c && isPremiumProvider(c.provider) && p.premiumAccepted);
}

/**
 * The per-call Retell agent fields for this profile. A premium voice without
 * the surcharge accepted is never sent (the agent's own voice is used).
 */
export function voiceAgentFields(p: VoiceProfile): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    responsiveness: p.responsiveness,
    interruption_sensitivity: p.interruptionSensitivity,
    enable_backchannel: p.backchannel,
  };
  if (p.backchannel) out.backchannel_frequency = p.backchannelFrequency;
  if (p.ambient !== "none") out.ambient_sound = p.ambient;
  if (p.voiceId && voiceProfileProblems(p).length === 0) out.voice_id = p.voiceId;
  if (p.speed !== 1) out.voice_speed = p.speed; // UNVERIFIED field name
  return out;
}

/** Extra TTS $/min of this profile over the stack A assumption (0 for standard voices). */
export function premiumTtsExtraUsdPerMin(p: VoiceProfile): number {
  if (!isPremiumProfile(p)) return 0;
  const c = candidateFor(p.voiceId);
  return c ? Math.max(0, TTS_USD_PER_MIN[c.provider] - STANDARD_TTS_USD_PER_MIN) : 0;
}
