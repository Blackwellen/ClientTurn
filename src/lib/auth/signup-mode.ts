/**
 * Whether the front door is open.
 *
 * ClientTurn is invite-only while it is in private release: accounts are
 * created by us, not by whoever finds the marketing site. `/signup` stays
 * routable so every existing CTA still lands somewhere deliberate rather than
 * on a 404 — it just explains the position instead of taking a registration.
 *
 * Deliberately opt-*in*: an unset or misspelt variable leaves the door shut,
 * because the failure that matters here is a door that quietly opens. Set
 * `SELF_SERVE_SIGNUP=open` to go back to public registration.
 *
 * No `server-only` marker on purpose. This is a constant, not a query, so the
 * auth shell and the sign-in pages can both read it. It carries no secret: in
 * a client bundle the variable is simply absent, which reads as closed.
 */
export const SELF_SERVE_SIGNUP_OPEN = process.env.SELF_SERVE_SIGNUP === "open";

/** Shown wherever a person tries to register anyway. One wording, one place. */
export const INVITE_ONLY_ERROR =
  "ClientTurn is invite-only at the moment, so new accounts cannot be created here. Ask your ClientTurn contact for an invitation.";
