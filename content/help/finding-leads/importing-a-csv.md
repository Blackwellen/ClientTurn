---
title: Importing leads from a CSV file
summary: Upload a spreadsheet of contacts, match its columns, say how you know these people, and decide what becomes a lead or a prospect
category: finding-leads
keywords: [csv, import, upload, spreadsheet, bulk upload, excel, list import, migrate from crm, import wizard]
order: 70
updated: 2026-09-26
---

The import wizard turns a CSV file into leads, prospects, or both. It asks how you know the people on the list, because that decides whether a row becomes a lead you can follow up, or a prospect that waits for review.

## Before you start

- You need to be an owner or admin.
- The file must be a CSV (export it from your spreadsheet or CRM as "CSV"). The limit is 5 MB and 5,000 rows per import; split larger files.
- Every row needs at least an email address or a phone number, or there is no way to reach that person.

## Import a file

1. Open **Leads** and choose **Import**, next to **Add lead**.
2. **File** — choose your CSV.
3. **Columns** — match each ClientTurn field to a column in your file, or leave it as **Not in this file**. The fields are First name, Last name, Company, Email, Phone, Postcode, Job title, Where they came from and Notes. You must map an email or a phone column.
4. **Relationship** — answer **How do you know these people?** (see below). Add **Where did this list come from?**, for example "Export from our old CRM, June 2026". It is saved against every record as its source.
5. Decide whether to tick **Start follow-up on imported leads**. It is off by default.
6. **Review** — choose **Check against your workspace**. Every row is checked against your live leads, prospects and suppression list.
7. Resolve any rows under **Decide the rows we are unsure about**: choose **Lead**, **Prospect** or **Skip** for each.
8. Choose **Import** to finish. The button shows how many records will be imported.

## How you know these people

| Your answer | What the rows become |
|---|---|
| They contacted us, Existing customer, Requested information, Gave explicit marketing consent, Existing business relationship | Leads, which can enter follow-up |
| Referral or introduction, Imported from another system | Each row is held for you to decide: this could be warm or cold |
| We found this person or company | Prospects in **Find Leads**. Nothing is contacted until you approve them |

> **Important:** Importing a list is not the same as choosing to message it. Even with **Start follow-up on imported leads** ticked, every message is checked against consent, suppression and opt-outs before it is sent.

## Rows that are skipped automatically

The check skips a row, and tells you why, when:

- it has neither a usable email nor a phone number;
- the email uses a disposable address domain;
- the address or number is on your suppression list;
- the person is already a lead or a prospect in your workspace.

It also flags, without skipping, rows with an invalid email or phone, a shared mailbox such as `info@`, a personal email domain, or a duplicate elsewhere in the same file.

> **Note:** Going **Back** from the review step discards the check, so a changed column mapping or relationship is always re-checked before anything is imported.

## Related

- [Adding a lead manually](/help/finding-leads/adding-a-lead-manually)
- [Lead sources explained](/help/finding-leads/lead-sources-explained)
- [Corporate and individual subscribers](/help/compliance/corporate-and-individual-subscribers)
