---
title: Cold email that gets replies (and stays legal)
summary: How to write a first email a busy person answers, how often to follow up, the deliverability basics, and how ClientTurn handles catch-all, guessed and bouncing addresses
category: finding-leads
keywords: [cold email, cold outreach, subject line, follow-up cadence, sequence, deliverability, warm-up, sending limits, spf, dkim, dmarc, catch-all, accept-all, guessed email, verification, bounce, bounce rate, spam complaints]
order: 12
updated: 2026-09-27
---

Most cold email is ignored because it could have been sent to anyone. A reply comes from being obviously relevant to the person reading it, easy to read in ten seconds, and easy to answer.

> **Note:** This is general guidance, not legal advice. ClientTurn applies the PECR and UK GDPR rules it can check before every send, and you remain responsible for your outreach. See [Compliance overview](/help/compliance/compliance-overview).

## Write to one person, for one reason

Before you write, be able to finish this sentence: *"I am writing to you, not to anyone else, because..."*

Good reasons are specific and checkable:

- They are hiring for a role your service replaces or supports.
- Their site runs on a platform you specialise in.
- They recently raised money, moved office or appointed a new director.
- They published something you have a genuine view on.

Find Leads records these as buying signals, with where and when each was seen, under **Why this lead** on the prospect. Use one of them. See [Discovering companies with Find Leads](/help/finding-leads/find-leads-discovery).

## Keep it short, plain and human

- Three to five short sentences. If it needs scrolling on a phone, it is too long.
- Write like a person: no emojis, no dashes, no exclamation marks, no bold, no images.
- Lead with them, not with you. One line about who you are is enough.
- No attachments, and at most one link. Links and attachments in a first email hurt deliverability and trust.
- Do not pretend you have met, or that this is a reply to something.

## Make one ask

End with a single question that can be answered in a line:

- "Is this something you are looking at this year?"
- "Would a 15 minute call next week be useful?"
- "Are you the right person for this, or is someone else?"

Two asks halve the chance of either being answered.

## Subject lines

Short, lower-key, and specific to them. Three to six words is plenty.

| Works | Avoid |
|---|---|
| Your new ecommerce role | QUICK QUESTION!!! |
| Shopify checkout at Example Retail | Exclusive offer inside |
| Idea for the Example Studio site | Re: our conversation (when there was none) |

A subject that misleads about the content is not just bad practice: it breaks the trust the rest of the email depends on.

## An example

```
Subject: Your ecommerce manager role

Hi Priya,

I saw Example Retail is hiring an ecommerce manager. We help Shopify
brands your size move their product feeds off spreadsheets, which is
usually the first thing a new hire inherits.

Would it be useful if I sent over how two similar teams set it up?

Thanks,
Sam
```

ClientTurn adds the source line (where you got their details) and the unsubscribe link to a cold first email for you. See [Telling people where you got their details](/help/compliance/article-14-source-disclosure).

## Follow-up cadence

Most replies come after a follow-up, not the first email. Keep each follow-up shorter than the last and add something new, rather than "just bumping this".

A new campaign starts with four steps: day 0, day 3, day 7 and day 14. You can have up to five steps, each up to 30 days after the previous one.

- A reply stops the sequence for that person. Connect your mailbox with IMAP or POP3 so ClientTurn can read replies. See [Setting up email outreach](/help/integrations/setting-up-email-outreach).
- An opt-out, an unsubscribe or a bounce stops it too, and every step is checked again at the moment it is sent.
- If there is no answer after the last step, stop. More emails turn a polite silence into a complaint.

## Deliverability basics

A good email that lands in spam gets no replies.

1. **Authenticate your domain.** SPF, DKIM and DMARC should all be valid before you send cold email at any volume. **Settings → Connections → Sending domain health** checks them daily against DNS.
2. **Warm up gently.** A newly connected mailbox starts with lower daily limits that rise as it builds history. Do not try to get round them with extra mailboxes on a brand-new domain.
3. **Respect sending limits.** Sending is capped per mailbox each day. **Settings → AI & selling → Channels** shows today's caps.
4. **Send to verified addresses.** Bounces and spam complaints are what damage a domain, and both are watched.

## Catch-all domains

Some mail servers are set to **accept mail for any address** at their domain, real or not. This is called a catch-all (or accept-all) domain. A verifier asking "does sam@example.com exist?" gets "yes" for every address, so it cannot tell a real mailbox from a made-up one. The message may then be silently discarded, or bounce later.

That is why "valid" is not the same as "delivered". On a prospect's **Verification** card you will see one of:

| Status | What it means |
|---|---|
| **Verified** | The mail server confirmed the mailbox |
| **Catch-all** | The domain accepts everything, so the mailbox could not be confirmed |
| **Risky** | The verifier found warning signs about the mailbox |
| **Unverifiable** or **Unknown** | No verdict could be reached, or it has not been checked yet |
| **Invalid** | The verifier found no such mailbox |

Only a **Verified** address moves a prospect on automatically. Anything else sends the prospect to review; for **Catch-all**, **Risky** and **Unknown** the reason shown is **Contactability could not be confirmed automatically**. Look for a better address (the person's own address published on the company's site, for example), or decide to accept the risk for that one prospect.

## Guessed addresses

ClientTurn itself never guesses an address from a name pattern such as first.last@. A licensed contact-data provider sometimes returns one it has inferred rather than one it holds. ClientTurn records that the address was guessed, and a campaign will not send to it until it has been verified. Until then the prospect shows in review with **The address was guessed from a name pattern and has not been verified**.

## Bounce protection

- A hard bounce suppresses that address for email straight away, so it is never tried again.
- If hard bounces on a campaign pass 5%, or spam complaints pass 0.3%, sending is paused to protect your domain, with the reason shown on the campaign.
- Sending also pauses if your mailbox stops working, its health degrades, or the suppression list cannot be checked. Nothing is sent on a guess.

## Related

- [Reaching the decision maker](/help/finding-leads/reaching-the-decision-maker)
- [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe)
- [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers)
