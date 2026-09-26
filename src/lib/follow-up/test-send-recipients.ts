/**
 * Who a follow-up test message may go to.
 *
 * A test send goes straight to the carrier with text the sender typed, outside
 * the lead pipeline and its consent record. Left open, it is a way for anyone
 * with access to text any number in the world from the workspace's sender --
 * which is how a sender number gets reported and a workspace gets suspended.
 *
 * So a test reaches only the workspace itself: the business's own number, or
 * a phone number or login email held on the profile of an active member. There
 * is no separately verified phone number in the data model; a member's login
 * email is verified by sign-in, their profile phone is self-entered, and
 * restricting to members bounds the reach to people who have accepted an
 * invitation to this workspace.
 *
 * Pure (no Supabase import) so the rule is unit-testable.
 */

import { normalisePhone } from "../messaging/types.ts";

export type TestSendChannel = "sms" | "whatsapp" | "email";

export type WorkspaceContacts = {
  businessPhone: string | null;
  members: { phone: string | null; email: string | null }[];
};

export function normaliseTestDestination(
  channel: TestSendChannel,
  to: string,
): string | null {
  if (channel === "email") {
    const email = to.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  return normalisePhone(to);
}

export function isPermittedTestRecipient(
  channel: TestSendChannel,
  destination: string,
  contacts: WorkspaceContacts,
): boolean {
  if (channel === "email") {
    return contacts.members.some(
      (member) => member.email?.trim().toLowerCase() === destination,
    );
  }

  const phones = [
    contacts.businessPhone,
    ...contacts.members.map((member) => member.phone),
  ]
    .map((phone) => (phone ? normalisePhone(phone) : null))
    .filter((phone): phone is string => Boolean(phone));

  return phones.includes(destination);
}

export const TEST_RECIPIENT_ERROR =
  "Test messages can only go to your workspace's own number or a team member's phone or email. Add your number to your profile first.";
