---
title: AI budgets and model tiers, in plain words
summary: What limits how much AI your workspace uses, what happens when a limit is reached, and why ClientTurn picks different AI models for different jobs
category: ai-agents
keywords: [ai budget, ai spend, cost, limits, tokens, model tier, research depth, ai usage, ceiling, per lead, running out]
order: 30
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/ai-agents/ai-budgets-and-model-tiers-1.png
    alt: "The AI budget card with spend this month, the plan ceiling and the workspace monthly ceiling"
    caption: "Spend this month, the plan ceiling and your own limits"
---

## The short version

- AI in ClientTurn is used for a few specific jobs: understanding replies, drafting the assistant's messages, summarising, researching companies, and answering you in Copilot.
- Everything else (follow-up sequences, qualification rules, suppression checks, sending) uses no AI at all, so it keeps working whatever your AI budget.
- If an AI limit is reached, the AI step is skipped or handed to a person. Nothing is sent that would not otherwise have been sent, and no lead goes unanswered because of a limit.

## Where to see and set limits

Open **Settings → AI & selling** and find **AI budget**.

At the top you will see:

- **Spent this month** — AI cost so far this calendar month, and the ceiling that applies. Members and above can see it.
- **Plan ceiling** — the most your plan allows in a month. It always applies.
- **Platform hard stop** — a safety limit on every workspace.

Owners and admins can set the workspace's own limits beneath:

| Limit | What it caps |
|---|---|
| **Workspace monthly ceiling** | The most AI may cost this workspace in a calendar month. Your plan's own ceiling still applies |
| **Per lead** | The most AI may cost on one lead over its lifetime |
| **Before a reply** | The most AI may cost on a lead before it has replied. Kept low on purpose |
| **Per opportunity** | The most AI may cost on a lead once it is an opportunity |

Leave a field blank to use the default shown under it. Per-lead limits can be set lower than the platform default but not higher. Choose **Save limits**.

## Why there are different models

ClientTurn does not send every job to the same AI model. Each job has a default level, from cheaper and faster to more capable, and ClientTurn picks the cheapest one that is good enough for the job and worth the cost:

- Jobs that decide whether a message is an opt-out, a complaint or a request for a person always get a capable enough model. They are never skipped to save money.
- Before an optional AI step, ClientTurn weighs what it would cost against what it is likely to be worth for that lead. If it is not worth it, the step is skipped and the rule-based path is used instead.
- A valuable opportunity may be given a more capable model, if your budgets allow it.

You never choose a model, a prompt or a token count. What you can influence is **Research depth** in **AI strategy** on the same page:

- **Light** — research runs on the cheapest level allowed.
- **Standard** — research runs at its usual level.
- **Deep** — research may use one level higher, only when your budgets and the lead's value allow it.

## Plan allowances and top-ups

Your plan also includes a monthly AI allowance, and you can buy more. See [Usage and limits](/help/billing/usage-and-limits) and [Top-up credits](/help/billing/top-up-credits).

## Related

- [The conversation assistant](/help/ai-agents/the-conversation-assistant)
- [Using Copilot](/help/copilot/using-copilot)
