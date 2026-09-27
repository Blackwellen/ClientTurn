---
title: Objection handling
summary: The objection library the assistant uses, why it asks one clarifying question first, how it handles price pushback itself, and the few objections that go to a person
category: sales-knowledge
keywords: [objections, too expensive, better price, discount, price objection, not interested, send me information, security questionnaire, procurement, contract, playbook, rebuttal, underlying concern, just looking, not now, status quo, tied in, lock-in, your own objections, reassurance, try it]
order: 50
updated: 2026-09-27
---

When a lead pushes back, the conversation assistant loads a **playbook** from the objection library. A playbook is not a script. It separates what the person *said* (the surface objection) from what they may *mean* (the underlying concern), because the right response depends on which concern it is — and guessing produces the canned rebuttal buyers hate.

## What a playbook contains

- **Surface patterns** — how the objection tends to be phrased, such as "bit pricey" or "we're looking at a few other agencies".
- **Underlying concerns** — what it may actually mean. "Too expensive" may mean the value is not yet clear, that they are comparing with a cheaper quote of a different scope, or that the price is fine but the timing of the spend is not.
- **One clarifying question** — for price: "Is it the overall price, or how it compares with something else you've seen?"
- **A response strategy** — instructions that may only draw on your approved claims, prices and proof.
- **Two or three response patterns** in the shape good salespeople use: acknowledge it, ask one question if the real concern is unclear, answer it with value or proof you have approved, then offer one small next step. The first time an objection comes up the assistant usually asks; if the lead raises it again, it answers.
- **When a person helps** — the rare cases where a person takes over, and the cases where a colleague confirms one detail in the background while the assistant keeps talking.

> **Important:** Every strategy carries the same rule: never invent a discount, guarantee, statistic, customer name or deadline. The assistant uses only what you have approved.

## The objection categories

| Category | Handled by | Notes |
|---|---|---|
| Price | Assistant | Handles "too expensive" and "we need a better price" itself (see below). Hands over only if they insist on a discount beyond what you approved |
| Budget | Assistant | Offers to follow up when budget returns; hands over for special payment or credit terms |
| Timing | Assistant | Accepts the timing and offers to follow up then; never manufactures urgency |
| Considering a competitor | Assistant | Never criticises a named competitor; hands over if they ask you to match a price |
| Already have a provider | Assistant | Asks what they would change about the current setup |
| No need | Assistant | Asks how they handle it today |
| Doesn't understand the offer | Assistant | Offers to explain |
| Trust | Assistant | If they ask to speak to a reference customer, a colleague arranges it in the background and the assistant carries on |
| Implementation effort | Assistant | Hands over if they need a bespoke plan or timeline commitment |
| Too complex | Assistant | Asks which part looks like more than they need |
| Switching cost | Assistant | Hands over if asked to cover exit fees or overlap costs |
| Missing feature | Assistant | When the answer is not in your approved data, says a colleague will confirm it and carries on |
| Not the decision-maker | Assistant | Asks who else is involved and what they would want to know |
| Send me information | Assistant | Sends approved material and one light next step |
| Too busy | Assistant | Offers a lighter channel such as email |
| Contact me later | Assistant | Asks when suits them |
| Will do it in-house | Assistant | Asks how the in-house approach is going |
| Happy with how things are | Assistant | Respects that it works and asks the one thing they would change; never invents a problem |
| Not now | Assistant | Asks whether it is the timing or something else, and never invents urgency |
| Tied into a contract | Assistant | Asks when it renews and offers to get back in touch before then. Saying you are in a contract is not a contract question, so it does not go to a person |
| Just looking | Assistant | No pressure: one useful point and the lightest next step |
| Risk | Assistant | Hands over if they ask for a guarantee or refund promise |
| Security | Assistant, with a colleague | A colleague sends your approved security documents or questionnaire in the background; the assistant keeps qualifying and books the meeting |
| Procurement process | Assistant, with a colleague | A colleague handles the supplier paperwork in the background; the assistant carries on |
| **Compliance** | **Always a person** | Any regulatory, legal or data-protection question; the assistant never gives legal advice |
| **Contract terms** | **Always a person** | Any request to change, interpret or negotiate terms, or for bespoke contract or payment terms |
| **Not interested** | Respected as a refusal | See below |

## Price pushback and discounts

"That's too expensive" and "we need a better price" are objections, not requests to speak to someone. The assistant handles them with the price playbook: it asks what is behind the concern, restates what is included from your approved offer, and mentions scope options or published payment options where they exist.

A request for a specific discount follows a two-step rule:

1. **The assistant answers first.** If you have approved a maximum discount (**Settings → Business Profile → Selling: direct close**), it may offer up to that and never more. If you have approved none, it says so and explains the value instead.
2. **If they insist** on more than you approved after that answer, the conversation goes to a person, because that is a commitment only you can make.

A request for bespoke contract or payment terms, such as "net 60" or "a custom contract", goes to a person straight away. Every message is checked before it is sent, and a discount above your maximum is always rejected.

## "Not interested" is a refusal

When a lead clearly says no — "not interested", "no thanks", "stop messaging me" — the assistant does not try to change their mind. It thanks them briefly, confirms they will not be contacted about this again, and stops. If they sound upset or mention a complaint, a person is brought in.

A refusal always takes priority over any other objection that matches in the same message.

> **Note:** A genuine opt-out ("stop", "unsubscribe") is handled before any of this, by deterministic rules rather than the playbook. See [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe).

## Your own objections and answers

In **Settings → AI & selling → Objections** you can add the objections your business hears most and the answer that works for you. Refine a common one (such as price) or add one only you hear (such as "we're mid-rebrand"), with the phrases leads use for it. Add the reassurance you stand behind: service levels, guarantees, case studies, testimonials you own and response-time commitments.

The assistant uses your answer before its general playbook. It may put it in its own words to fit what the lead said, and it never adds a claim, figure or promise to it. Reassurance is quoted as you wrote it or not at all. Your text is checked when you save it: no emojis, dashes, deadlines or pressure wording.

Use **Try it** to type what a lead might say and see which playbook fires, what the assistant is told and an example reply, with any problem flagged (for example a price you have not published). It runs offline and uses no AI tokens.

## How a playbook is chosen

Deciding *whether* a message is an objection is the reply classifier's job. Once it is, a deterministic pattern match picks which playbook to load. If more than one matches, a refusal comes first, then the legal and contract categories, then security and procurement, then the rest. If a legal or contract question appears anywhere in the message, a person takes it, even beside another objection. The categories your buyers most often raise are pre-loaded for your business type — see [Industry scoring and business types](/help/sales-knowledge/industry-scoring-and-archetypes).

## Related

- [Sales psychology: what the evidence supports](/help/sales-knowledge/sales-psychology-evidence)
- [How the assistant writes](/help/ai-agents/writing-style)
- [The handoff brief](/help/booking-and-sales/handoff-brief)
- [Taking over a conversation](/help/booking-and-sales/taking-over-a-conversation)
