# V4 — second completion pass

Appendix to `V4_BUILD_PLAN.md`.

## Admin → Usage & Margins (`/admin/economics`)

`lib/admin/economics.ts`, `components/admin/economics`. The cost breakdown fixed
in the previous pass finally has a surface. Ordered **worst margin first**
throughout, because the page exists to find tenants costing more than they pay.

Provider spend is read live from `cost_events` rather than from the monthly
snapshot, so a provider appears even before the rollup has run — and the page
says that is what it is doing rather than rendering a screen of zeroes.

## Lead import (`/app/leads/import`)

`lib/imports/classify.ts` (pure, 19 tests), `lib/imports/actions.ts`, and a
five-step wizard: Upload → Map → Relationship → Review → Import.

The rule the whole flow protects: **classification is re-derived server-side at
commit time**, against live suppression and duplicate state. The browser shows a
preview and the review step says so explicitly, so a stale tab cannot smuggle a
cold row into the Leads inbox. An existing lead always wins over creating a
prospect (§60.3), and "start follow-up" is off by default — importing a list is
not the same as choosing to message it.

Found while writing the tests: the header-matching hints were compared raw
against normalised headers, so `"e-mail"` never matched a column called
`E-Mail`. Every multi-word hint was silently dead.

## Warm email in Follow-Up (§19.1)

Email is now a first-class warm channel beside SMS and WhatsApp — in
`automations/types.ts`, the sequence editor, and the test-send schema (which
validates an address rather than assuming a phone number).

**This surfaced a real gap.** `send-store.ts` attached an unsubscribe link only
when `origin === "campaign"`. An automated follow-up sequence is marketing even
though no human pressed send, and both the UK and US policy packs set
`requireUnsubscribe` for warm email — so enabling email in Follow-Up without
this change would have put every follow-up email in breach. The `automation`
origin now gets the link; a one-to-one reply typed by a person still does not.

## MCP gateway (`/api/mcp`)

`lib/mcp/{tools,gateway,handlers}.ts` plus a JSON-RPC 2.0 route. 17 tools across
8 scopes, with 13 tests on the permission model.

Four properties the implementation holds:

- Tokens are stored as a SHA-256 digest; a leaked row cannot be replayed.
- The authorising user's **live** role is re-read on every call, so a demotion
  takes effect immediately rather than when the token happens to expire.
- `tools/list` is scope-filtered, so an assistant cannot learn that a capability
  exists which it cannot use.
- Everything that sends, launches or spends is `APPROVAL_GATED` and **parks for
  a human** — it returns "this has not been carried out", never a success.

`create_lead` enforces the Prospect/Lead boundary at the API edge: a
relationship that is not warm is refused with an explanation rather than
quietly creating a lead.

## Also fixed

`lib/outreach/queries.ts` had been extended to load sender identities but kept a
`head: true` count select (so every column read came back undefined) and
destructured a sixth promise that was never in the array.

## Still not built

Affiliate portal (`/affiliates`), admin Support, admin Affiliates. All three are
self-contained; the schema for each has existed since `0033`/`0034`.

**Built in the third pass — see `V4_PASS_3.md`.**

## Verification

```
npm run typecheck    # clean
npm test             # 671 + 37 across both batches
npm run test:rls:v4  # 21, live database
npm run audit:db     # 113 tables, 23 functions — all exist
npm run build        # clean
```

Database: 159 tables.
