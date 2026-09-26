---
title: Industry scoring and business types
summary: How ClientTurn works out what kind of business you are, and how that shapes lead scoring, questions and likely objections
category: sales-knowledge
keywords: [archetype, industry, sic code, sic 2026, companies house, scoring profile, weights, business type, classification, sales library]
order: 30
updated: 2026-09-26
---

ClientTurn does not score every lead the same way. A web studio cares about a different set of things from a managed IT provider or a SaaS company. The **sales library** captures those differences as *business types* (called archetypes internally), each with its own scoring weights, qualification questions and common objections.

## How your business type is chosen

ClientTurn works it out in a fixed order, deterministic first:

1. Your Companies House SIC 2007 codes, mapped to the UK SIC 2026 classification.
2. SIC 2026 codes, if your business already has them.
3. What you typed about your business (for example "we're a Shopify web design studio").
4. Words on your own website.

A result is only applied automatically when one candidate is confident and clearly ahead of the next. Otherwise you are shown the candidates and choose. SIC codes often cannot tell two businesses apart — SIC has no separate "online retail" class, for example — so ambiguity is normal and is shown to you rather than guessed.

> **Note:** An AI suggestion, where one is made, is stored separately and is never binding. You can always change your business type yourself.

## The business types

The library has around seventy business types across software, IT, marketing and creative, professional services, property, trades, logistics, retail and ecommerce, hospitality, education, health and organisations. The types that match ClientTurn's main customers have hand-tuned questions and scoring:

- B2B SaaS, product-led SaaS and enterprise SaaS
- Managed IT service providers, IT consultancies and cybersecurity firms
- Marketing, advertising and SEO agencies
- Web and design studios
- Accountancy practices, law firms, management consultancies and other professional services
- Ecommerce brands

The rest use sensible defaults for their family.

## The seven scoring dimensions

Every lead is scored on the same seven dimensions. What changes between business types is how much each one counts.

| Dimension | What it measures |
|---|---|
| Fit | How closely the lead matches the kind of customer you serve |
| Intent | How strongly they are signalling they want to buy |
| Need | Whether there is a real problem to solve |
| Commercial | The likely value of the deal |
| Decision access | Whether you are talking to someone who can decide |
| Timing | How soon they need it |
| Engagement | How actively they are responding |

## Example weights

Weights always total 100.

| Profile | Fit | Intent | Need | Commercial | Decision access | Timing | Engagement |
|---|---|---|---|---|---|---|---|
| Default B2B | 30 | 20 | 15 | 10 | 10 | 10 | 5 |
| B2B SaaS | 30 | 20 | 15 | 10 | 10 | 5 | 10 |
| Product-led SaaS | 25 | 20 | 15 | 5 | 5 | 5 | 25 |
| Agency | 30 | 10 | 20 | 15 | 10 | 10 | 5 |
| Web / design studio | 25 | 15 | 20 | 15 | 10 | 10 | 5 |
| Professional services | 30 | 10 | 20 | 10 | 10 | 15 | 5 |
| Ecommerce | 15 | 35 | 10 | 15 | 5 | 5 | 15 |

The reasoning is written into the library. For example, an agency retainer needs a client big enough to pay for it and a real growth problem to solve, so fit and need count most. For a product-led SaaS, what an account does in the product outweighs who they are on paper, so engagement counts most.

Your sales motion then adjusts these a little (see [Sales motions and close targets](/help/sales-knowledge/sales-motions-and-close-targets)), and everything is renormalised to 100 so no adjustment can inflate every score.

## What fit looks at

Each business type lists the fit signals it cares about, most important first — for example company size, industry, location, whether the company is incorporated, its technology, or whether it has a website. For a web studio: company size, industry, website present and a growth signal.

> **Important:** Protected characteristics are never used as scoring signals. Consumer-facing types in particular never use demographic fit.

## Questions and objections per business type

Each type also carries its own wording for qualification questions. A web studio's first question is "What does the project involve: a new site, a redesign, or something else?", a marketing agency's is "What's the main growth goal you want help with?". And each type lists the objections its buyers most often raise, so the right playbook is ready — see [Objection handling](/help/sales-knowledge/objection-handling).

## Related

- [Lead scoring explained](/help/qualifying/lead-scoring-explained)
- [AI & selling settings](/help/settings/ai-and-selling-settings)
- [Sales methods explained](/help/sales-knowledge/sales-methods-explained)
