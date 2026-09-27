/**
 * OD-1 caller identity (docs/revenue-engine/12-voice-quote-to-cash-gap-map.md,
 * "Owner decision OD-1"). Pure.
 *
 * Voice cannot be enabled until these are complete, and they are snapshotted
 * onto every call:
 *   - calling_as_name        the brand or trading name spoken in the opener
 *   - legal_entity_name      given on request (PECR identification)
 *   - identification_contact a contact address OR a freephone number, given on
 *                            request (PECR reg 24 asks for "the address of the
 *                            person or a telephone number on which he can be
 *                            reached free of charge")
 *   - assistant_persona_name optional
 *
 * The same readiness check is reused by number provisioning
 * (numbers/provisioning-details.ts), so there is one definition of "identity
 * complete".
 */

import { z } from "zod";
import { classifyDestination, normaliseE164 } from "./destinations.ts";

export const callerIdentitySchema = z.object({
  callingAsName: z.string().trim().min(1).max(80),
  legalEntityName: z.string().trim().min(1).max(160),
  identificationContact: z.string().trim().min(1).max(300),
  personaName: z.string().trim().min(1).max(40).nullable().optional(),
});
export type CallerIdentity = z.infer<typeof callerIdentitySchema>;

export type IdentityField = "callingAsName" | "legalEntityName" | "identificationContact" | "personaName";

export type IdentityProblem =
  | { field: IdentityField; problem: "MISSING" }
  | { field: IdentityField; problem: "TOO_LONG" }
  | { field: "identificationContact"; problem: "PHONE_NOT_FREEPHONE" }
  | { field: "identificationContact"; problem: "ADDRESS_TOO_SHORT" }
  | { field: IdentityField; problem: "CONTAINS_LINE_BREAK" };

export type IdentityReadiness = { ready: true; identity: CallerIdentity } | { ready: false; problems: IdentityProblem[] };

export type IdentityContactKind = "FREEPHONE" | "ADDRESS";

/**
 * A value that parses as a phone number must be a UK freephone (0800/0808):
 * PECR only accepts a number the recipient can call free. Anything else is read
 * as a postal address and must look like one (at least two parts).
 */
export function classifyIdentificationContact(
  value: string,
): { kind: IdentityContactKind } | { kind: null; problem: "PHONE_NOT_FREEPHONE" | "ADDRESS_TOO_SHORT" } {
  const v = value.trim();
  const looksLikePhone = /^[+\d][\d\s().-]{6,}$/.test(v);
  if (looksLikePhone) {
    const n = normaliseE164(v);
    if (n.ok && classifyDestination(n.e164) === "TOLL_FREE_080") return { kind: "FREEPHONE" };
    return { kind: null, problem: "PHONE_NOT_FREEPHONE" };
  }
  const parts = v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || v.length < 10) return { kind: null, problem: "ADDRESS_TOO_SHORT" };
  return { kind: "ADDRESS" };
}

const LIMITS: Record<IdentityField, number> = {
  callingAsName: 80,
  legalEntityName: 160,
  identificationContact: 300,
  personaName: 40,
};

export function identityReadiness(input: Partial<Record<IdentityField, string | null | undefined>>): IdentityReadiness {
  const problems: IdentityProblem[] = [];
  const required: IdentityField[] = ["callingAsName", "legalEntityName", "identificationContact"];
  for (const f of required) {
    const v = (input[f] ?? "").trim();
    if (!v) problems.push({ field: f, problem: "MISSING" });
    else if (v.length > LIMITS[f]) problems.push({ field: f, problem: "TOO_LONG" });
  }
  for (const f of ["callingAsName", "legalEntityName", "personaName"] as const) {
    const v = input[f];
    if (v && /[\r\n]/.test(v)) problems.push({ field: f, problem: "CONTAINS_LINE_BREAK" });
  }
  const persona = (input.personaName ?? "").trim();
  if (persona.length > LIMITS.personaName) problems.push({ field: "personaName", problem: "TOO_LONG" });

  const contact = (input.identificationContact ?? "").trim();
  if (contact) {
    const c = classifyIdentificationContact(contact);
    if (c.kind === null) problems.push({ field: "identificationContact", problem: c.problem });
  }
  if (problems.length) return { ready: false, problems };
  return {
    ready: true,
    identity: {
      callingAsName: (input.callingAsName ?? "").trim(),
      legalEntityName: (input.legalEntityName ?? "").trim(),
      identificationContact: contact,
      personaName: persona || null,
    },
  };
}

/**
 * The deterministic answers the call engine's `get_caller_identity` tool reads
 * from the per-call snapshot. The model never composes these.
 */
export function identityAnswer(identity: CallerIdentity): string {
  const kind = classifyIdentificationContact(identity.identificationContact);
  const how =
    kind.kind === "FREEPHONE"
      ? `on ${identity.identificationContact}, which is free to call`
      : `at ${identity.identificationContact}`;
  return `I am calling on behalf of ${identity.legalEntityName}. You can reach them ${how}.`;
}

/** Only when the prospect asks who built the assistant (OD-1). */
export const BUILT_BY_ANSWER = "This assistant runs on ClientTurn, a software platform the business uses.";
