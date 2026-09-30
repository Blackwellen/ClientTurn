---
title: AI calls aren't ringing
summary: Every reason an AI call isn't placed, from the plan and the number to minutes, identity, calling hours and the AI assistant
category: troubleshooting
keywords: [ai calls not working, voice not calling, no calls, call with ai greyed out, calling hours, voice minutes, caller identity, number]
order: 30
updated: 2026-09-29
---

An AI call needs several things at once. **Settings → System check → AI voice calls** lists every one with its status, so you can see all the missing pieces together instead of finding them one at a time.

## What each call needs

| Row | Needs | Where to fix it |
|---|---|---|
| AI calling on your plan | A paid plan with voice, or a voice minute pack. Trials never place live calls | **Settings → Billing & Usage** |
| Voice switched on | Voice switched on for the workspace | **Settings → Voice → Overview** |
| AI assistant | The AI assistant on, in **Suggest replies** or **Reply automatically**. Every tool a call uses (booking, qualifying, follow-up) needs it | **Settings → Workspace → AI assistant** |
| Business identity | The name you call as, your legal entity and how people can reach you. The law requires every call to say who is calling | **Settings → Voice → Business identity** |
| Number | Your own active UK number | **Settings → Voice → Number** |
| Minutes | Minutes left this period, or a minute pack | **Settings → Voice → Budget and usage** |
| Calling hours now | Being inside your calling hours. Outside them, calls wait for the next window rather than being dropped | **Settings → Voice → Calling hours** |
| Calling service | ClientTurn's calling service connected. If this needs attention there's nothing to change on your side; contact support | Contact support |

## When it's one lead

If the workspace is ready but one lead isn't called, open the lead: **Why hasn't anything happened?** shows why its last call didn't go ahead, in the same words the calling system used (for example no consent to be called, outside the lead's own calling hours, or too many attempts).

## Related

- [Setting up the AI voice agent](/help/voice/setting-up-the-ai-voice-agent)
- [Calls and consent](/help/voice/calls-and-consent)
- [Voice minutes and billing](/help/voice/voice-minutes-and-billing)
