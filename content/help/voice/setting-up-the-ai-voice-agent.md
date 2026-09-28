---
title: Setting up the AI voice agent
summary: What the AI voice agent does, what it needs before it can call anyone, and how to set your calling identity, dedicated number and calling rules
category: voice
keywords: [voice, ai calls, phone calls, calling agent, voice agent, dedicated number, calling number, caller id, calling identity, legal entity, freephone, twilio, regulatory review, call recording, calling hours, release number]
order: 10
updated: 2026-09-28
---

The AI voice agent phones a lead for you. It calls from your own dedicated UK number, tells the person at the start that it is an AI assistant calling on behalf of your business, and has a short conversation to qualify the enquiry or move it towards a booking or a sale. What was said and decided is recorded on the lead.

Voice is a paid feature. It is not available during a free trial, and a trial or demo workspace never places a live call.

## What you need first

Before the agent can make any call, your workspace needs all of these:

1. **An active paid plan.** Starter, Growth, Pro or Enterprise, with the subscription paid up.
2. **Voice minutes.** A voice minute pack, or on Pro the voice item that includes 200 minutes a month. See [Voice minutes and billing](/help/voice/voice-minutes-and-billing).
3. **A dedicated calling number** that has finished its set-up. It comes with the Pro voice item, or costs £11.99 a month on its own.
4. **A complete calling identity** (below).
5. **Voice switched on** for the workspace.
6. **The AI assistant switched on** in **Settings → Workspace**. Without it a call could not record the lead's answers or arrange a next step, so no AI call is placed.

If any of these is missing, a call is refused with the reason, and nothing is charged.

Everything below is in **Settings → Voice**. Only the workspace owner can buy minutes or the number. Only an owner or admin can change the voice settings; everyone else can see them.

## Your calling identity

The calling identity is who the agent says it is calling for. Voice cannot be switched on until it is complete.

| Field | What to enter |
|---|---|
| The name you call as | Your brand or trading name, as the person will recognise it. Up to 80 characters. |
| Legal entity name | Your company's registered name. |
| Contact for identification | A postal address, or a UK freephone number starting 0800 or 0808. Any other phone number is not accepted. |
| Assistant name | Optional. A first name for the assistant. |

The agent is given your legal entity name and your contact so it can tell the person who is calling and how to reach you if they ask. The identity at the time of each call is saved with that call.

## Your dedicated number

Every call comes from a UK number that belongs to your workspace alone. Setting it up is automatic apart from one step: you give your business details once, because the telephone carrier (Twilio) must review who the number is for before it can be issued. You will be asked for:

- your Companies House registration number;
- your website;
- your business address;
- an authorised representative's name, phone number and work email.

Where ClientTurn can find your company in the Companies House register, your legal name, company number and registered office can be filled in for you. Check them before you save.

What happens next:

1. ClientTurn submits your details for review. Twilio does not publish how long a review takes.
2. When the review is approved, a number is chosen, bought and configured for calls and texts.
3. The owner is notified when the number is ready.

If the review is rejected or set-up stalls, you are notified that your calling number needs attention, with the reason Twilio gave. Correct your details and the review is submitted again automatically. It is only resubmitted when the details have actually changed.

Once the number is active, text messages to your leads are also sent from it, so replies to a call and a text arrive on the same number.

## How the agent calls

These settings change how the assistant speaks for your business, so only an owner or admin can change them.

| Setting | Default | Limits |
|---|---|---|
| Calling hours (the lead's local time) | Monday to Friday 09:00 to 20:00, Saturday 10:00 to 16:00, no Sundays, no bank holidays | Never earlier than 08:00 or later than 21:00 |
| Attempts per lead | 3 | 1 to 5 |
| Calls running at once | 2 | 1 to 20 |
| Call recording | Off | Kept for 1 to 365 days, 90 by default |
| Leave a voicemail | Off | Only for a lead who asked to be called or agreed to calls on your form, and once per request |
| Transfer to a person | On request | A transfer number is needed unless transfers are set to never |

You can also add a short line of your own that the assistant says after its fixed opening, of up to 240 characters. It cannot claim the assistant is a person, repeat the fixed opening or the recording notice, or use emoji or dashes. See [Calls and consent](/help/voice/calls-and-consent) for what the assistant always says first.

Calls are sorted into routes (qualification, booking, direct close, nurture and reactivation), and each route can be switched off or given a share of your monthly minutes. The shares cannot add up to more than 100%.

## Asking the agent to call a lead

Any team member with the member role or above can ask the agent to call a lead with **Call with AI** on the lead. Because a call is real and uses minutes, you confirm it first.

**Call with AI** is in the **AI calls** panel on the lead's full page, and next to **Call yourself** in the lead panel that opens from **Leads** (on a narrow screen, under **More**). When it is greyed out, the reason is shown beside it; owners and admins also get a link to **Settings → Voice** when the fix is there. Viewers cannot place calls.

- If it is within the lead's calling hours, the call is queued and starts shortly.
- If it is outside them, the call is booked for when their calling hours next open.
- You can cancel a call until it starts.

The same checks run again just before the number is dialled, so a call that has stopped being allowed in the meantime (for example because the lead opted out) is cancelled rather than placed. See [Calls and consent](/help/voice/calls-and-consent) for who can be called.

If nobody answers, the agent tries again later within the lead's calling hours, up to your attempt limit. After the last attempt the lead's next action suggests following up by text or email.

## Calls from your agents

A closing or combined agent can also phone leads for you automatically. Switch on **Phone leads with AI** when you create the agent, or later in its **Settings** tab. See [Setting up an agent](/help/ai-agents/setting-up-an-agent#ai-phone-calls). Every call it asks for goes through exactly the same checks as **Call with AI**, and the call card says **Called by** and the agent's name.

## After a call

Each call records its outcome and a summary, the transcript when the call provider supplies one, and the recording when recording is on. Recordings are stored privately and opened only through a link that expires after a few minutes. What the lead said is run through the same qualification and objection rules as their messages, so a call can move the lead's qualification in the same way a reply does.

What the call cost ClientTurn is shown to owners and admins only.

## When a call reaches voicemail

With **Leave a voicemail** on (Settings → Voice → Voicemail and retries), the assistant leaves one short, fixed message: that it is an AI assistant calling from your business about their enquiry, and what happens next. It never mentions a price or a deadline. It is only left for a lead who asked to be called or agreed to calls on your form, and only once per call request.

## When someone calls your number

A call **to** your dedicated number is handled like this:

- **A lead of yours**, once AI answering is switched on for your number: the AI agent can answer, knowing who they are and what they asked about. The call uses your minutes like any other. AI answering of incoming calls is being rolled out; until it is on for your number, incoming calls follow the next point.
- **Anyone else, or when the AI cannot take the call**: the call is transferred to your transfer number if you have set one and transfers are allowed. Otherwise the caller hears a short message and, from a UK mobile, gets a text back.
- **A lead who opted out of all contact** is never answered by the AI and never texted.

A missed incoming call is never called back by the AI on its own.

## Releasing your number

Only the owner can release the dedicated number, and you type the number to confirm. Any calls waiting to start are cancelled, AI calls stop, and texts go back to the shared ClientTurn sender. The number cannot be got back. It is held unused for 90 days so nobody else receives your leads' replies.

## Related

- [Calls and consent](/help/voice/calls-and-consent)
- [Voice minutes and billing](/help/voice/voice-minutes-and-billing)
- [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in)
