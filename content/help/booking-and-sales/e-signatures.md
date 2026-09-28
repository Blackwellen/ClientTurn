---
title: E-signatures on quotes
summary: How customers accept and sign a quote online, what is recorded as evidence, and what a simple electronic signature is and is not
category: booking-and-sales
keywords: [e-signature, esignature, electronic signature, sign quote, accept quote, audit trail, consent, signed, legally binding]
order: 81
updated: 2026-09-27
---

When your customer opens a quote link, they can accept it and sign it on the same page. ClientTurn records a **simple electronic signature with an audit trail**.

## What the customer does

1. They read the quote and, if they want, download the PDF.
2. They enter their name and work email.
3. They sign by typing their name. If you turned on **Ask for a drawn signature** under **Settings → Quotes & invoices → More options**, they also draw it.
4. They tick the consent box: "I agree to sign this quote electronically, and I confirm that I am authorised to accept it on behalf of the business named as the buyer."
5. They choose **Sign and accept**.

If you have a payment link set up, the page then shows the payment step. For example, **Pay the £3,000.00 deposit**.

The quote on the lead page moves to **Signed**, and its timeline shows when the customer opened, accepted and signed it.

## What is recorded

Every signature record holds:

- the signer's name, email and job title;
- the typed and/or drawn signature;
- the exact consent wording and its version;
- the signer's IP address and browser, and the time;
- a SHA-256 fingerprint of the exact version of the quote they saw.

Each step is chained to the one before it. Any later change to the quote, or to the record, can be detected. The fingerprint is also printed at the foot of the quote page and the PDF.

## What it is, legally

This is a **simple electronic signature**. The Electronic Communications Act 2000 makes it admissible as evidence, and UK eIDAS says it can't be refused legal effect just because it is electronic. It is used for most business contracts in England and Wales.

It is not a certificate-based ("advanced" or "qualified") signature. Some documents, such as deeds, need a different form of signature. If you are unsure, take legal advice.

## Safety

- Each link is long and random. Only a fingerprint of it is stored.
- A link that is wrong, expired, withdrawn or replaced by a new revision shows the same "not available" page.
- A double click or a retry records one signature, not two.
