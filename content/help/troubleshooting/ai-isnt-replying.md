---
title: The AI isn't replying to leads
summary: Check the AI assistant switch, its mode, its channels and whether the lead is in a state where nothing is sent
category: troubleshooting
keywords: [ai not replying, assistant off, no reply, suggest replies, reply automatically, agent mode, ai assist]
order: 20
updated: 2026-09-29
---

Start with **Settings → System check** and look at **AI assistant**.

## Common reasons

| What System check says | What it means | Fix |
|---|---|---|
| AI assistant switch: Off by choice | The assistant is switched off, so replies follow your fixed follow-up steps only | **Settings → Workspace → AI assistant**: switch it on |
| Mode: Off by choice | The assistant is on but its mode is Off | Choose **Suggest replies** or **Reply automatically** |
| Mode: Suggest replies | It drafts replies but nothing is sent until someone approves them | Approve drafts in the **Inbox**, or choose **Reply automatically** |
| Channels: Needs attention | No channel is ticked, or a ticked channel can't send (Email needs a connected mailbox; WhatsApp needs a plan that includes it) | Tick a channel, or connect your mailbox in **Settings → Connections** |
| AI on your plan: Off by choice | The AI assistant isn't included on your plan | **Settings → Billing & Usage** |

## When it's one lead

Open the lead and read **Why hasn't anything happened?**. The assistant stays quiet when:

- the lead opted out;
- a person has taken over the conversation (hand it back to resume);
- sending is paused by billing;
- there's no channel the lead may lawfully be contacted on.

> **Note:** The assistant never decides a price, a promise or availability. Your rules decide; the assistant only words the reply.

## Related

- [The conversation assistant](/help/ai-agents/the-conversation-assistant)
- [Using System check](/help/troubleshooting/using-system-check)
