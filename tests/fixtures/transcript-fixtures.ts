/**
 * Two representative 8-message windows (VERBATIM_MESSAGE_WINDOW) for measuring
 * the RECENT CONVERSATION block of an agent turn: a short SMS thread and an
 * email thread whose replies carry signatures and the quoted thread below.
 * The last message of each is the current inbound message, as it is in a live
 * turn (it is stored before the turn runs). Shared by tests/token-budget.test.ts
 * (the snapshot's `context` section) and tests/agent-transcript.test.ts.
 */

import type { TranscriptTurn } from "../../src/lib/agent/transcript.ts";

export type TranscriptFixture = { id: string; recent: TranscriptTurn[]; latestMessage: string };

const SIGNATURE =
  "\n\nKind regards,\nPriya Shah\nOperations Director | Northwind Digital Ltd\n" +
  "T: 020 7946 0000 | northwind.example\nRegistered in England and Wales, company no. 01234567. " +
  "This email and any attachments are confidential and intended solely for the addressee.";

function quoted(previous: string): string {
  return `\n\nOn Tue, 22 Sept 2026 at 10:14, Acme Studio <hello@acme.example> wrote:\n> ${previous
    .split("\n")
    .join("\n> ")}`;
}

const SMS: TranscriptTurn[] = [
  { role: "business", body: "Hi Sam, thanks for your enquiry about a new website. Is this for an existing business or a new launch?" },
  { role: "lead", body: "Existing business, we're a 12 person accountancy practice in Leeds" },
  { role: "business", body: "Thanks Sam. Roughly when would you want the new site live?" },
  { role: "lead", body: "Ideally before January, our current one is really dated" },
  { role: "business", body: "Understood. Do you have a budget range in mind for the project?" },
  { role: "lead", body: "Somewhere around 8-10k but flexible for the right agency" },
  { role: "business", body: "That works well for a site of that size. Would a 30 minute call with the team help?" },
  { role: "lead", body: "Yes please, what times do you have next week?" },
];

const E1 =
  "Hi Priya, thanks for getting in touch about the platform rebuild. To point you to the right person, " +
  "could you tell us roughly how many people would use the new system day to day?";
const L1 =
  "Hi, thanks for the quick reply. We have about 40 staff across two offices, and maybe 25 of them would be " +
  "in the system every day. The current setup is a mix of spreadsheets and an old Access database that one " +
  "person maintains, which is the main risk for us. We also need it to talk to Xero.";
const E2 =
  "Thanks Priya, that is really helpful. Xero integration is something we have done several times. " +
  "Is there a date you are working towards, for example a contract renewal or a financial year end?";
const L2 =
  "Our financial year ends in March, so ideally we would want to be running on the new system before then. " +
  "The board has approved the project in principle and I am putting together a shortlist of three suppliers " +
  "to present at the November meeting. I would need a rough cost range and an outline plan for that.";
const E3 =
  "Understood. For the shortlist we can put together an outline plan. Who else would be involved in the " +
  "final decision alongside you?";
const L3 =
  "It would be me, our finance director Tom, and the managing partner who signs off anything over 20k. " +
  "Tom will care most about the Xero side and data migration. Could we get something on the calendar with " +
  "your team before the end of October?";
const E4 =
  "That sounds sensible. A 45 minute scoping call with our lead engineer would cover migration and Xero. " +
  "Would that suit you and Tom?";
const L4 =
  "Yes, that would suit us both. Tuesdays and Thursdays are best for Tom, mornings if possible. Please send " +
  "over a couple of options and I will confirm the same day.";

const EMAIL: TranscriptTurn[] = [
  { role: "business", body: E1 },
  { role: "lead", body: L1 + SIGNATURE + quoted(E1) },
  { role: "business", body: E2 },
  { role: "lead", body: L2 + SIGNATURE + quoted(E2) + quoted(L1) },
  { role: "business", body: E3 },
  { role: "lead", body: L3 + SIGNATURE + quoted(E3) + quoted(L2) },
  { role: "business", body: E4 },
  { role: "lead", body: L4 + SIGNATURE + quoted(E4) + quoted(L3) },
];

export const TRANSCRIPT_FIXTURES: TranscriptFixture[] = [
  { id: "sms-8-messages", recent: SMS, latestMessage: SMS[SMS.length - 1].body },
  { id: "email-8-messages-quoted", recent: EMAIL, latestMessage: EMAIL[EMAIL.length - 1].body },
];
