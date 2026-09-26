---
title: Lead sources explained
summary: Every way a person or company can arrive in ClientTurn, whether it becomes a lead or a prospect, and which article covers it
category: finding-leads
keywords: [sources, intake, inbound, prospects vs leads, lead source, where leads come from, provenance, attribution, deduplication]
order: 5
updated: 2026-09-26
---

ClientTurn has two lists, and every source feeds one of them:

- **Leads** holds people who came to you, or who you already know: they filled in a form, messaged you, are an existing customer, or were referred. A lead can enter follow-up.
- **Find Leads** holds **prospects**: companies and people you found, or that another system sent you for review. Nobody on this list is contacted until a person approves them.

That split is deliberate. Finding someone's details is not permission to message them, so anything you went out and found waits for review.

## Sources that create leads

| Source | How it arrives | Article |
|---|---|---|
| Meta Lead Ads (Facebook and Instagram) | Real-time webhook, with a poll every few minutes as a backstop | [Meta Lead Ads](/help/finding-leads/meta-lead-ads) |
| Google Ads lead forms | Poll every few minutes, plus an optional webhook | [Google Ads lead forms](/help/finding-leads/google-ads-lead-forms) |
| LinkedIn Lead Gen Forms | Poll every few minutes | [LinkedIn Lead Gen Forms](/help/finding-leads/linkedin-lead-gen-forms) |
| TikTok lead forms | Poll every few minutes | [TikTok lead forms](/help/finding-leads/tiktok-lead-forms) |
| Adding a lead by hand | The **Add lead** wizard on **Leads** | [Adding a lead manually](/help/finding-leads/adding-a-lead-manually) |
| A CSV file | **Leads → Import** | [Importing a CSV](/help/finding-leads/importing-a-csv) |
| Your own software | `POST /api/v1/leads` | [Leads from the API](/help/finding-leads/leads-from-the-api) |
| An AI assistant | The MCP `create_lead` tool | [Leads from MCP](/help/finding-leads/leads-from-mcp) |
| HubSpot, Salesforce or Zoho CRM | Optional import of new and changed CRM records | [Pulling leads from your CRM](/help/finding-leads/pulling-leads-from-your-crm) |

## Sources that create prospects

| Source | How it arrives | Article |
|---|---|---|
| Find Leads discovery | A search plan you approve, run against Companies House, company websites and other permitted providers | [Discovering companies with Find Leads](/help/finding-leads/find-leads-discovery) |
| Zapier, Pipedrive or any tool that can post a webhook | A signed inbound endpoint | [Leads from Zapier and webhooks](/help/finding-leads/leads-from-zapier-and-webhooks) |
| A CSV row you mark as "We found this person or company" | **Leads → Import** | [Importing a CSV](/help/finding-leads/importing-a-csv) |
| LinkedIn company-page engagement | Not yet available in the app | [LinkedIn company-page engagement](/help/finding-leads/linkedin-company-page-engagement) |
| LinkedIn Sales Navigator | You work it in LinkedIn; ClientTurn prepares and records | [Sales Navigator, assisted](/help/finding-leads/linkedin-sales-navigator-assisted) |

A prospect becomes a lead when someone chooses **Promote to lead** and says how the business knows them, or when they reply to outreach.

## One intake path

Every lead source above goes through the same intake step. Whatever the source, ClientTurn:

1. Checks there is at least one usable email address or phone number.
2. Checks the address or number against your suppression list. A suppressed person is still recorded, so you can see the enquiry, but is never contacted.
3. Looks for the same person already in your workspace. The same email address, or the same phone number with no conflicting email, is treated as the same person: blank fields are filled and nothing is overwritten.
4. Records where the enquiry came from (form, campaign, ad, UTM parameters and click IDs where the source supplies them) as a separate "touch", so a person who enquires twice keeps both.

> **Note:** If a phone number matches an existing lead but the email address is different, ClientTurn does not guess. The new record is kept and flagged for a person to decide.

## Related

- [Discovering companies with Find Leads](/help/finding-leads/find-leads-discovery)
- [The lead page](/help/finding-leads/the-lead-page)
- [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers)
