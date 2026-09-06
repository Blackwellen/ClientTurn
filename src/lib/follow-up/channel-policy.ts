/**
 * Warm follow-up channel policy, fallback and usage estimation (V4 §19.2-19.8).
 *
 * Pure — no `server-only`, no Supabase — so the editor renders the same rules
 * the worker enforces, and both are unit-testable.
 *
 * The distinction this file exists to keep visible: **what the editor may
 * offer is not what a given lead may receive.** Everything here answers "is
 * this channel configurable and generally usable for this workspace". The
 * per-lead answer belongs to `ChannelPolicyService.evaluate()` and is taken
 * again immediately before every send. A step configured as SMS is not a
 * promise that any particular lead will get an SMS.
 */

import type { Channel } from "@/lib/automations/types";

export const WARM_CHANNELS: Channel[] = ["email", "sms", "whatsapp"];

/** Why a channel is or is not available to configure right now. */
export type ChannelAvailability = {
  channel: Channel | "social";
  /** May the editor offer this channel at all? */
  available: boolean;
  /** Short label the policy card renders: "Allowed (policy permits)". */
  verdict: string;
  /** Longer sentence for the warning banner. Null when nothing is wrong. */
  warning: string | null;
};

export type WarmChannelContext = {
  /** A verified, healthy sending identity exists. */
  senderAvailable: boolean;
  /** Why not, when `senderAvailable` is false. */
  senderIssue: string | null;
  /** The workspace's compliance pack permits this channel for warm contact. */
  policyAllows: Record<Channel, boolean>;
  /** Twilio (or equivalent) is connected for SMS. */
  smsConnected: boolean;
  /** WhatsApp is on the plan AND has an approved template configured. */
  whatsappEnabled: boolean;
  whatsappTemplateReady: boolean;
};

/**
 * The four rows of the "Channel policy" card.
 *
 * Social is listed and permanently manual: ClientTurn has no automated social
 * sending, and saying so plainly is better than omitting the row and leaving
 * people to assume otherwise.
 */
export function summariseWarmChannels(
  context: WarmChannelContext,
): ChannelAvailability[] {
  const email = emailAvailability(context);
  const sms = smsAvailability(context);
  const whatsapp = whatsappAvailability(context);

  return [
    email,
    sms,
    whatsapp,
    {
      channel: "social",
      available: false,
      verdict: "Manual/API-gated only",
      warning: null,
    },
  ];
}

function emailAvailability(context: WarmChannelContext): ChannelAvailability {
  if (!context.policyAllows.email) {
    return {
      channel: "email",
      available: false,
      verdict: "Not permitted by policy",
      warning: "Email is not permitted for warm contact under your compliance policy.",
    };
  }
  if (!context.senderAvailable) {
    return {
      channel: "email",
      available: false,
      verdict: "No sender available",
      warning:
        context.senderIssue ??
        "Connect and verify a mailbox in Settings → Connections before using email steps.",
    };
  }
  return {
    channel: "email",
    available: true,
    verdict: "Allowed (contactability permit + sender available)",
    warning: null,
  };
}

function smsAvailability(context: WarmChannelContext): ChannelAvailability {
  if (!context.policyAllows.sms) {
    return {
      channel: "sms",
      available: false,
      verdict: "Not permitted by policy",
      warning: "SMS is not permitted for warm contact under your compliance policy.",
    };
  }
  if (!context.smsConnected) {
    return {
      channel: "sms",
      available: false,
      verdict: "Provider not connected",
      warning: "Connect Twilio SMS in Settings → Connections before using SMS steps.",
    };
  }
  return {
    channel: "sms",
    available: true,
    verdict: "Allowed (policy permits)",
    warning: null,
  };
}

function whatsappAvailability(context: WarmChannelContext): ChannelAvailability {
  if (!context.whatsappEnabled) {
    return {
      channel: "whatsapp",
      available: false,
      verdict: "Not on your plan",
      warning: "WhatsApp is not included in your current plan.",
    };
  }
  if (!context.policyAllows.whatsapp) {
    return {
      channel: "whatsapp",
      available: false,
      verdict: "Not permitted by policy",
      warning:
        "WhatsApp is not permitted for warm contact under your compliance policy.",
    };
  }
  if (!context.whatsappTemplateReady) {
    return {
      channel: "whatsapp",
      available: false,
      verdict: "Template not configured",
      warning:
        "WhatsApp needs an approved message template before a business-initiated message can be sent.",
    };
  }
  return {
    channel: "whatsapp",
    available: true,
    verdict: "Allowed (provider + templates configured)",
    warning: null,
  };
}

/* ------------------------------------------------------------- fallback */

export type FallbackOutcome =
  | { kind: "FALLBACK"; to: Channel; sentence: string }
  | { kind: "ATTENTION"; sentence: string };

/**
 * The deterministic fallback chain (V4 §19.6).
 *
 * Two properties matter more than the specific ordering:
 *
 *  - It is **fixed**, not "whatever else happens to work". Email falls back to
 *    SMS and never to WhatsApp; SMS and WhatsApp both fall back to email. The
 *    same input always produces the same answer, so a decision can be replayed.
 *
 *  - When nothing is permitted the step does **not** silently pick a channel.
 *    It raises an attention item and pauses that lead's step, which is the only
 *    honest outcome — quietly switching a customer's chosen channel is exactly
 *    the behaviour §19.6 forbids.
 *
 * Fallback only applies at all when the workspace has opted in; otherwise an
 * unavailable channel always becomes an attention item.
 */
const FALLBACK_ORDER: Record<Channel, Channel[]> = {
  email: ["sms"],
  sms: ["email"],
  whatsapp: ["email"],
};

export function resolveFallback(
  channel: Channel,
  available: Record<Channel, boolean>,
  options: { fallbackEnabled: boolean },
): FallbackOutcome | null {
  if (available[channel]) return null;

  if (!options.fallbackEnabled) {
    return {
      kind: "ATTENTION",
      sentence:
        "No permitted fallback — ClientTurn raises an attention item and pauses this lead's step.",
    };
  }

  for (const candidate of FALLBACK_ORDER[channel]) {
    if (available[candidate]) {
      return {
        kind: "FALLBACK",
        to: candidate,
        sentence: `${channelWord(channel)} unavailable → ${channelWord(candidate)} if policy permits.`,
      };
    }
  }

  return {
    kind: "ATTENTION",
    sentence:
      "No permitted fallback — ClientTurn raises an attention item and pauses this lead's step.",
  };
}

/** The preview shown under the channel picker, for every configured channel. */
export function fallbackPreview(
  channels: Channel[],
  available: Record<Channel, boolean>,
  options: { fallbackEnabled: boolean },
): string[] {
  const lines: string[] = [];
  for (const channel of [...new Set(channels)]) {
    if (!options.fallbackEnabled) {
      lines.push(
        `${channelWord(channel)} unavailable → attention item, this lead's step pauses.`,
      );
      continue;
    }
    const target = FALLBACK_ORDER[channel].find((candidate) => available[candidate]);
    lines.push(
      target
        ? `${channelWord(channel)} unavailable → ${channelWord(target)} if policy permits.`
        : `${channelWord(channel)} unavailable → attention item, this lead's step pauses.`,
    );
  }
  return lines;
}

function channelWord(channel: Channel): string {
  return channel === "sms" ? "SMS" : channel === "whatsapp" ? "WhatsApp" : "Email";
}

/* ---------------------------------------------------------------- usage */

/**
 * Allowance impact, in message credits (V4 §19.10).
 *
 * Deliberately expressed in credits rather than provider unit cost: the
 * wholesale price book is platform-confidential and is never rendered on a
 * customer surface. One enabled step is one message per lead per channel; an
 * SMS long enough to be split into two segments still costs one credit here
 * because segmentation depends on the resolved text, not the template.
 */
export type UsageEstimate = {
  perChannel: { channel: Channel; messages: number; credits: number }[];
  totalCredits: number;
};

const CREDITS_PER_MESSAGE: Record<Channel, number> = {
  email: 1,
  sms: 1,
  whatsapp: 1,
};

export function estimateUsage(
  steps: { channel: Channel; enabled: boolean }[],
): UsageEstimate {
  const counts = new Map<Channel, number>();
  for (const step of steps) {
    if (!step.enabled) continue;
    counts.set(step.channel, (counts.get(step.channel) ?? 0) + 1);
  }

  const perChannel = WARM_CHANNELS.map((channel) => ({
    channel,
    messages: counts.get(channel) ?? 0,
    credits: (counts.get(channel) ?? 0) * CREDITS_PER_MESSAGE[channel],
  })).filter((row) => row.messages > 0);

  return {
    perChannel,
    totalCredits: perChannel.reduce((sum, row) => sum + row.credits, 0),
  };
}
