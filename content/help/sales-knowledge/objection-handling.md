---
title: Objection handling
summary: The objection library the assistant uses, why it asks one clarifying question first, and which objections always go to a person
category: sales-knowledge
keywords: [objections, too expensive, price objection, not interested, send me information, security questionnaire, procurement, playbook, rebuttal, underlying concern]
order: 50
updated: 2026-09-26
---

When a lead pushes back, the conversation assistant loads a **playbook** from the objection library. A playbook is not a script. It separates what the person *said* (the surface objection) from what they may *mean* (the underlying concern), because the right response depends on which concern it is — and guessing produces the canned rebuttal buyers hate.

## What a playbook contains

- **Surface patterns** — how the objection tends to be phrased, such as "bit pricey" or "we're looking at a few other agencies".
- **Underlying concerns** — what it may actually mean. "Too expensive" may mean the value is not yet clear, that they are comparing with a cheaper quote of a different scope, or that the price is fine but the timing of the spend is not.
- **One clarifying question** — for price: "Is it the overall price, or how it compares with something else you've seen?"
- **A response strategy** — instructions that may only draw on your approved claims, prices and proof.
- **Handover conditions** — when a person must take over.

> **Important:** Every strategy carries the same rule: never invent a discount, guarantee, statistic, customer name or deadline. The assistant uses only what you have approved.

## The objection categories

| Category | Handled by | Notes |
|---|---|---|
| Price | Assistant | Hands over if they ask for a discount or a non-list price |
| Budget | Assistant | Offers to follow up when budget returns; hands over for special payment terms |
| Timing | Assistant | Accepts the timing and offers to follow up then; never manufactures urgency |
| Considering a competitor | Assistant | Never criticises a named competitor; hands over for head-to-head comparisons or price matching |
| Already have a provider | Assistant | Asks what they would change about the current setup |
| No need | Assistant | Asks how they handle it today |
| Doesn't understand the offer | Assistant | Offers to explain |
| Trust | Assistant | Hands over if they ask to speak to a reference customer |
| Implementation effort | Assistant | Hands over for a bespoke plan or timeline commitment |
| Too complex | Assistant | Asks which part looks like more than they need |
| Switching cost | Assistant | Hands over if asked to cover exit fees or overlap costs |
| Missing feature | Assistant | Hands over when the answer is not in your approved data |
| Not the decision-maker | Assistant | Asks who else is involved and what they would want to know |
| Send me information | Assistant | Sends approved material and one light next step |
| Too busy | Assistant | Offers a lighter channel such as email |
| Contact me later | Assistant | Asks when suits them |
| Will do it in-house | Assistant | Asks how the in-house approach is going |
| Risk | Assistant | Hands over if they ask for a guarantee or refund promise |
| **Security** | **Always a person** | Any security review, questionnaire or certification question |
| **Compliance** | **Always a person** | Any regulatory, legal or data-protection question; the assistant never gives legal advice |
| **Procurement process** | **Always a person** | Any procurement, tender or supplier-onboarding step |
| **Contract terms** | **Always a person** | Any request to change, interpret or negotiate terms |
| **Not interested** | Respected as a refusal | See below |

## "Not interested" is a refusal

When a lead clearly says no — "not interested", "no thanks", "stop messaging me" — the assistant does not try to change their mind. It thanks them briefly, confirms they will not be contacted about this again, and stops. If they sound upset or mention a complaint, a person is brought in.

A refusal always takes priority over any other objection that matches in the same message.

> **Note:** A genuine opt-out ("stop", "unsubscribe") is handled before any of this, by deterministic rules rather than the playbook. See [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe).

## How a playbook is chosen

Deciding *whether* a message is an objection is the reply classifier's job. Once it is, a deterministic pattern match picks which playbook to load. If more than one matches, a refusal comes first, then the always-a-person categories, then the rest. The categories your buyers most often raise are pre-loaded for your business type — see [Industry scoring and business types](/help/sales-knowledge/industry-scoring-and-archetypes).

## Related

- [Sales psychology: what the evidence supports](/help/sales-knowledge/sales-psychology-evidence)
- [The handoff brief](/help/booking-and-sales/handoff-brief)
- [Taking over a conversation](/help/booking-and-sales/taking-over-a-conversation)
