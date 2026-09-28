---
title: LinkedIn and social messages
summary: Why social DMs follow the email marketing rules, why an accepted connection only gets a conversation opener, and why ClientTurn never automates LinkedIn
category: compliance
keywords: [linkedin, social dm, direct message, instagram, messenger, connection request, accepted connection, follower, non-promotional, opener, pecr, sole trader, automation, bot]
order: 30
updated: 2026-09-26
---

The ICO treats direct messages on social media as **electronic mail** under PECR. A LinkedIn, Instagram or Messenger DM that markets to an individual — including a sole trader or an ordinary partnership — follows the same consent rules as an email.

> **Note:** This is general guidance, not legal advice. See the ICO's [Guide to PECR](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) for the authoritative position.

## Relationship versus purpose

Accepting your connection, or following your business, is a real act by that person. But it is not consent to receive marketing. ClientTurn therefore looks at two things separately: the **relationship** you have with the person, and the **purpose** of the message.

For individual-type subscribers (sole traders, ordinary partnerships, individuals, or anyone whose type is unknown):

| Relationship | Non-promotional message | Promotional message |
|---|---|---|
| They contacted you or asked for information | Yes | Yes, within the scope of what they asked, with an opt-out |
| Existing customer | Yes | Yes, for similar products, with an opt-out in every message |
| Explicit marketing consent on record | Yes | Yes |
| **Accepted your connection or follows you** | **One opener**; more only if they reply | **No**, until they reply or engage |
| Referral, import or other | Needs consent | Needs consent |
| Found by you, or unknown | No | No |

A non-promotional message is a thank-you, a relevant question, or continuing a thread they started. A promotional message contains an offer, a price, a booking or checkout link, or a sales call to action.

## How it is enforced

- The contact rules mark the message as **non-promotional only**.
- Before it can be sent, a deterministic check rejects the draft if it contains an offer, a price, a booking or checkout link, or a sales call to action. This is a rule, not AI judgement.
- If the person replies, the relationship moves to "they contacted us", and normal conversation can continue.

Corporate subscribers (companies, LLPs, Scottish partnerships) are not affected by this table. See [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers).

## Why ClientTurn never automates LinkedIn sending

LinkedIn's User Agreement prohibits bots that add contacts or send messages, and browser extensions that scrape. LinkedIn's messaging APIs are restricted to approved partners. So ClientTurn's LinkedIn prospecting is **assisted**: it prepares the task, drafts the note and gives you a link, and **you** send the invitation or message yourself from LinkedIn. See [LinkedIn and Sales Navigator (assisted)](/help/finding-leads/linkedin-sales-navigator-assisted). For a daily list of LinkedIn actions with the messages written for you, see [LinkedIn Assist](/help/finding-leads/linkedin-assist).

## The first message must say where you found them

A first social message to someone who did not contact you first carries a short source line and a link to your privacy notice. See [Telling people where you got their details](/help/compliance/article-14-source-disclosure).

## Instagram and Messenger reply windows

Meta only lets a business reply on Instagram and Messenger within a window that starts when the person last wrote. Only the person can reopen it, by writing again. ClientTurn checks the window immediately before every send, including replies you type yourself:

| Time since the person last wrote | What ClientTurn does |
|---|---|
| Under 24 hours | Sends, whether the reply is from the assistant, an automation or you |
| 24 hours to 7 days | Does not send it, and records why. Only a person may reply now, from Meta Business Suite using Meta's Human Agent tag. ClientTurn does not send with that tag, and the assistant never uses it |
| Over 7 days | Does not send it, and records why. You can reply once they write again |

## Related

- [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in)
- [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe)
