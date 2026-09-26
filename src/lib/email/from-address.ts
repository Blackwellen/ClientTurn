/**
 * Which From address an email goes out under (Phase 3.5). Pure.
 *
 * A sender identity (sender_identities) names who a message is from. The
 * connected mailbox is what actually relays it, and a mailbox will only send
 * -- and DMARC will only align -- for addresses on its own domain. So the
 * identity controls From when its address is on the mailbox's domain;
 * otherwise the identity's display name is kept on the mailbox's own address
 * rather than forging a From the mailbox cannot authenticate.
 */

export type SenderIdentityInput = {
  displayName: string | null;
  email: string | null;
  replyTo?: string | null;
};

export type ResolvedFrom = {
  name: string | null;
  email: string;
  replyTo: string | null;
  /** True when the identity's own address is used. */
  identityAddress: boolean;
};

function domain(address: string | null | undefined): string | null {
  const at = (address ?? "").lastIndexOf("@");
  return at < 0 ? null : address!.slice(at + 1).trim().toLowerCase() || null;
}

export function resolveFromAddress(
  mailbox: { fromName: string | null; fromEmail: string; replyTo: string | null },
  identity: SenderIdentityInput | null | undefined,
): ResolvedFrom {
  if (!identity) {
    return { name: mailbox.fromName, email: mailbox.fromEmail, replyTo: mailbox.replyTo, identityAddress: false };
  }
  const sameDomain = Boolean(identity.email) && domain(identity.email) === domain(mailbox.fromEmail);
  return {
    name: identity.displayName?.trim() || mailbox.fromName,
    email: sameDomain ? identity.email!.trim() : mailbox.fromEmail,
    replyTo: identity.replyTo?.trim() || mailbox.replyTo,
    identityAddress: sameDomain,
  };
}
