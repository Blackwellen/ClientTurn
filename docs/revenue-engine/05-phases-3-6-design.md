# Phases 3–6 — channels and closing, AI economics, surfaces, data rights

Each phase is written as a buildable specification. Sections refer to the brief (§) and to the
discovery map ([00](00-discovery-and-implementation-map.md)).

---

## Phase 3 — Channels, closing, handoff (§§40–47, 53–58)

### 3.1 Booking (§57), finishing what B10 started

- **Reminders.** When a booking is created or confirmed, start the existing `booking_reminder`
  automation. The BOOKED stop condition must exempt booking reminders. Without that exemption
  they abort before they send.
- **Reschedules.** Calendly `invitee.canceled` with a `rescheduled` flag, followed by a new
  `invitee.created`, becomes one `rescheduled` transition rather than a cancel plus a new booking.
- **Meeting types and rep routing.**
  - `meeting_types`: duration, buffer, assignee rule (round robin / specialism / owner) and
    calendar.
  - Round robin works by picking the eligible rep with the fewest bookings over the next 7 days.
- **Microsoft 365 calendar** via Graph, behind the same availability interface as Google.
- **Calendly per-slot links.** Send the per-slot scheduling link Calendly returns, not the generic
  one.

### 3.2 Direct close (§§53–56, decision Q2)

- **`commercial_authority`**, one row per workspace:
  - `enabled` (default false)
  - `approved_checkout_links[]`, each with product/plan, URL, price text and currency
  - `max_discount_percent` (default 0)
  - `requires_human_above_value`
- **`propose_checkout` agent tool.** It may send only a link from the approved list, with its
  approved price text. The validator rejects:
  - any URL not on the list;
  - any price not matching the list;
  - any discount above the authority.
- A checkout sent creates or advances an **opportunity** to `CHECKOUT_SENT`.
- Completion is recorded when the customer's CRM or a webhook confirms it. The agent never claims
  a purchase.

### 3.3 Opportunities (Q3)

- Create an opportunity at qualification, or on the first close target set.
- The stages follow the motion.
- WON / LOST move here, each with a reason; lead status becomes a projection of the opportunity.
- **CRM sync:**
  - HubSpot: deal stage and closed-won/lost (the adapter exists).
  - Salesforce: Opportunity create/update (its adapter documents the gap).
  - Pipedrive: deals.

### 3.4 Handoff pack (§58)

- A deterministic **Lead Brief** with every field listed in §58:
  - sources: lead, touches, score, tags, qualification answers, objections matched, the
    conversation excerpts that support each answer, promises made (from the validator's
    commitment log), and the next step;
  - the recommended approach: method router output plus the motion.
- The **30-second brief**: one model call (tier 2, output ≤ 150 tokens) over the structured brief
  only, never the raw transcript. It is validated to introduce no fact that isn't in the brief.
- Attached to `agent_handoffs.summary_json`, shown in the handoff drawer, and pushed as a CRM note.

### 3.5 Channels

| Channel | Work |
|---|---|
| Email | Sender identity controls the From address. A daily DNS health job writes `domain_health_snapshots` (SPF, DKIM selector probe, DMARC policy). `warmup_started_at` is set when a sender is first used. A complaint rate (from B4's recorder) alerts at 0.1% and hard-pauses at 0.3% ([01 §6](01-evidence-register.md)). Caps per mailbox follow the reputation state. |
| SMS | GSM-7 / UCS-2 segment counter, used for cost and the length lint. `StatusCallback` is set on every send. Per-workspace numbers via Twilio subaccounts (tracked, not built, until pricing is set). |
| WhatsApp | Template registry synced from Twilio Content, with category recorded per send for cost. Template selection happens outside the 24-hour window, and the opt-in rule (B25) is enforced upstream. |
| Messenger / Instagram | A pre-send 24-hour window check on manual and automation sends. Past 24 hours, only a person may reply (Human Agent tag, 7 days). A bot never uses the tag. |
| LinkedIn | Stays ASSISTED. Add InMail credit tracking per [01 §3](01-evidence-register.md): 50 a month, rolling over to 150, with a credit back for a reply within 90 days. Also a manual "InMail sent" action. The social → email fallback actually enrols the prospect in an email step. |

**Channel router (§47).** A pure `rankChannels()`. It considers only channels the policy engine
allows. The inputs are:

- source channel
- the lead's stated preference
- last reply channel
- deliverability and health
- unit cost
- urgency

A prohibited channel can never win.

---

## Phase 4 — AI economics (§§67–74, 95)

- **Model tiers in the database.**
  - `ai_model_tiers`: tier 0–4, provider, deployment name, prices, enabled.
  - `ai_task_routes`: task → default tier, allowed tiers.
  - Env vars remain the fallback.
  - A provider interface wraps Azure today, so another provider is an adapter, not a rewrite.
- **Lifecycle budgets.**
  - `ai_budgets` holds scope (workspace / lead / pre_reply / opportunity / plan / emergency),
    ceiling (tokens and £), and window.
  - The budget manager decides skip / cheap / standard / high / human before `runTask`.
  - Every refusal is recorded with the reason.
- **Value-aware routing (§71).** Expected value = motion deal-size band × score-derived
  probability. Spend is allowed only while expected value × lift > AI cost + channel cost. There
  is a floor (never below tier 1 for safety classification) and a ceiling (per-lead cap).
- **Prompt versions.**
  - Persist the registry to `ai_prompt_versions` at deploy: key, version, hash of the text.
  - Every `ai_runs` row references the hash.
  - Drop the unused `agent_prompt_versions`.
- **Evals.**
  - `tests/evals/` holds golden conversations: one per motion × a representative channel, plus
    the §91/§92/§94 scenarios.
  - Deterministic assertions: no repeated question, one question, no invented price, policy
    obeyed.
  - An optional live-model run behind `EVAL_LIVE=1` records quality scores.
  - **Token regression.** A snapshot of the prompt size per task. CI fails if the input grows more
    than 20% without the snapshot being updated.

---

## Phase 5 — Surfaces (§§75–82)

- **Lead detail page** `/app/leads/[id]`. The drawer stays for quick views.
  - Header: identity, company and archetype, score + grade + why, tags, contactability per channel
    (state and reason), owner, and stage (opportunity).
  - Tabs:
    - Conversation
    - Qualification (known / inferred / missing)
    - Score history
    - Attribution (touches, first/last)
    - Activity & audit
    - AI (runs, cost, strategy chosen)
    - Documents
  - Actions: message, task, book, assign, change stage, note, re-score, enrich, qualify, takeover,
    suppress, unsubscribe, archive, delete (Phase 6).
  - Every action goes through service registry operations, so Copilot and MCP get the same ones.
- **Dashboard revenue-control cards**, all on the metric registry:
  - hot leads not contacted
  - unanswered replies
  - booking-ready
  - stalled opportunities
  - AI escalations
  - integration health
  - deliverability
  - budget
  - compliance warnings
  - the funnel from source to won

  Fix the Dashboard's local rates to use `rate()`, which returns null on zero.
- **Analytics.**
  - Slices: source, industry/archetype, campaign, channel, rep, method, score band, message
    family, model, geography, offer.
  - A low-sample flag below n = 30 for a rate, with the denominator shown.
  - Attribution-model switcher: first, last, linear.
- **Experiments** beyond cold email: variants for follow-up steps and reactivation, holdout groups
  and champion/challenger. A winner needs a minimum sample and a credible interval that excludes
  zero. Workspace learning stays in the workspace. Cross-workspace learning only from aggregates
  with k ≥ 20 workspaces.
- **Admin:**
  - stuck leads (no action for 48h while contactable and engaged)
  - duplicate queue (`merge_candidates`)
  - AI spend per workspace per task
  - provider quota usage
  - `domain_events` viewer
  - a dedicated admin audit-log page
- **Copilot and MCP.** Add registry operations for:
  - `lead.score` / explain
  - `lead.contactability`
  - `lead.suppress`
  - `message.draft`
  - `booking.book`
  - `funnel.get`
  - `ai_usage.get`
  - `opportunity.*`
  - `merge_candidate.resolve`

  Authorisation is the service runtime's (the user's own role).

---

## Phase 6 — Data rights (§§15, 83–87)

- **Four distinct operations**, each an audited service operation:
  - **Archive** (exists): hidden from active sales, fully retained.
  - **Suppress**: never contact again. Destination-keyed, survives everything.
  - **Anonymise**:
    - Personal fields are replaced.
    - Message bodies are redacted.
    - AI summaries and memory facts are deleted.
    - Touches keep only aggregate attribution.
    - The suppression row is converted to a salted hash (Q5) and `check_suppression` matches
      hashes.
  - **Delete**: anonymise, then hard-delete rows with no legal-retention need. Billing and audit
    records are retained with a pseudonymous id.

  The UI states exactly which of these happened and what remains, per brief §15: never "deleted"
  when something remains.
- **The connected CRM**: an optional "also delete in HubSpot/Salesforce" step, where the adapter
  supports it. It is reported per system.
- **DSAR.**
  - `privacy_requests` intake: public form plus admin entry, with the 30-day complaint /
    acknowledgement SLA from DUAA ([01 §2](01-evidence-register.md)).
  - Identity verification step.
  - Export: JSON + CSV of everything held on the data subject, including provenance and
    decisions.
  - Rectification and restriction (a restriction sets a LEGAL_HOLD contactability state).
- **Retention.** The `retain_*_days` settings (0066) are enforced by the daily cron: anonymise
  past the threshold, with a dry-run preview in settings.
- **Profiling transparency (§87).**
  - The score explanation is exposed to the workspace and, on request, to the data subject.
  - The feature allow-list is tested (Phase 2).
  - A "contest this decision" route for a significant automated decision (DUAA Art 22C).
- **Article 14** notice for publicly-sourced data is delivered at first contact on social as well
  as email.
