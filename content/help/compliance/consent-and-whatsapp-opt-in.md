---
title: Consent and WhatsApp opt-in
summary: Which relationships allow you to message someone, why consent needs evidence, which channels can be used cold, and why a phone number is not a WhatsApp opt-in
category: compliance
keywords: [consent, permission, relationship, lawful basis, soft opt-in, existing customer, evidence, whatsapp consent, whatsapp template, 24-hour window, service window, cold sms, pecr, marketing consent]
order: 10
updated: 2026-09-26
---

Before every message, ClientTurn checks what you are allowed to send to that person, on that channel, at that moment. The check uses facts on record: how you came to have their details, any consent and its evidence, who they are, and the channel. It is a fixed set of rules. AI never makes this decision and cannot override it.

> **Note:** This is general guidance about how ClientTurn works, not legal advice. See the ICO's guidance on the [PECR electronic mail marketing rules](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) and on [when you can rely on legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/when-can-we-rely-on-legitimate-interests/).

## The relationship is recorded with the lead

Each lead carries a record of how you came to have their details. Leads from a lead form, an enquiry or a message they sent are recorded as **they contacted us**. When you add a lead by hand, the **Add lead** wizard asks you to choose one of:

- **They contacted us**
- **Existing customer**
- **Referral / introduction**
- **Requested information**
- **Explicit marketing consent**
- **Existing business relationship**
- **I found this person/company**
- **Other**

Some choices, such as a referral or explicit consent, ask for evidence: who referred them and when, or how and when they agreed. Record it while you still remember it.

> **Important:** Consent counts only if you can show it. "Explicit marketing consent" with no evidence is treated as no consent.

## What each relationship allows

For people treated as **individuals**, which includes sole traders and ordinary partnerships:

| Relationship | Marketing messages allowed? |
|---|---|
| They contacted you, or asked for information | Yes, within the scope of what they asked about |
| Existing customer or business relationship | Yes |
| Explicit marketing consent, with evidence | Yes |
| Accepted your connection or follows you | One non-promotional opener only. See [LinkedIn and social messages](/help/compliance/linkedin-and-social-messages) |
| Referral, import, found by you, or unknown | No. They need to give consent first |

Companies, LLPs and Scottish partnerships are treated differently. See [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers).

If someone has **withdrawn consent**, nothing is sent to them, in the same way as an opt-out.

Transactional messages, such as a booking confirmation or reminder, are not marketing and are not limited by these rules. Suppression still applies to them.

## Which channels can be used cold

**Cold outreach is email only**, to business addresses. SMS, WhatsApp and social messages cannot be used to contact someone cold, and no setting changes that.

SMS and WhatsApp are for people who gave you their mobile number themselves, for example on a lead form. ClientTurn never buys or looks up phone numbers.

## WhatsApp opt-in

WhatsApp has its own rule on top of the law. Meta requires an **explicit opt-in that names your business** before you start a WhatsApp conversation with someone. A phone number on a lead form is not one, unless the form clearly asked for WhatsApp.

| Situation | What ClientTurn does |
|---|---|
| The person messaged you on WhatsApp in the last 24 hours | Replies are allowed. They started the conversation |
| More than 24 hours since they last messaged, and a WhatsApp opt-in is on record | Only an approved WhatsApp template can be sent |
| No WhatsApp opt-in on record, and they have not messaged you in the last 24 hours | Nothing is sent on WhatsApp, and the message is held for a person to decide |

### Recording a WhatsApp opt-in

Today, a WhatsApp opt-in is recorded when a lead is created through the ClientTurn API or a connected AI assistant with the WhatsApp consent flag set. The **Add lead** wizard, CSV imports and lead-form connections do not record a WhatsApp opt-in yet. Leads from those sources can still be messaged on WhatsApp once they message you first.

> **Tip:** If you want to use WhatsApp for follow-up, ask on your lead form, in words that name your business, whether the person agrees to be contacted on WhatsApp.

## WhatsApp templates outside the 24-hour window

WhatsApp only allows free-form messages within 24 hours of the person's last message. After that, only a template approved by Meta can be sent. See [WhatsApp templates for reactivation](/help/reactivation/whatsapp-templates-for-reactivation).

## Where the rules are recorded

**Settings → Data Controls → Basis for contacting people** is where you state what makes your outreach lawful, for example consent or legitimate interests, with a note summarising your assessment. ClientTurn records what you state. It does not assess it for you.

Every send records the decision that allowed it and the rules in force at the time. **Settings → Data Controls → Evidence you can produce** shows a 30-day summary.

## Related

- [Compliance overview](/help/compliance/compliance-overview)
- [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe)
- [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers)
