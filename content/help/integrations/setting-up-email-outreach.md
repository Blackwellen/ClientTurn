---
title: Setting up email outreach
summary: Connect your own mailbox over SMTP and IMAP so campaign email sends from your address and replies come back to ClientTurn
category: integrations
keywords: [email, mailbox, google workspace, gmail, microsoft 365, outlook, imap, smtp, pop3, app password, spf, dkim, dmarc, deliverability, connecting your mailbox]
order: 10
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/integrations/setting-up-email-outreach-1.png
    alt: "The sending mailbox form with the Google preset, Test connection and Connect mailbox"
    caption: "Pick your mail provider, test the connection, then connect the mailbox"
---

Campaign email is sent from your own address, through your own mail server, so replies come back to your inbox and your domain's reputation is your own. You connect the mailbox once, in **Settings → Connections**, under **Your sending mailbox**.

> **Note:** The **Resend email** card further down the page is ClientTurn's own system email, for team invitations, handover alerts and failure warnings. It never sends your campaigns or your replies to leads.

## Before you start

- You need to be an owner or admin.
- Have your mail server settings to hand, or use one of the presets.
- **Google Workspace / Gmail** needs an app password, which requires 2-step verification on the account.
- **Microsoft 365 / Outlook** needs SMTP AUTH enabled for the mailbox in the Microsoft admin centre.

## Connect your mailbox

1. Open **Settings → Connections**. **Your sending mailbox** is the first card.
2. Enter the **From name** and **From address** leads will see and reply to. Optionally add a **Reply-to address** if replies should go elsewhere.
3. Choose your **Mail provider**: **Google Workspace / Gmail**, **Microsoft 365 / Outlook**, **IONOS**, or **Other / custom server**. The preset fills in the usual server settings; every field stays editable.
4. Check the outgoing (SMTP) **Server**, **Port**, **TLS**, **Username** (usually your full email address) and **Password**.
5. Choose how replies are read: **IMAP**, **POP3**, or **Do not read replies**. For IMAP or POP3, check the incoming server, port and TLS. Leave the incoming username and password blank if they are the same as outgoing, and choose the **Folder** to read.
6. Choose **Test connection**. ClientTurn signs in to both servers without sending anything.
7. Choose **Connect mailbox**. Then use **Send a test email** to see a real message arrive.

Your password is encrypted before it is stored and is never shown again, not even to you. Disconnecting deletes it.

> **Tip:** Choose IMAP rather than **Do not read replies** wherever you can. Replies are what stop a sequence and hand a warm prospect to your team.

## Check domain health

Below the mailbox, **Sending domain health** shows SPF, DKIM and DMARC for each sending domain, checked daily against DNS, along with recent bounces and complaints. SPF, DKIM and DMARC should all be valid before you send cold outreach at any volume.

## How ClientTurn protects your mailbox

- Sending is capped per mailbox each day, and a newly connected mailbox starts with lower limits that rise as it builds history. **Settings → AI & selling → Channels** shows today's caps.
- Complaint rates are watched. Sending is paused rather than allowed to damage your domain's reputation.
- The mailbox and sender health are re-checked immediately before every send.

If the mailbox stops working, the card says **This mailbox stopped working** with the server's reason. Update the details and save.

## Related

- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
- [Suppression and unsubscribe](/help/compliance/suppression-and-unsubscribe)
