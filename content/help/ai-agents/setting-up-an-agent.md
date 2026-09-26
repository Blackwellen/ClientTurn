---
title: Setting up an agent
summary: Create an agent step by step, choose its sources, limits, schedule and approval level, then start it when you are ready
category: ai-agents
keywords: [new agent, create agent, agent wizard, daily limit, monthly limit, schedule, approval, review everything, sources, start agent]
order: 10
updated: 2026-09-26
---

## Before you start

- You need to be an owner or admin.
- For a sourcing or combined agent, have an approved Find Leads search plan. A plan is approved when you start a sourcing run from it or schedule it. See [Discovering companies with Find Leads](/help/finding-leads/find-leads-discovery).

## Create the agent

1. Open **Agents** and choose **New agent**.
2. **Role** — choose **Sourcing agent**, **Booking agent**, **Re-engagement agent** or **Combined agent**. See [What are AI agents?](/help/ai-agents/what-are-ai-agents)
3. **Sources** — under **Where should it look?**, tick the sources it may use. Only official APIs, licensed data and accounts you own are offered, and a source that needs connecting first is marked. For a sourcing agent:
   - choose the **Approved search plan** (or **No plan yet — save as draft**);
   - choose whether to **Find a work email address** (addresses are verified before use) and whether to **Find a business phone number**.
4. **Limits** — under **How careful should it be?**, give it an **Agent name** and optional **Description**, then set:
   - **Approval**: **Review everything**, **Review new companies only**, or **Run automatically**;
   - **Schedule**: **Only when I run it**, **Every hour**, **Once a day** or **Once a week**;
   - **Daily limit** and **Monthly limit**: the most it may process. The daily limit must be at least 1, and the monthly limit cannot be lower than the daily one.
5. **Review** — check the summary and choose **Create agent**.

The agent is created as a **Draft** and does nothing until you start it.

> **Important:** Finding someone's details is not permission to contact them. Opt-outs, consent and channel rules are checked before every message, whatever an agent is set to.

## Start it

Open the agent and choose **Start agent**. It runs straight away and then on its schedule. An agent set to **Only when I run it** runs once each time you choose **Run now**.

## The agent page

Each agent has tabs for what it has done: **Overview**, **Leads**, **Queue**, **Sources**, **Campaign**, **Activity** and **Settings**. Booking and re-engagement agents do not have **Sources**.

- **Queue** lists each piece of work (find companies, find email, verify email, waiting for review, move to Leads, and so on) with its status and, if blocked, why.
- **Activity** is the timeline of every run, with warnings and errors.

## Controls

| Control | What it does |
|---|---|
| **Start agent** / **Run now** | Starts a draft, paused or stopped agent; runs an active one immediately |
| **Pause** | Stops it running on schedule, keeping its setup and queue. **Start agent** resumes it |
| **Stop** | Stops it after the work in hand. Found prospects and history are kept. It will not resume on its schedule until started again |
| **Delete** | Removes the agent. See [Agents run 24/7](/help/ai-agents/agents-run-24-7#deleting-an-agent) |

Pause and stop are never held for approval, even when requested by an AI assistant.

## Related

- [Agents run 24/7](/help/ai-agents/agents-run-24-7)
- [AI budgets and model tiers](/help/ai-agents/ai-budgets-and-model-tiers)
