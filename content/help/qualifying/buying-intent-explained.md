---
title: Buying intent explained
summary: How ClientTurn reads how ready a lead is to buy, from what they asked for and said, how old signals fade, why a later no outweighs an earlier yes, and how to override it
category: qualifying
keywords: [intent, intent score, intent state, ready to book, ready to buy, not now, not interested, signals, evidence, decay, contradictions, override intent, exploring]
order: 50
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/qualifying/buying-intent-explained-1.png
    alt: "The Buying intent section with the intent state and score, its component bars, the evidence list and Override intent"
    caption: "Buying intent: the state and score, what it is made of, the evidence, and Override intent"
  - src: /help/screenshots/qualifying/buying-intent-explained-2.png
    alt: "The Leads filter panel with the Buying intent and Next best action filter groups"
    caption: "Filter leads by buying intent and by the next best action the engine chose"
---

Buying intent is how ready a lead is to act right now. It is kept separate from fit: a perfect-fit company that has not asked for anything has low intent, and an eager lead that does not fit still has high intent. Intent is worked out by fixed rules from recorded signals, never guessed by AI.

## Where it comes from

Each thing a lead does or says that shows interest, or a lack of it, is recorded as a **signal** with where it came from and when:

| Kind | Examples |
|---|---|
| Explicit requests | Asked to book a call, asked for a demo or a price, asked to buy or start a trial |
| Conversation | Said it is urgent, gave a start date, is unhappy with a current supplier, is comparing options |
| Behaviour and context | Filled in your form on a pricing or demo page, got in touch twice, or a permitted business signal such as a funding round for a company found through Find Leads |
| Negative | Not interested, no need, wrong person, not now, unsubscribed, complained |

> **Note:** ClientTurn does not track people across websites or read whether emails were opened. Behaviour signals come only from what the lead sent you themselves.

## The score and the states

The score runs from 0 to 100, in five capped parts: explicit requests (up to 35), behaviour and context (20), conversation (25), how recent the newest positive signal is (10), and consistency (10).

The state is decided in this order, first match wins:

| State | When |
|---|---|
| Not interested | The lead opted out or complained, or the newest signal is a no |
| Not now | The lead said to come back later, and that date has not passed |
| Ready to book | The lead asked for a meeting, demo or callback recently, and has not booked yet |
| Ready to buy | The lead asked to buy, sign up or start a trial recently |
| High intent | Score 70 or more |
| Medium intent | Score 45 to 69 |
| Exploring | Score 20 to 44, and asking questions or describing a problem |
| Low intent | Score 10 to 44 |
| No intent yet | Nothing yet |

## Contradicting evidence

A later no is never added up against an earlier yes. If someone filled in your form on the pricing page and then replied "not interested", the lead is **Not interested**, and the pricing-page visit is listed under **Contradicting evidence** so you can see it was overruled.

## Signals fade

A request to book is strong for a few days and fades after that; a stated problem lasts longer; a "not now" holds until the date the lead gave, or 60 days if they did not give one. The Intent section shows **Valid until**: after that time the lead is reassessed automatically, even if nothing new happens.

## Reading it on a lead

Open the lead, choose the **Qualification** tab and look at **Buying intent**. It shows the state, the score and its five parts, the evidence with where it came from and how strong it still is, any contradicting evidence, and **Latest signals**.

If the section says **Not assessed yet**, the lead has not been assessed. Choose **Re-run qualification** on the Next best action card to assess it now.

## Overriding intent

Sometimes you know something the messages do not show, such as a phone call.

1. On the lead's **Qualification** tab, choose **Override intent** in the Buying intent section.
2. Choose the state, say why, and optionally when the override stops holding. For **Not now**, the date is when follow-up resumes.
3. Choose **Save override**.

**Not interested**, **Not now**, **Ready to book** and **Ready to buy** are also recorded as evidence, so later reassessments keep them until the date you set. Other states hold until the lead does something new or the date passes. Every override is shown in **Qualification history** with your name and reason.

Members, admins and owners can override intent. Viewers can see it but not change it.

## Related

- [The next best action](/help/qualifying/next-best-action)
- [Correcting what is known about a lead](/help/qualifying/correcting-qualification)
- [Lead scoring explained](/help/qualifying/lead-scoring-explained)
