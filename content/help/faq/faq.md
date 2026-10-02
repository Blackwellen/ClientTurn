---
title: Frequently asked questions
summary: Short answers to the questions people ask most about leads, prospects, the AI, integrations, the API, billing and data protection
category: faq
keywords: [faq, questions, answers, common questions, help, how do i, why, overage, refund, credits]
order: 10
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/faq/faq-1.png
    alt: "The Help page search results for reconnect"
    caption: "Search the help centre from the Help page"
---

## Leads and prospects

### What is the difference between a lead and a prospect?

A **lead** came to you or already knows you: they filled in a form, messaged you, are a customer or were referred. Leads can enter follow-up. A **prospect** is someone you found, or that another system sent for review. Prospects live in **Find Leads** and nobody is contacted until a person approves them. See [Lead sources explained](/help/finding-leads/lead-sources-explained).

### What happens if the same person enquires twice?

They are matched, not duplicated. The same email address, or the same phone number with no conflicting email, is treated as the same person: blank fields are filled, nothing is overwritten, and the new enquiry is recorded as another touch. Their existing follow-up is not restarted.

### What if two records share a phone number but have different emails?

ClientTurn does not guess. The new record is kept and flagged for a person to decide whether they are the same.

### How quickly do Facebook and Instagram leads arrive?

Within seconds: Meta notifies ClientTurn as soon as a form is submitted. ClientTurn also checks every few minutes as a backstop. See [Getting leads from Meta Lead Ads](/help/finding-leads/meta-lead-ads).

### Can I import a spreadsheet?

Yes. Owners and admins can use **Leads → Import** for a CSV of up to 5 MB and 5,000 rows. You choose how you know the people on it, which decides whether rows become leads or prospects. See [Importing a CSV](/help/finding-leads/importing-a-csv).

### Does importing a list start messaging everyone on it?

No. **Start follow-up on imported leads** is off by default, and even when it is on, every message is checked against consent, suppression and opt-outs first.

### Are leads created through the API or by an AI assistant followed up automatically?

No. They are recorded and qualified, but a person chooses to message them. The API and MCP have nobody present to confirm an outbound action.

## Finding new business

### Where does Find Leads get its data?

From official APIs, licensed data and companies' own websites: Google Places for discovery, Google Search, Companies House, the contact details a company publishes about itself, and licensed contact data for verified work emails. It does not scrape social networks and never guesses email addresses. See [Discovering companies with Find Leads](/help/finding-leads/find-leads-discovery).

### Is a found email address permission to send marketing?

No. It is contact data, not permission. Under PECR, sole traders and ordinary partnerships are treated as individuals, so companies whose status is unknown go to review before anyone is contacted. See [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers).

### Can ClientTurn send LinkedIn messages or connection requests for me?

No. LinkedIn's terms prohibit that kind of automation. ClientTurn prepares, paces and records LinkedIn outreach, and you send it from your own account. LinkedIn Lead Gen Forms do arrive automatically. See [Sales Navigator, assisted](/help/finding-leads/linkedin-sales-navigator-assisted).

### Can ClientTurn find prospects on LinkedIn?

No. ClientTurn does not search LinkedIn, and it does not turn people who engage with your company page into prospects: LinkedIn's terms forbid using member data to identify sales prospects. You can import your own LinkedIn connections export, or any list you own, as prospects. See [Sales Navigator, assisted](/help/finding-leads/linkedin-sales-navigator-assisted).

## The AI

### Is the conversation assistant on by default?

No. It is off in every workspace until an owner or admin turns it on in **Settings → Workspace → AI assistant**. We suggest starting with **Suggest replies**, so nothing is sent until someone approves it.

### Can the AI quote prices or promise appointment times?

No. Every draft is checked before it is sent. It cannot mention an amount you have not published, offer a time that did not come from your calendar, say someone is booked unless the booking succeeded, or claim to be human. See [The conversation assistant](/help/ai-agents/the-conversation-assistant).

### What happens when we run out of AI credits?

The AI step is skipped or handed to a person. Follow-up sequences, qualification rules and sending use no AI, so they keep working. See [AI credits and model tiers](/help/ai-agents/ai-budgets-and-model-tiers).

### Can Copilot do anything I cannot?

No. Copilot acts with your role, and anything with a lasting effect asks you to confirm first. It can never send messages, launch campaigns, suppress, anonymise, erase or export a person's data, or delete an agent. See [Using Copilot](/help/copilot/using-copilot).

### Do agents keep working when nobody is logged in?

Yes. Agents run on ClientTurn's servers on their schedule, checked every 30 seconds, whether or not anyone has the app open. See [Agents run 24/7](/help/ai-agents/agents-run-24-7).

### If I delete an agent, do I lose its leads?

No. Deleting removes the agent, its setup, queue and timeline, but keeps the leads, prospects and sourcing runs it produced. It is refused while one of its runs is still in progress.

## Integrations

### Which CRMs does ClientTurn work with?

HubSpot, Salesforce and Zoho CRM receive qualified and booked leads, and can optionally send new records back. Pipedrive, Make, n8n and other tools can send contacts in through a signed webhook. See [Integrating with your CRM](/help/integrations/integrating-with-your-crm).

### Will turning on CRM import create a loop?

No. Records ClientTurn itself created in your CRM are recognised and never imported back.

### Do I need my own Twilio account?

No. SMS and WhatsApp run through ClientTurn's own Twilio account on your behalf. WhatsApp is a paid add-on on Growth and above, paid per message in prepaid WhatsApp tokens (2 for a reply, 5 for a marketing template), with no monthly WhatsApp platform fee. See [SMS and WhatsApp](/help/integrations/connecting-twilio-sms-and-whatsapp).

### Can I send email from my own address?

Yes. Connect your own mailbox over SMTP, and IMAP or POP3 for replies, in **Settings → Connections**. See [Setting up email outreach](/help/integrations/setting-up-email-outreach).

### A connection says "Reconnect required". What do I do?

The provider has refused ClientTurn's access, usually because it was revoked or expired. Choose **Reconnect** on the card and sign in again. See [Troubleshooting integrations](/help/integrations/troubleshooting-integrations).

## Developers

### Where do I get an API key?

Owners and admins create them in **Settings → Developer → New key**. The key is shown once. See [API keys](/help/developers/api-keys).

### What is the API rate limit?

300 requests per minute per key. Over the limit you receive `429` with a `retry_after` value. See [API overview and authentication](/help/developers/api-overview-and-authentication).

### How do I know a webhook really came from ClientTurn?

Check the `clientturn-signature` header: an HMAC-SHA256 of the timestamp and the raw body, using your endpoint's signing secret. See [Webhooks](/help/developers/webhooks#verify-the-signature).

### Can I connect Claude or another AI assistant?

Yes. ClientTurn is an MCP server. In **Settings → Developer → Assistant connections**, choose **New connection**: it issues a key with the permissions you tick, and shows the server URL and a configuration to copy into your assistant. Actions with lasting effects wait for a person to approve them. See [Connecting an AI assistant](/help/developers/connect-an-ai-assistant).

## Billing

### What happens if we go over an allowance?

Nothing is charged: there is no overage on any plan. For SMS and WhatsApp, sending carries on from prepaid [top-up credit or WhatsApp tokens](/help/billing/top-up-credits) if you have bought some, and stops when that is used up too. You are warned at 75%, 90% and 100%, with a recommended bundle to buy. Everything else stops at the allowance until the next period or an upgrade. See [Usage and limits](/help/billing/usage-and-limits).

### Can I get a refund on credits I bought?

Only if none of the credit from that purchase has been used. Once any of it has been used, the purchase is non-refundable. Credit is used oldest purchase first, does not expire, has no cash value and cannot be transferred. **Purchase history** in **Settings → Billing & Usage → Message credits** shows each purchase as **Refundable** or **Non-refundable (credit in use)**. To ask for a refund of an unused purchase, contact support. See [Top-up credits](/help/billing/top-up-credits#refunds).

## Your account

### Do I need an invitation to sign up?

No. Anyone can create an account, with an email address or with Google. Sign-up does not ask for a business name: you name your workspace in the first setup step. See [Getting started](/help/getting-started/getting-started#creating-your-account).

### Do I have to finish every setup step?

No. Only naming your workspace is required. **Skip to go live** uses recommended settings for everything else, and anything you skipped is listed under **Finish setting up** on the Dashboard. See [Setting up your workspace](/help/getting-started/setting-up-your-workspace).

### How do I replay the product tour?

Choose **Take the product tour** on the **Help** tab of the round help button at the bottom right, or at the top of the **Help** page. To tour just the page you are on, choose **Tour this page** in the top bar. See [The product tour](/help/getting-started/the-product-tour).

### Who can change settings?

Owners and admins change workspace settings. Only the owner can invite an admin or make someone an admin. Members work leads and messages. Viewers can read leads and reporting. Only the owner can delete the workspace.
