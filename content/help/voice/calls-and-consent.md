---
title: Calls and consent
summary: What the AI voice agent always says, who it is allowed to call and when, how TPS and CTPS are handled, and what happens when someone asks not to be called
category: voice
keywords: [pecr, ai disclosure, automated call, consent to call, call request, tps, ctps, telephone preference service, recording notice, opt out, do not call, stop calling, calling hours, bank holidays, who can be called]
order: 20
updated: 2026-09-27
---

The AI voice agent is an automated calling system, so the rules for it are stricter than for a person picking up the phone. ClientTurn checks every one of the rules below each time a call is requested, and again immediately before the number is dialled. If any rule fails, the call is not placed and the reason is recorded.

## What the assistant always says first

Every call opens with the same fixed words, before anything else is said:

> This is an AI assistant calling from **your calling name** about the enquiry you sent us **earlier today**. Is now an OK time for a couple of minutes?

The day is worded naturally in the lead's own time zone: "earlier today", "yesterday", a weekday such as "on Tuesday" within the last week, or a date such as "on 3 September".

When call recording is on, this follows straight away:

> Just so you know, this call is recorded so we have an accurate note of what we discuss.

You cannot edit or remove these words, and the version used is saved with every call. Your own optional line comes after them, and it cannot claim the assistant is a person. The opening names your business, not ClientTurn.

If the person asks who is calling or how to contact you, the assistant is given your legal entity name and your contact address or freephone number to tell them. See [Setting up the AI voice agent](/help/voice/setting-up-the-ai-voice-agent#your-calling-identity).

## Who can be called

An AI call is placed only when all of these are true:

- **The person gave you the number themselves**, on a form, in a message, or by asking to be called. A number found by lead enrichment or brought in by an import is never called by the agent.
- **They asked to be called, or agreed to be called.** Either:
  - they **asked for a call**, recorded with when they asked. A request is valid for 30 days, after which you need to ask again; or
  - they **ticked a consent to be called** on your form, and the wording they agreed to is on record.
- **They have not withdrawn that consent, opted out, or been added to your suppression list**, and their details have not been erased.
- **The number is a UK landline, UK mobile or 03 number.** Premium rate, personal (070), pager (076), special rate (084, 087, 09, 118), freephone and non-UK numbers are not called.

Having someone's phone number is not enough on its own. If a lead gave their number but did not ask or agree to be called, the agent will not call them. A person on your team can still call them, or you can send a text asking whether they would like a call.

A team member can record that a lead asked to be called, with a short note of how they asked. This can only be done by a person in the app, not by an AI assistant or an integration.

## TPS and CTPS

The Telephone Preference Service (TPS) and the Corporate Telephone Preference Service (CTPS) are the UK registers of numbers that do not want unsolicited sales calls.

The agent only calls someone who asked for a call or agreed to one, and that specific request or consent is what allows a call to a registered number. ClientTurn never places an AI call on the strength of a number alone, so it never AI-calls a registered number that has not asked for or agreed to a call. The screening result, where one is held, is saved with every call decision.

## When calls are made

- **In the lead's local time.** ClientTurn works out the lead's time zone from their details, then from their phone number's country, then from your workspace. If it cannot tell, the lead is not called rather than guessed at.
- **Within your calling hours.** By default Monday to Friday 09:00 to 20:00 and Saturday 10:00 to 16:00, never on a Sunday or a UK bank holiday (for a UK number). You can change the hours, but never earlier than 08:00 or later than 21:00.
- **Not too often.** At most 3 attempts per lead by default (you can set 1 to 5), no more than 2 in any 24 hours, and at least 2 hours apart.
- **One call at a time.** A lead is never called while another call to them is in progress.
- **Not while a person is handling the lead.** If someone on your team has taken over the conversation, the agent waits.

A call requested outside these limits is booked for the next time it is allowed.

## When someone asks not to be called

If the person says something like "stop calling", "don't call me again" or "take me off your list" during a call, ClientTurn records it when it processes the call. Their number is added to your suppression list, no further calls are made to them, and any planned retry is stopped.

A lead who has opted out of contact, or whose number is on your suppression list, is never called by the agent. See [Suppression and unsubscribe](/help/compliance/suppression-and-unsubscribe).

## Call recordings

Recording is off unless you switch it on. When it is on, the recording notice is spoken at the start of every call. Recordings are stored privately, opened only through a link that expires after a few minutes, and kept for the number of days you choose (90 by default, up to 365).

> **Important:** These checks apply the rules as ClientTurn understands them. They are not legal advice, and you remain responsible for how your business contacts people. If you are unsure whether a lead has agreed to be called, do not record a call request for them.

## Related

- [Setting up the AI voice agent](/help/voice/setting-up-the-ai-voice-agent)
- [Voice minutes and billing](/help/voice/voice-minutes-and-billing)
- [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers)
- [Compliance overview](/help/compliance/compliance-overview)
