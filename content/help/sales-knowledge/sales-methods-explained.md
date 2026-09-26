---
title: Sales methods explained
summary: SPIN, Challenger, MEDDPICC, BANT, transactional and product-led selling, what the evidence behind each actually is, and how ClientTurn uses them
category: sales-knowledge
keywords: [spin selling, challenger sale, meddic, meddpicc, bant, plg, product-led, transactional, methodology, method router, evidence]
order: 10
updated: 2026-09-26
---

Sales teams talk about methods as if they were settled science. Most are not. This article explains the methods you will hear about, grades the evidence behind each one honestly, and shows exactly how ClientTurn uses them — which is always as an internal question-planning aid, never as something said to a buyer.

## How ClientTurn uses a method

Every time the conversation assistant is about to write to a lead, a deterministic **method router** picks a method from facts it already holds:

- the workspace's **sales motion** (how you close — see [Sales motions and close targets](/help/sales-knowledge/sales-motions-and-close-targets))
- the likely deal size
- whether the conversation is inbound or outbound
- the stage of the conversation
- how many people on the buyer's side are involved
- whether your workspace has an approved insight it can share

The same facts always give the same method. The method decides the *shape* of the next question (for example "situation first, then the problem it causes"). It is never named to the lead, and the method name itself is not passed to the model — only the plain-English plan.

> **Note:** At an objection, a closing turn or after a booking, every method narrows to one direct question, whatever method was chosen.

## The methods, with their evidence

| Method | What it is | Evidence grade | When ClientTurn chooses it |
|---|---|---|---|
| Transactional | Answer the question, match the product, offer the next step | Operational default — no persuasion theory involved | Ecommerce motion |
| Simple qualification | Ask the one question that unblocks the next step | Operational default | Local service and high-value consumer motions; smaller B2B deals |
| Product-led (PLG) | Let the product show its value; the conversation removes friction | Operational default | Self-serve SaaS motion |
| SPIN | Situation, Problem, Implication, Need-payoff questions | Sales convention with observational support | Considered B2B sales (mid-size deals and up, or three or more stakeholders) |
| Challenger | Lead with an insight the buyer has not considered | Sales convention | Outbound first contact in a B2B motion, **only** when your workspace has an approved insight |
| MEDDPICC | A checklist: Metrics, Economic buyer, Decision criteria, Decision process, Paper process, Identify pain, Champion, Competition | Sales convention | Enterprise motion only |

### SPIN

SPIN comes from Huthwaite's observational study of sales calls, published commercially (Rackham, 1988). The underlying research was not peer-reviewed as a whole. It is a useful way to order questions — understand the situation before probing the problem — and that is all ClientTurn uses it for. Nobody should describe it as "proven".

### Challenger

Challenger comes from proprietary survey research by CEB, not peer-reviewed. Its core idea is to "teach" the buyer something. ClientTurn only uses it when your workspace has an **approved** insight or claim to teach with. Without one, "challenging" a buyer means making something up, which the assistant is not allowed to do.

### MEDDPICC

MEDDIC (and its longer MEDDPICC form) is a practitioner checklist that originated at PTC in 1996. It has no peer-reviewed validation. It is a good *completeness checklist* for multi-stakeholder deals and maps cleanly onto structured fields, but it does not predict whether a deal will close. ClientTurn only uses it for the enterprise motion: asked on a small deal, it becomes an interrogation.

### BANT

BANT (Budget, Authority, Need, Timing) is not one of ClientTurn's methods. Its four ideas do appear as individual **qualification dimensions** — budget, authority, timing and the problem or need — and the adaptive qualification engine asks for them only when they matter for your motion. See [How qualification works](/help/qualifying/how-qualification-works).

### Transactional, simple qualification and PLG

These are graded **operational defaults**. They make no claim about persuasion at all. "Ask one relevant question, then offer the next step" needs no theory to justify it.

## What ClientTurn never uses

> **Important:** Neuro-linguistic programming (NLP) is not supported by the evidence. A review of 63 studies (Witkowski, 2010) found no empirical support, and a systematic review (Sturt et al., 2012) found insufficient evidence. ClientTurn does not implement NLP techniques in any form.

The assistant does do two ordinary, observable things that NLP courses sometimes claim as their own: it uses the buyer's own words for their problem, and it summarises accurately what they have said. Neither needs NLP.

## Related

- [Sales motions and close targets](/help/sales-knowledge/sales-motions-and-close-targets)
- [Sales psychology: what the evidence supports](/help/sales-knowledge/sales-psychology-evidence)
- [Industry scoring and business types](/help/sales-knowledge/industry-scoring-and-archetypes)
- [Objection handling](/help/sales-knowledge/objection-handling)
