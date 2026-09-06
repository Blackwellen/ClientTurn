# Agents, inbox and app connections — 6 September 2026

The user explicitly added Agents and Inbox to the primary navigation, superseding the older five/seven-destination navigation restriction for these surfaces. Dashboard remains the existing dashboard. The search copilot and Follow-Up controls are retained rather than duplicated into a second automation product.

## Implemented

- Agent card directory, four role templates, draft setup wizard and seven deep-linkable detail tabs.
- Sourcing agents queue approved Find Leads plans via the existing provider/budget runtime. Compare-and-swap scheduling prevents overlapping ticks from launching the same schedule twice. Daily/monthly targets are reserved conservatively against created runs.
- Agent pause/stop is checked between sourcing batches. Prospects carry agent attribution.
- Inbox reads the canonical conversations/messages tables, with channel filters, search, read/archive controls and the existing guarded SMS/WhatsApp reply action.
- Branded Home/Messages/Help bubble. Customer support messages persist in the existing support tables; help articles are searchable.
- Eleven named app installs, using an explicitly labelled signed-webhook contact-import bridge. Credentials are encrypted, receipts and jobs are transactional, event IDs deduplicate retries, timestamps limit replay, and imported prospects retain the existing review defaults.

## External dependencies and unfinished capabilities

- Booking, re-engagement and combined agents can be saved as drafts. Their independent orchestrators are not implemented. Existing Follow-Up and Reactivation remain the operational paths.
- Instagram/Messenger ingestion and sending adapters are not implemented here. LinkedIn personal messaging requires an approved partner integration. Ads connections do not grant messaging access.
- Marketplace installation is not native OAuth or two-way sync. Each provider needs a configured workflow/code step to submit the documented signed contact payload. It does not scrape provider inboxes.
- Provider credentials are required for Google Places and licensed enrichment. The configured registry has Google Places, Apollo, Hunter and Clearbit adapters; it does not implement general Google or LinkedIn member search.
- Support replies can be read from existing support messages; automatic email notifications and a dedicated admin support desk are separate work.

## App bridge protocol

POST `/api/apps/{installationId}/events` with `eventId`, an `email` and/or E.164 `phone`, optional `firstName` and `lastName`.
Headers: `x-clientturn-timestamp` (Unix seconds) and `x-clientturn-signature` (hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the configured signing secret). Clock tolerance: five minutes. Payload limit: 16 KiB. Retry with the same eventId.

No app event automatically starts marketing. Prospects must pass review/contactability checks. Disabling an installation blocks receipts and prevents queued imports from that installation.

Provider access references: [LinkedIn API access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access), [LinkedIn Pages messaging](https://www.linkedin.com/help/linkedin/answer/a6246714), [Meta Instagram Send API](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api). Privacy reference: [ICO business-to-business marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/).
