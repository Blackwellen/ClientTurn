# Provider brand marks

Used to identify each provider on its own connection card in
Settings → Connections, and in the admin provider tables. Nominative use only:
no partnership or endorsement is implied, and each mark remains the trademark
of its owner.

Every mark here is an official asset. None are hand-drawn approximations.

| Source | Files |
|---|---|
| [svgl.app](https://svgl.app) — open brand-SVG library | `meta` `google` `google-calendar` `tiktok` `linkedin` `twilio` `whatsapp` `slack` `calendly` `salesforce` `resend` |
| [Wikimedia Commons](https://commons.wikimedia.org) — official vendor logos | `hubspot` (HubSpot_Logo.svg) · `zoho` (ZOHO_logo_2023.svg) |
| Reproduced exactly — the mark *is* four squares | `microsoft` |

## Marks trimmed from a wider lockup

Two vendors publish only a lockup (symbol + wordmark). A wordmark is unreadable
at 22px, so the symbol was isolated. In both cases the path data is unmodified
— only the viewBox changed, or a sibling path was dropped:

- **`salesforce`** — the cloud. The lockup knocks the word "salesforce" out of
  the cloud in white; that path is removed.
- **`hubspot`** — the sprocket. The lockup places a navy "HubSpot" wordmark
  beside it; that path is removed and the viewBox tightened to the sprocket's
  rendered bounds.

## Notes

- **`google.svg`** is the Google "G", used for the Google Ads card. Neither
  source carries a Google Ads mark, and the parent mark is accurate rather
  than approximated. The card names the product in text beside it.
- **`zoho.svg`** is a wide lockup (1024×450) rather than a square icon, which
  is why `ProviderIcon` caps marks on both axes instead of forcing a square.

Replace any file in place to upgrade it — `src/lib/integrations/brand-marks.ts`
resolves purely by filename, and no component changes.
