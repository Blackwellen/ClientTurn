---
title: AI & selling settings
summary: Set how much the assistant researches and when it hands over, cap what AI may cost, choose your business type and qualification depth, and set brand rules and legitimate interests assessments
category: settings
keywords: [ai strategy, research depth, risk tolerance, ai budget, spend limit, sales behaviour, business type, archetype, sic 2026, sales motion, qualification depth, preferred methods, brand voice, forbidden phrases, example messages, legitimate interests assessment, lia]
order: 40
updated: 2026-09-26
---

**Settings → AI & selling** controls how the assistant sells and how much it may spend. Owners and admins can change it. Everyone else sees the same settings read-only.

Whatever you choose here, the hard rules always apply: suppression and opt-outs, quiet hours, handover when a decision needs review, and the assistant never quoting a price, a promise or availability it was not given.

## AI strategy

- **Automation level** is shown here for reference. You change it, with the channels and handover rules, in **Settings → Workspace → AI assistant**. See [Workspace settings](/help/settings/workspace-settings).
- **Research depth:** **Light** runs AI research (search planning, research summaries, reading company websites) on the cheapest AI tier allowed. **Standard** uses its usual tier. **Deep** may use one tier higher, only when your AI budgets and the lead's value allow it.
- **Risk tolerance:** **Cautious** hands the conversation to a person whenever the assistant is not clearly confident it read the reply correctly. **Balanced** hands over when confidence is low or the topic is sensitive. **Assertive** keeps the same safety floor as Balanced: low confidence and the hard rules still hand over.

Choose **Save strategy**.

## AI budget

Limits on what AI may cost. When a limit is reached, the AI step is skipped or handed to a person. Nothing is sent that would not have been sent anyway.

| Limit | What it caps |
|---|---|
| Workspace monthly ceiling | AI cost for this workspace in a calendar month. Your plan's own ceiling still applies |
| Per lead | AI cost on one lead over its lifetime |
| Before a reply | AI cost on a lead before it has replied. Kept low on purpose |
| Per opportunity | AI cost on a lead once it is an opportunity |

Each limit shows its default. You can lower a limit but not raise it above the platform default, and **Before a reply** cannot be more than **Per lead**. Clearing a limit puts the default back. The card also shows **Spent this month** and the **Platform hard stop**, which always applies. Choose **Save limits**.

This is separate from your AI token allowance. See [Usage and limits](/help/billing/usage-and-limits).

## Sales behaviour

What kind of business this is and how it sells. Lead scoring, qualification and the opportunity stages follow it.

- **Primary industry (UK SIC 2026):** search by code or activity, for example `73.11` or "web design".
- **Business type:** the library profile used for scoring weights and qualification questions. See [Industry scoring and archetypes](/help/sales-knowledge/industry-scoring-and-archetypes).
- **How you sell:** your sales motions. See [Sales motions and close targets](/help/sales-knowledge/sales-motions-and-close-targets).
- **Qualification depth:** **Light** asks only the questions that unlock the next step, **Standard** asks the most useful questions and stops once enough is known, **Thorough** asks every configured question that applies. Required questions are always asked. See [How qualification works](/help/qualifying/how-qualification-works).
- **Preferred methods:** the sales methods you would like the assistant to favour. See [Sales methods explained](/help/sales-knowledge/sales-methods-explained).

Choose **Save sales behaviour**.

## Brand

How your business sounds.

- **Forbidden phrases:** one per line, 3 to 60 characters each. Every draft the assistant writes is checked, and a draft using one is rejected and rewritten before anything is sent.
- **Good example messages:** messages that sound like you. The assistant sees them as tone examples only, never as facts to repeat.
- **Bad example messages:** messages that do not sound like you.

You can add up to five examples of each. Choose **Save brand**.

## Channels

Links to where channel settings live (**Workspace** for messaging, quiet hours and the assistant's channels; **Connections** for senders and mailboxes), and **Email send caps today** for each sender.

## Compliance

Record the **legitimate interests assessments** behind contacting people who have not given consent. Each assessment records the three ICO tests: **Purpose**, **Necessity** and **Balancing test**, with optional **Safeguards** and a **Next review** date. Its **Status** can be **Draft**, **Active** or **Withdrawn**. Choose **Save assessment**.

> **Note:** ClientTurn records your assessment. It does not make it for you. See the ICO's guidance on [when you can rely on legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/when-can-we-rely-on-legitimate-interests/).

## Related

- [Business Profile settings](/help/settings/business-profile-settings)
- [Lead scoring explained](/help/qualifying/lead-scoring-explained)
- [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in)
