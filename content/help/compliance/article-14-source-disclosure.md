---
title: Telling people where you got their details (Article 14)
summary: Why every first cold contact carries a one-line source disclosure, how ClientTurn builds it from what it recorded, and why a send is held when it cannot
category: compliance
keywords: [article 14, source disclosure, privacy notice, cold email, where did you get my details, provenance, uk gdpr, right to be informed, privacy notice url]
order: 70
updated: 2026-09-26
---

When you contact someone whose details you did not get from them — a prospect found on their company website or on the company register, for example — UK GDPR Article 14 requires you to tell them what you hold, why, and **where it came from**. Where you use the data to contact them, that information is due at the latest at your first communication.

> **Note:** This is general guidance about how ClientTurn works, not legal advice. The ICO's guidance on [when to provide privacy information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/when-should-we-provide-privacy-information/) is the authoritative source.

## What ClientTurn adds to a cold first contact

The first cold email to a prospect carries one sentence built from what ClientTurn recorded about where the details came from, for example:

```
You're receiving this because Example Studio Ltd found your business contact details via your company's own website. You can see what we hold and ask us to delete it at https://example.com/privacy.
```

It goes on the first email of the sequence that is actually delivered, and not on later steps. If the first step failed to send, its retry still carries the line.

A first message on a social channel (a LinkedIn connection note, for example) gets a shorter version, because those messages are short:

```
I found your details via your company's own website. What we hold and how to opt out: https://example.com/privacy
```

The social line goes only on the first message to that person. Once anything has been delivered to them on any social platform, or a cold email step has already gone out (which carried the longer line), it is not repeated. No line is owed when the person started the conversation, or when everything recorded about them came from their own engagement with your business.

The line is generated from recorded facts. It is never written by hand and never written by AI, because a plausible-sounding sentence naming a source that was never used would be a false statement about how someone's data was obtained.

## How sources are described

| Where the data came from | What the person is told |
|---|---|
| Their own contact with you | your own contact with us |
| The company's website | your company's own website |
| Companies House | the public company register |
| A public government or industry record | a public government or industry record |
| Your CRM | our own customer records |
| A file you imported | records our customer supplied |
| Entered by your team | records entered by our team |
| A licensed data provider | a business contact data provider we licence data from |

When several sources apply, the one the person is most likely to recognise comes first.

## Set it up

1. Open **Settings → Data Controls**.
2. Under **Organisation**, fill in **Legal name** (the registered name, not the trading name) and **Privacy notice URL**.
3. Save.

The panel at the top of Data Controls shows **Ready for cold outreach** once everything a cold email has to carry is on file, or **Cold outreach is not ready yet** with the gaps listed.

## When a send is held

A cold first contact is not sent when:

- nothing records where the prospect's details came from, or
- no **Privacy notice URL** is set, or
- the URL is too long to fit a social first message (use a shorter URL).

> **Important:** This only applies to cold contact. Someone who enquired gave you their details themselves, so no source line is added to warm follow-up — it would be wrong and faintly alarming.

## Related

- [Compliance overview](/help/compliance/compliance-overview)
- [Data rights: archive, suppress, anonymise, delete and export](/help/compliance/data-rights)
- [Data Controls settings](/help/settings/data-controls-settings)
