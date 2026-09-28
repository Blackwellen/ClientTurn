# Help-centre content contract

`npm run build` generates `src/lib/help/content.generated.ts` from these files before
compiling. Production reads this bundled copy so serverless search and article pages
do not depend on the deployment's working directory. After editing articles, run
`node scripts/generate-help-content.mjs` and commit the generated file too.

Every help article in ClientTurn — on the public site at `/help`, inside the app at
`/app/help`, in the support popout, and in search — is read from the markdown files in
this folder. There is one copy of each article. This README is the contract for writing
them; `tests/help-center.test.ts` enforces it and fails the build on any breach.

Code that enforces this: `src/lib/help/contract.ts` (validation), `src/lib/help/frontmatter.ts`
(the frontmatter parser), `src/lib/help/categories.ts` (the category list),
`src/components/help/help-markdown.tsx` (the renderer).

---

## 1. Where a file goes

```
content/help/<category>/<slug>.md
```

- `<category>` is one of the category slugs in section 3. The folder name **must equal**
  the `category` field in the frontmatter.
- `<slug>` is the file name without `.md`. It is the article's permanent identity and URL:
  `/help/<category>/<slug>`.
  - Lower-case kebab-case only: `a-z`, `0-9` and single hyphens (`connecting-hubspot`).
  - **Unique across all categories** — two files with the same name in different folders fail the test.
  - Do not rename a published slug: links to it break. Write a new article instead.
- This `README.md` and `SCREENSHOTS.md` (the screenshot capture list) are the only non-article
  files allowed at the top level. The loader ignores top-level files.

## 2. Frontmatter

Every file starts with a YAML frontmatter block between two `---` lines. Only the fields
below are allowed; any other field fails the test.

| Field | Required | Type | Rules |
|---|---|---|---|
| `title` | yes | string | The page heading and `<title>`. Max 120 characters. Sentence case. Quote it if it contains a colon. |
| `summary` | yes | string | One sentence shown under the title, in search results and as the meta description. Max 220 characters. No full stop needed. |
| `category` | yes | string | One of the slugs in section 3, equal to the folder name. |
| `keywords` | yes | list of strings | At least one. Words and phrases people might search for that are **not** already in the title (synonyms, product names, error text). Search weights keywords just below the title. |
| `order` | yes | number | Position within the category, ascending. Leave gaps (10, 20, 30) so articles can be inserted later. |
| `updated` | yes | date | `YYYY-MM-DD`, unquoted. The date the content was last checked against the product. |
| `screenshots` | no | list of objects | Each item has `src`, `alt` and `caption` — all three required. See section 5. |

### The YAML subset

The parser accepts exactly this subset of YAML — nothing else (no anchors, no multi-line
`|`/`>` strings, no nested objects beyond `screenshots`):

```yaml
title: Plain text is fine
title: "Quote with double quotes when it contains a colon: like this"
title: 'Or single quotes; write '' for an apostrophe inside them'
order: 10
updated: 2026-09-26
keywords: [hubspot, "service key", crm]      # inline list; quote items containing commas
keywords:                                   # or a block list
  - hubspot
  - service key
screenshots:
  - src: /help/screenshots/integrations/connecting-hubspot-1.png
    alt: The HubSpot connect dialog with the token field focused
    caption: Paste the Service Key token here, then choose Connect
```

Indent block-list items with two spaces. A `# comment` is allowed at the end of an
unquoted value or on its own line.

## 3. Categories

Use exactly one of these slugs (the folder name and the `category` value):

| Slug | Title | What belongs here |
|---|---|---|
| `getting-started` | Getting started | Workspace setup, navigation, going live, first-use basics |
| `finding-leads` | Finding leads | One article per lead source; prospect search; imports; manual lead entry |
| `qualifying` | Qualifying | Questions, rules, outcomes, lead sources and qualification explained |
| `booking-and-sales` | Booking and sales | Calendars, bookings, handover, one article per sales method/source |
| `reactivation` | Reactivation | One article per reactivation source |
| `copilot` | Copilot | Using Copilot, its permissions, example questions |
| `ai-agents` | AI agents | Setting up and using agents; the conversation assistant; AI guides |
| `voice` | Voice | The AI voice agent: set-up, calls and consent, voice minutes and billing |
| `settings` | Settings | Business profile, team, messaging, workspace controls |
| `integrations` | Integrations | One article per integration (HubSpot, Salesforce, Zapier, …); CRM integration; mailboxes |
| `developers` | Developers | API docs, MCP docs, webhook setup |
| `compliance` | Compliance | Consent, PECR, opt-outs, suppression, data rights |
| `billing` | Billing | Subscriptions, plans, usage, top-up credits |
| `sales-knowledge` | Sales knowledge | Sales methods, industry scoring, sales technique and psychology (evidence-graded) |
| `faq` | FAQ | Short answers to common questions |

## 4. Body

The body is **GitHub-flavoured markdown**. It is rendered safely: raw HTML is never
rendered (it is dropped), and the test fails if the body contains any, so write markdown only.

Supported:

- `## Heading` and `### Subheading`. **Do not use `#` (level 1)** — the title is the page heading.
  Every `##` heading appears in the "On this page" list and gets an anchor
  (`## Connect a mailbox` → `#connect-a-mailbox`).
- Paragraphs, **bold**, *italic*, ~~strikethrough~~, `inline code`.
- Bulleted lists (`- item`) and numbered lists (`1. item`). **Use a numbered list for any
  sequence of steps** — numbered lists render as branded step markers.
- Tables (GFM pipe tables). Wide tables scroll horizontally on small screens.
- Fenced code blocks with ```` ``` ````. Use them for anything a reader copies (headers, commands, JSON).
- Links: `[text](/help/integrations/connecting-hubspot)` for another article (always the
  `/help/<category>/<slug>` form — the app rewrites it to its in-app route), `[text](/pricing)`
  for a site page, or a full `https://` URL for an external page (opens in a new tab).
- Callouts: a blockquote whose first word is a bold label ending in a colon:

  ```markdown
  > **Note:** Informational aside.
  > **Tip:** A shortcut or recommendation.
  > **Important:** Something the reader must not miss.
  > **Warning:** Something that can cause harm, data loss or a compliance breach.
  ```

  Only these four labels are styled as callouts; any other blockquote renders as a plain quote.

- Images (screenshots), see section 5.

Not supported: raw HTML, `<details>`, embedded video, footnotes, task-list checkboxes,
level-1 headings, emoji shortcodes.

### Writing rules

- **Never fabricate.** Every claim, menu path, limit, price and behaviour must be true of
  the product as it ships. If you are not sure, check the code or leave it out.
  No invented customer names, testimonials or metrics.
- Menu paths in bold with arrows: **Settings → Connections**.
- UK English. Second person ("you"). Short paragraphs.
- Link related articles rather than repeating them.

## 5. Screenshots and figures

Screenshot files live in `public/help/screenshots/<category>/` and are referenced by their
public path `/help/screenshots/<category>/<slug>-<n>.png`.

- Folder: the article's category slug (section 3). File name: the article slug and a
  sequence number, `connecting-hubspot-1.png`, `connecting-hubspot-2.png`; a multi-stage flow
  is a numbered sequence in step order. The test checks both. (Older flat paths directly under
  `/help/screenshots/` still validate but should not be added.)
- Format: **PNG** (preferred — its size is read automatically, and bundled at build time for
  serverless deployments, so the page does not jump while it loads). `.jpg`/`.webp` are
  accepted but reserve no space. Save palette-optimised; most shots are 30–150 KB.
- Capture at 2× device pixel ratio, 1440 px wide or narrower for full-screen shots; crop to
  the relevant area. Never show real personal data, secrets or keys — use a demo workspace
  with fictional `.example` data, and delete it afterwards.
- Annotations are drawn into the image before it is saved: numbered markers (lime `#B7F34A`
  disc, midnight outline) at each control the caption talks about, and a midnight box around
  it on light UI (lime on dark UI). Every image ends with the branded caption band: midnight
  `#0B1020` background, a lime rule, the favicon and the caption in white.
- The file **must exist**, and after adding or changing one run
  `node scripts/generate-help-content.mjs` — the test fails on a missing image or a stale
  bundled size.

Two ways to show one:

**Inline** — where it belongs in the text. The quoted title is the caption and is required:

```markdown
![The Connections page with the HubSpot card highlighted](/help/screenshots/integrations/connecting-hubspot-2.png "Open Settings → Connections and find the HubSpot card")
```

**Frontmatter `screenshots`** — rendered as a numbered gallery after the body. Use this for
supporting shots that do not belong at a specific step. An image referenced inline and also
listed in `screenshots` is shown once, inline.

Every figure is numbered (Figure 1, Figure 2, …) in page order and rendered with a branded caption.
Alt text describes what the image shows for someone who cannot see it; the caption tells the reader
what to do or notice.

## 6. Database overrides

A platform admin can publish a row in `support_articles` with the same `slug` as a file. The
published row replaces the file's title, summary, body and keywords (its category too, if the
row's category names one of the slugs above) without a deploy. A published row with a new
slug adds an article. Files remain the source of record; overrides are for urgent corrections.

## 7. Checking your work

```
node --test tests/help-center.test.ts
```

It reports every problem with the file it is in. Then run the dev server and open
`/help/<category>/<slug>`.

---

## Complete example

`content/help/integrations/connecting-example-crm.md`:

````markdown
---
title: "Connecting Example CRM: pushing qualified leads"
summary: Send qualified and booked leads to Example CRM as contacts with a linked deal
category: integrations
keywords: [example crm, crm sync, api token, contacts, deals, "action required"]
order: 60
updated: 2026-09-26
screenshots:
  - src: /help/screenshots/integrations/connecting-example-crm-1.png
    alt: The Example CRM connection card showing a green Healthy status and the last sync time
    caption: A healthy connection shows its last successful sync
---

Example CRM receives a lead the moment it reaches Qualified, Booked or Won.

## Before you start

You need an Example CRM account with permission to create API tokens.

> **Note:** This is a one-way push. ClientTurn never reads or changes anything else in Example CRM.

## Connect

1. Open **Settings → Connections** and choose **Example CRM → Connect**.
2. In Example CRM, create an API token with the `contacts.write` scope.
3. Paste the token into the dialog and choose **Connect**.

![The Example CRM connect dialog with the token field](/help/screenshots/integrations/connecting-example-crm-2.png "Paste the token, then choose Connect")

## What gets sent

| ClientTurn | Example CRM |
|---|---|
| Lead name and email | Contact |
| Status Qualified, Booked or Won | Deal stage |

> **Warning:** Revoking the token in Example CRM stops the sync. The card will show **Action required** until you reconnect.

## Related

- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
````
