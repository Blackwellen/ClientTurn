---
title: LinkedIn Sales Navigator, assisted
summary: Sales Navigator filters in your search plan, importing your own list, what ClientTurn automates for LinkedIn outreach, and how InMail credits are tracked
category: finding-leads
keywords: [linkedin, sales navigator, inmail, inmail credits, connection request, social queue, assisted outreach, mark as sent, seniority, function, job title, changed jobs, export, import list, csv]
order: 50
updated: 2026-09-26
---

ClientTurn does not send anything on LinkedIn for you. It prepares, paces and records; you press send inside your own LinkedIn account. This article explains the split.

## Why it is assisted

LinkedIn's User Agreement prohibits bots that add contacts or send messages, and browser extensions that automate or scrape. LinkedIn's messaging and invitation APIs are open only to approved partners. An automated route would put your LinkedIn account at risk of restriction, so ClientTurn does not offer one.

## Who does what

| ClientTurn does | You do |
|---|---|
| Orders your approved prospects by score, so the best ones use your limited daily invites | Open each profile from the queue and send the connection request in LinkedIn |
| Drafts the invitation note and the first message, checked for claims and pressure language | Copy the draft (or write your own) and send it |
| Paces the queue inside your account's daily limits | Choose **Mark as sent** so the pacing and follow-up stay accurate |
| Tracks who accepted, and moves them to **Ready to message** | Record acceptances, replies, and InMails you send |
| Keeps the conversation history on the prospect or lead | Reply in LinkedIn; ClientTurn cannot read your LinkedIn inbox |

The queue lives in **Find Leads → Social**. It has three lists: **Ready to message** (they accepted), **Ready to invite** (approved prospects with a profile to reach) and **Waiting on them** (invites sent).

> **Note:** The Social tab needs a LinkedIn sending account recorded against your workspace before the queue appears. At the time of writing there is no button in the app to add one yourself; contact support if the tab shows **No social account connected**.

## InMail credits

Sales Navigator gives you a monthly allowance of InMail credits. ClientTurn cannot see your LinkedIn balance, so it works one out from what you record, using LinkedIn's published Sales Navigator rules:

- 50 credits are added on the 1st of each month (UTC).
- Unused credits roll over, up to a balance of 150.
- A credit comes back when the InMail gets a reply within 90 days.

The **LinkedIn InMail credits** panel on the Social tab shows **Credits left**, **Sent this month**, **Credited back this month** and **Awaiting a reply**.

1. After sending an InMail in LinkedIn, choose **Mark InMail sent** on that person's row. It uses one credit.
2. When they reply, find them under awaiting replies and choose **Reply received**. If the reply is inside 90 days, the credit is returned.

> **Tip:** If the panel shows a negative balance, more InMails have been recorded than LinkedIn would allow, so some records are probably wrong. Check against the balance in Sales Navigator.

## Sales Navigator filters in your search plan

A search plan has a **LinkedIn filters** row. Open a search session in **Find Leads → Discover** and choose that row to set Sales Navigator's own lead and account filters:

- Geography and industry
- Company headcount (LinkedIn's bands, 1-10 to 10,001+), headcount growth and company type
- Seniority level (Owner / Partner, CXO, Vice President, Director, Experienced Manager, Entry Level Manager, Strategic, Senior, Entry Level, In Training)
- Function, current job title (include and exclude), years in current position and at current company
- Changed jobs in the past 90 days, posted on LinkedIn in the past 30 days, and keywords

All of them are optional. A plan without them searches exactly as before.

LinkedIn does not allow a search from a server without a partner contract, and it is not currently taking new partners. ClientTurn never uses your LinkedIn session and never reads LinkedIn pages. So, unless your workspace has a partner connection, the filters work through your own account:

1. In the **LinkedIn filters** dialog, choose **Open this search in Sales Navigator**. The link opens a people search in your own Sales Navigator with as many of the filters filled in as it can carry.
2. Some filters need LinkedIn's internal ids, which ClientTurn does not hold: most places, every industry, and company type. The dialog lists these under **Add these by hand in Sales Navigator**.
3. **Copy filters** copies the whole filter list as text. Use it if the link does not open the search you expect: LinkedIn does not publish its link format, and it can change.

If no job titles are set, the link uses the plan's **Decision maker** roles.

## Importing your own list

To use a list you built in Sales Navigator, or in ordinary LinkedIn search, export it from your own account. Then import it:

1. Open the **LinkedIn filters** row of a search plan and choose **Import your export (CSV)**.
2. The file needs first name and last name (or a full name), company, and company website or domain. The job title, LinkedIn profile URL, location and email columns are used when present. LinkedIn's own Connections export works if it has a company website column added.
3. The result tells you how many rows were imported, how many were already held, and why any were skipped.

What happens to the rows:

- **Phone numbers are discarded.** A phone, mobile or telephone column is dropped and named in the result. ClientTurn cold-contacts by email only, so it does not store numbers from lists.
- An email address in your file is kept as your own imported data and is verified before use, like any other.
- Each row records whether it came from Sales Navigator or a standard account, and that you supplied it.
- Importing the same file again adds nothing new.

Imported people are matched to the companies a sourcing run finds, by company website. They become prospects when a run finds their company and they pass the plan's job-title and seniority filters. Files over 1 MB need splitting.

> **Note:** You can still [import a CSV](/help/finding-leads/importing-a-csv) of people as prospects directly, choosing **We found this person or company**. That route does not wait for a sourcing run.

## Rules that always apply

- Someone who declined your invite is not offered again. Repeated requests are what get accounts restricted.
- Messages to sole traders and individuals follow PECR's consent rules, because social messages count as electronic mail. See [LinkedIn and social messages](/help/compliance/linkedin-and-social-messages).
- Suppression and opt-outs apply to LinkedIn exactly as to email.

## Related

- [LinkedIn Lead Gen Forms](/help/finding-leads/linkedin-lead-gen-forms)
- [LinkedIn company-page engagement](/help/finding-leads/linkedin-company-page-engagement)
