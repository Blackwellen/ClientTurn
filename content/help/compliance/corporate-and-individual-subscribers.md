---
title: Corporate and individual subscribers (sole traders, partnerships, LLPs)
summary: Why a limited company can be cold-emailed but a sole trader cannot, how ClientTurn works out which one a contact is, and what happens when it is not sure
category: compliance
keywords: [pecr, sole trader, partnership, llp, scottish partnership, limited company, corporate subscriber, individual subscriber, companies house, cold email, b2b, subscriber type, review]
order: 20
updated: 2026-09-26
---

Under PECR, the rules for unsolicited marketing by email, SMS and social message depend on who the **subscriber** is — the person or organisation the address or number belongs to.

- **Corporate subscribers** — limited companies, LLPs, Scottish partnerships and government bodies. Marketing to their business addresses does not need prior consent under PECR (UK GDPR still applies to the individual employee's data, and they must be able to object).
- **Individual subscribers** — private individuals, and also **sole traders and ordinary partnerships**, even when they are trading. Unsolicited marketing to them needs consent, or the soft opt-in for existing customers.

> **Note:** This is general guidance, not legal advice. The ICO sets this out in its guidance on the [PECR electronic mail marketing rules](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/).

This is one of the reasons ClientTurn is built for UK agencies, studios, SaaS, ecommerce and professional-services firms: their buyers are overwhelmingly incorporated, and incorporation can be checked for free on Companies House.

## How ClientTurn treats each type for cold outreach

| Subscriber type | Cold outreach |
|---|---|
| Company | Allowed (still subject to suppression, caps and your other settings) |
| LLP | Treated as a company — allowed |
| Scottish partnership | Treated as a company — allowed |
| Sole trader | **Blocked** |
| Ordinary or limited partnership (England, Wales, Northern Ireland) | **Blocked** |
| Individual | **Blocked** |
| Unknown | **Held for review** — nothing is sent until it is resolved |

A blocked type is blocked, not sent for review. A review step that let a person approve a cold marketing message to a sole trader would only make an unlawful send look approved.

## How the type is worked out

ClientTurn uses, in order:

1. A stored permission or relationship record for that contact, if one exists.
2. Otherwise, the company's **Companies House** verdict — whether it is registered, and as what.

It never takes the type from a claim made by whoever supplied the record (an import column or an API field saying "corporate", for example). A stored fact always wins over a caller's claim.

## Warm contact is different

These rules are about **cold** outreach. Someone who enquired, who is an existing customer, or who has given you consent can be contacted within the scope of that relationship, whatever their subscriber type. See [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in).

A sole trader who accepted your LinkedIn connection or follows you sits in between: they can receive one non-promotional opener, but not marketing. See [LinkedIn and social messages](/help/compliance/linkedin-and-social-messages).

## What to do about "Unknown"

An unknown type usually means the company could not be matched on Companies House — a trading name that differs from the registered one, for example. Check the business, and if it is a registered company, make sure the prospect is linked to the right company record. Until then, nothing is sent.

## Related

- [Compliance overview](/help/compliance/compliance-overview)
- [LinkedIn and social messages](/help/compliance/linkedin-and-social-messages)
- [Find Leads discovery](/help/finding-leads/find-leads-discovery)
