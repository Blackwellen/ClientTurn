---
title: AI & selling settings
summary: Set how much the assistant researches and how readily it asks leads to clarify, cap what AI may cost, choose your business type and qualification depth, and set brand rules and legitimate interests assessments
category: settings
keywords: [what the ai may do, ai permissions, draft quotes, send quotes, offer discounts, discount limits, margin floor, approval, ai strategy, research depth, risk tolerance, ai budget, spend limit, sales behaviour, business type, archetype, sic 2026, sales motion, qualification depth, preferred methods, brand voice, forbidden phrases, example messages, legitimate interests assessment, lia, objections, reassurance, guarantees, case studies, try it]
order: 40
updated: 2026-09-28
screenshots:
  - src: /help/screenshots/settings/ai-and-selling-settings-1.png
    alt: "The AI strategy card with automation level, research depth and risk tolerance"
    caption: "Set how much the assistant researches and how readily it asks leads to clarify"
  - src: /help/screenshots/settings/ai-and-selling-settings-2.png
    alt: "The Sales behaviour card with primary industry, business type and qualification depth"
    caption: "Your industry, business type and qualification depth shape scoring and questions"
  - src: /help/screenshots/qualifying/qualification-policy-1.png
    alt: "The Qualification policy card with Applies to, the engine mode choices and the details required before the next step"
    caption: "Qualification policy: choose where it applies, the engine mode and what must be known before the next step"
---

**Settings → AI & selling** controls how the assistant sells and how much it may spend. Owners and admins can change it. Everyone else sees the same settings read-only.

Whatever you choose here, the hard rules always apply: suppression and opt-outs, quiet hours, review decisions made by your rules, and the assistant never quoting a price, a promise or availability it was not given.

## AI strategy

- **Automation level** is shown here for reference. You change it, with the channels and handover rules, in **Settings → Workspace → AI assistant**. See [Workspace settings](/help/settings/workspace-settings).
- **Research depth:** **Light** runs AI research (search planning, research summaries, reading company websites) on the cheapest AI tier allowed. **Standard** uses its usual tier. **Deep** may use one tier higher, only when your AI budgets and the lead's value allow it.
- **Risk tolerance:** **Cautious** asks the lead to clarify whenever the assistant is not clearly confident it read the reply correctly. **Balanced** (the default) asks the lead to clarify when a reply is unclear, and passes the conversation to a person only as a last resort. **Assertive** keeps the same safety floor as Balanced: it never acts on a reply it could not read, and the hard rules still hand over. Confidence alone never hands a conversation over: after two unclear replies on the same point, a person takes it. See [The handoff brief](/help/booking-and-sales/handoff-brief).

Choose **Save strategy**.

## What the AI may do

Switches for what the assistant may do without a person. Everything starts **off** except **Qualify leads** and **Book meetings**, so turn on only what you want it to do on its own.

| Switch | What it lets the assistant do |
|---|---|
| Qualify leads | Ask your qualification questions and record the answers. Always on while the assistant is on |
| Book meetings | Offer real times from your calendar and book the one the lead picks. Off: a colleague arranges the time |
| Draft quotes | Build a quote from your catalogue when a lead asks for a price |
| Send quotes | Send a drafted quote to the lead. Off: a colleague sends it. Needs **Draft quotes** |
| Offer discounts | Take money off a quote within the limits below. Needs **Draft quotes** |
| Ask for a signature | Point a lead who accepted a quote to the signature step. Needs **Send quotes** |
| Send payment links | Point a lead to the payment step after signing. Needs **Send quotes** |

**Phone leads**, **Transfer live calls to a person**, **Raise invoices** and **Mark deals won** are set in their own settings, so they show here as read-only. A deal is marked won when a payment is confirmed.

When you turn on **Offer discounts**, set its limits:

- **When it may offer one:** only after the lead objects on price, or unprompted when they ask.
- **Most it may take off**, as a percentage and, if you like, in pounds.

Choose **More limits** for the first, smaller concession, the lowest margin to keep, and when a person must approve: a discount above a percentage or an amount, or any quote above a value. You also choose who approves: an owner or admin, or only the owner.

The assistant never works out a price itself. Every figure it gives comes from your catalogue, and your discount rules decide every discount. See [Quotes from your catalogue](/help/booking-and-sales/quotes).

AI quoting is included on every paid plan with AI assist. If it isn't on yours, the card says so. Choose **Save permissions**.

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

## Objections

The objections your business hears most and your own best answers. The assistant uses them before its general playbook, may put them in its own words, and never adds to them.

1. Choose **Add an objection**. Pick **A common objection** to refine one (such as price or timing), or **One only we hear** and give it a name.
2. Under **How leads say it**, add the phrases leads use, one per line. One is required for an objection only you hear.
3. Write **Your best answer**. Only what you can stand behind. Emojis, dashes and deadline or pressure wording are refused when you save.
4. Tick any **Reassurance to lean on**, and choose **Save objection**.

Under **Reassurance you stand behind**, add service levels, guarantees, case studies, testimonials you own and response-time commitments. The assistant quotes them as written, or not at all.

**Try it** runs a message through the same matching, plan and checks the assistant uses and shows an example reply. It uses no AI tokens. See [Objection handling](/help/sales-knowledge/objection-handling).

## Competitors

The competitors your leads mention, what you can factually say about them, and what never to say.

1. Choose **Add a competitor** and give its **Name**. Under **Also known as**, add other names leads use, comma separated.
2. Under **Approved comparison points**, add factual, verifiable points that name the competitor, one per line (for example "Unlike Acme, onboarding is included in every plan.").
3. Under **Never say**, add lines the assistant must never use, one per line.
4. Choose **Save competitor**. Switch off **Use this competitor** to keep it without using it.

When a lead names a competitor, the assistant may use an approved point word for word and nothing else. Every reply is checked before it is sent: a put-down, an unapproved claim about a competitor or a **Never say** line is refused.

## Channels

Links to where channel settings live (**Workspace** for messaging, quiet hours and the assistant's channels; **Connections** for senders and mailboxes), and **Email send caps today** for each sender.

## Compliance

Record the **legitimate interests assessments** behind contacting people who have not given consent. Each assessment records the three ICO tests: **Purpose**, **Necessity** and **Balancing test**, with optional **Safeguards** and a **Next review** date. Its **Status** can be **Draft**, **Active** or **Withdrawn**. Choose **Save assessment**.

> **Note:** ClientTurn records your assessment. It does not make it for you. See the ICO's guidance on [when you can rely on legitimate interests](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/when-can-we-rely-on-legitimate-interests/).

## Related

- [Business Profile settings](/help/settings/business-profile-settings)
- [Lead scoring explained](/help/qualifying/lead-scoring-explained)
- [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in)
