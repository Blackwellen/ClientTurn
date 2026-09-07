# ClientTurn System Mesh

A complete architectural audit of ClientTurn: what exists, what it connects to, what duplicates
what, what is missing, and what the authoritative system should look like.

**Discovery only — no production code was changed.**

Start at [00-executive-summary.md](00-executive-summary.md).

## Reading order

| If you want to | Read |
|---|---|
| The 11 things that matter, in one page | [00](00-executive-summary.md) |
| To know why prospect→lead promotion does not work | [04 · 4.1](04-database-audit.md) then [06 · C](06-prospect-lead-data-flow.md) |
| To understand the whole system at once | [05](05-global-system-mesh.md) |
| To find every duplication with its evidence | [18](18-duplication-bloat-register.md) |
| To know what is safe to delete | [20](20-dead-code-register.md) |
| To plan the work | [21](21-consolidation-migration-plan.md) |
| To know when it is done | [23](23-production-readiness-test-matrix.md) |
| To see what has already been fixed | [24](24-remediation-log.md) |
| To find any action and what it touches | [25](25-master-system-inventory.md) |

## The whole set

`00` executive summary · `01` routes and pages · `02` domains · `03` canonical data model ·
`04` database audit + ERD · `05` global mesh · `06` prospect→lead flow ·
`07` messaging and conversation · `08` agents and automation · `09` integrations ·
`10` AI, Copilot, MCP · `11` compliance and permissions · `12` usage and billing ·
`13` action-by-action audit · `14` wizards · `15` events · `16` state machines ·
`17` data lineage · `18` duplication register · `19` missing architecture ·
`20` dead code · `21` migration plan · `22` target architecture · `23` test matrix ·
`24` remediation log — what has actually been changed · `25` master system inventory — all 270
server actions, generated

## Relationship to `docs/PRODUCTION_PROGRAMME_AUDIT.md`

That document assesses the 21-section production build programme against the code and answers
*"how much of the plan is built?"*. This set answers *"what is the system, and where does it
contradict itself?"* — they are complementary lenses, and they agree where they overlap (notably
that Copilot contains no model call).

Where the two differ on a number, this set states its counting method. Table count here is 174 —
distinct `create table` statements across `supabase/migrations/`, counted programmatically.

## Method

- Route and page inventory: filesystem plus the view enums in `src/lib/*/types.ts`.
- Schema: read from `supabase/migrations/` (65 files), **not** inferred from the UI and **not**
  read from the deployed database.
- Actions: every file containing `"use server"` (41 files, 255 exports), each traced to its call
  sites across all 989 `src/**/*.ts(x)` files.
- Orphans: module-specifier resolution (alias, relative, dynamic `import()`), not basename
  matching.
- Where a statement is inference rather than verification, it says so at the point of use.
