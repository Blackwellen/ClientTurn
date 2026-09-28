# The ClientTurn conversation agent

A bounded business-operations agent for one job: **respond to inbound leads
quickly, understand what they need, qualify them against the business's own
rules, answer safe questions, complete the sale (book, check out or sign up),
stop when required, and hand over to a person only as a last resort.**

It is not a chatbot product and not an autonomous agent. It is a controlled
actor inside the existing lead pipeline, and every consequential decision it
appears to make is actually made by deterministic code.

## The one rule everything else follows

> The model understands language and **proposes**.
> Application code **decides, authorises and executes**.

| The model does | Deterministic code does |
|---|---|
| Interpret what a lead means | Decide whether the agent may run at all |
| Draft wording | Decide whether a message may be sent, and when |
| Extract a candidate field value | Validate and persist that value |
| Choose among a fixed set of proposed actions | Execute (or refuse) the action |
| Summarise history | Qualification results, suppression, booking, lifecycle |

Nothing the model returns is ever executed directly. Its entire output is one
JSON object (`agentDecisionSchema`), which is treated as data and passed
through the policy engine before any of it becomes real.

## Hand-over policy: the AI carries the weight

Owner decision, 2026-09-27: *"Human handover is a bit funky; we want AI to
carry the weight; human handover is the last resort of last resorts."*

The AI keeps the conversation going and completes the sale (qualify, then
book, check out or sign up) whenever it lawfully and safely can. A person is
involved in one of two ways (`types.ts` `ESCALATION_KINDS`):

| Kind | What happens | Ownership |
|---|---|---|
| `HANDOVER` | The conversation goes to a person and the AI stops. A fixed acknowledgement is sent; `human_takeover` is set; the run gate refuses further turns. | Moves to a person |
| `ASSIST_REQUEST` | A person is asked to confirm one fact or do one task in the background, and is notified (in-app, Slack, the lead page's "Needs attention" and the inbox panel, marked "Assistant still replying"). The AI keeps the conversation. | Stays with the AI |

An assist is an `agent_handoffs` row with `summary_json.kind =
'ASSIST_REQUEST'` and `summary_json.assistReason`, so it gets the Lead Brief,
CRM note, Slack buttons and Resolve flow of a hand-over. It is stored under the
closest existing `reason` (`ASSIST_REASON_STORED_AS`): the column's CHECK
constraint is unchanged. It never moves ownership, sets `human_takeover`,
stops automation or messages the lead by itself.

**What does not change.** The deterministic rules still decide the
qualification verdict. AI-inferred values never decide pass or fail. AI never
composes a binding promise, quote, availability or service-area claim beyond
approved facts and offers. Consent, opt-out, suppression, quiet hours and every
compliance rule still bind; none of them pass through this policy.

`src/lib/agent/handover-policy.ts` (pure) decides, at three points of the
turn: `policyOnMessage` (the lead's words, before the model), `policyOnAnswer`
(the reply against the configured question, and the verdict) and
`policyOnDecision` (the model's proposal). The hand-over golden conversations
(`tests/golden-conversations/handover-policy/`) drive the same three stages.

### Still a hand-over (the last resorts, `HANDOVER_TRIGGERS`)

| Trigger | Detected by | Stored reason |
|---|---|---|
| The lead explicitly asks for a person | `classifyDeterministic` HUMAN_REQUEST; the engine's `requested_action = HUMAN`; the model's `REQUEST_HANDOVER` HUMAN_REQUESTED | `HUMAN_REQUESTED` |
| A complaint or legal threat | `classifyDeterministic` COMPLAINT ("solicitor", "legal action", "refund", ...) | `COMPLAINT` |
| An emergency, safety or safeguarding issue | `classifyDeterministic` EMERGENCY | `EMERGENCY` |
| A data-rights or privacy request | `detectDataRightsRequest` (subject access, a copy of their data, right to be forgotten). "Delete my data" is an opt-out and is suppressed first. | `POLICY` |
| A commitment the AI may not make | Bespoke contract or payment terms (`detectTermsRequest`: "net 60", "custom contract", "negotiate the terms"), at once. A discount beyond the approved maximum is **two-step**: the first explicit ask is answered by the AI (`discountGuidance`: at most the approved maximum, or the value and scope options when none is approved; `decision_json.discountDemand` remembers it); asking again or insisting on the next turn hands over. Generic pushback ("too expensive", "we need a better price") is a price objection the AI handles and never matches `detectDiscountRequest`. The model may still propose `POLICY` for the objection library's commitments (a bespoke plan, exit fees, a guarantee, a price match) | `POLICY` |
| A legal, regulatory or contract-terms question | Objection library `handover.always` (COMPLIANCE, CONTRACT), anywhere in the message, while the turn is handling an objection; the engine's interpretation | `POLICY` |
| A compliance or policy block the AI cannot resolve | A disqualifier marked `suppress` (a person confirms the suppression); the model's `REQUEST_HANDOVER` POLICY | `POLICY` |
| The workspace chose a person | agent mode Off / Suggest only (run and send gates); the opt-in "Hand over when qualification needs review"; offer hand-off rules; QUALIFICATION_POLICY escalation conditions; the qualify-only goal A | as configured |
| Repeated failure | No usable answer after **2** clarifying questions on the same point (`MAX_CLARIFICATIONS`); a VERIFY asked twice unanswered; the preferred time unreadable twice; the validator rejecting **3** drafts in one turn (`MAX_VALIDATOR_REJECTIONS`) | `LOW_CONFIDENCE` / `OUT_OF_SCOPE` |
| A booking or checkout provider failure that cannot be retried | Calendar insert failed or unconfirmed, the slot taken and fresh times unreadable, no calendar and no link outside manual mode, Calendly with no link, the checkout send failed | `PROVIDER_FAILURE` / `TOOL_FAILURE` |
| The model is unavailable and there is no deterministic way on | No model output and no next configured question to ask | `LOW_CONFIDENCE` |
| The AI budget manager chose a person | `runTask` `BUDGET_HUMAN` | `BUDGET_EXCEEDED` |

### Now the AI continues

| Situation | Before | Now |
|---|---|---|
| Low model confidence (below 0.6, or below 0.85 under CAUTIOUS) | Hand-over `LOW_CONFIDENCE` | A fixed clarifying question (`clarifyingQuestion`), no model call; hand-over only after 2 on the same point |
| An answer that matches no configured option | Model re-asked it; a repeat was rejected twice and handed over (agent); `REVIEW` + hand-over (agent off, optional question); silence (agent off, required question) | The question asked again in other words with its options named, twice at most; then a hand-over |
| A `REVIEW` verdict (a review rule, an unevaluable rule, no service) | Hand-over `QUALIFICATION_REVIEW` (`agentHandoverOnReview` default ON); lifecycle REVIEW routed every later turn to HUMAN_HANDOVER mode | Recorded by the rules, flagged for a person (`QUALIFICATION_REVIEW` assist), conversation continues; no close is offered until the verdict clears (booking still needs a clean verdict) |
| A reviewInstead disqualifier on a confirmed answer (engine) | `ESCALATE QUALIFICATION_REVIEW` | `assist_reason = QUALIFICATION_REVIEW`, plan continues, CTAs held |
| ENTERPRISE / goal E / a deal above the human-closer value | `ESCALATE READY_TO_BUY` / `HIGH_VALUE`; legacy close text told the model to hand over | The AI qualifies and **books the meeting**; the booked meeting carries the hand-off brief (`MEETING_BRIEF` assist). The meeting is the hand-off. |
| Security questionnaire, SOC 2, procurement or tender steps | Hand-over (objection `handover.always`) | A colleague sends the approved information (`SPECIALIST_REVIEW` assist); the AI carries on |
| Other objections (price, budget, competitor, timing, authority, ...) | Model-proposed hand-over on several `when` conditions | The objection playbook; a hand-over only for a commitment (bespoke terms, or a discount beyond the maximum insisted on after the AI answered) |
| "Are you a bot?" | Deterministic `HUMAN_REQUEST` hand-over | Answered honestly, the conversation carries on |
| "Can you give me a call?" | `HUMAN_REQUEST` hand-over | A warm close: bookable call times through the booking flow, marked as a phone call (hand-over only with no way to book, or an explicit ask for a person) |
| A contract lock-in ("tied in until March") | Matched CONTRACT, hand-over | The LOCK_IN playbook: reconnect ahead of the renewal date |
| Declining a discount in words ("I can't offer a discount") | Rejected by the validator as an unquantified discount offer | Allowed: `discountOffers` skips a clause that declines; an offer beside it ("but 10% off is possible") is still checked against the maximum |
| A question the approved facts cannot answer; a price that is not published | Model `REQUEST_HANDOVER` OUT_OF_SCOPE / PRICING_NOT_CONFIGURED honoured | `CONFIRM_DETAIL` / `CONFIRM_PRICE` assist; the model's reply says a colleague will confirm that detail and carries on (re-asked once with a carry-on correction; a fixed line if it still has nothing) |
| Ready to buy but no direct close (engine R8 / R10; the checkout gate at send time) | `ESCALATE READY_TO_BUY`; hand-over | `INFORM` + `SEND_ORDER_DETAILS` assist: a colleague sends the details, the AI keeps the conversation |
| Nothing worth asking and the threshold unmet (engine R12) | `ESCALATE NO_NEXT_QUESTION` | `INFORM`: one useful point and a soft next step |
| The calendar had nothing free | Hand-over `POLICY` | `ARRANGE_TIME` assist and a fixed line; the AI keeps the conversation |
| The model returned nothing usable | Hand-over `LOW_CONFIDENCE` | The next configured question, verbatim, when there is one not just asked |
| The validator rejected a draft twice | Hand-over | A third draft; hand-over only after three rejections |

Defaults for new **and** existing workspaces: risk tolerance `BALANCED`, and
"Hand over when qualification needs review" **off**. Migration
`0139_ai_carries_the_weight.sql` moves stored settings.

## Selling like a person: the elite-closer rules

Owner goal, 2026-09-27: *"the ultimate seller, triple S tier on all mediums;
must close actual sales or book real meetings; keep everything automated all
the way to close so nobody does anything."*

### Hard limits (non-negotiable)

1. **Persuasion is lawful and honest.** No invented deadline, fake scarcity,
   fabricated social proof or unapproved claim. UK law: the Business
   Protection from Misleading Marketing Regulations 2008 (B2B), the CPRs as
   carried into the DMCC Act 2024 (consumers) and the CAP code.
2. **`STYLE_PRESSURE` stays and is extended.** It still rejects deadlines,
   scarcity, "act now", threats of loss and guilt, on agent drafts and on
   restyled and reactivation copy. The response patterns and close lines are
   themselves tested against it (`tests/elite-closer.test.ts`).
3. **No binding promise beyond approved facts** (CLAUDE.md resolved conflict
   1). The business's own objection answers and reassurance assets are
   approved text: the assistant may paraphrase them, never add a fact, figure
   or promise to them. Every draft still goes through the full validator.
4. **Only legitimate levers:** relevance to the lead's own words; genuine
   proof from approved claims and case studies; reciprocity through one useful
   insight; small, easy next steps; loss framing only on a fact the lead
   stated; reframing an objection; a confident, assumptive but polite close;
   one clear call to action.

### Human writing style, enforced

Owner rule: **no emojis, and no em or en dashes used as dashes.** They make it
obvious it is AI. `human-style.ts` is the "sounds like AI" lint, run inside
`lintStyle` (so agent drafts, restyled copy and reactivation copy all get it):

| Code | Rejects |
|---|---|
| `STYLE_EMOJI` | Any emoji or pictograph (a trade mark sign is not one) |
| `STYLE_EM_DASHES` | Any em dash, or en dash used as a dash (was: more than two). An en dash in a number range ("9 to 5" written with one) is allowed |
| `STYLE_AI_TELL` | A phrase list: "Certainly!", "Great question", "delve into", "I'd be happy to assist", "As an AI", "I understand your concern", "rest assured", "don't hesitate to", "let me know if you have any questions", "hope this helps", "thank you for reaching out", "feel free to", "at your earliest convenience", "seamless", "robust", "cutting-edge", "industry-leading", "tailored solutions", "elevate/empower your", "Furthermore/Moreover/Additionally", "I'm here to help" (the existing `STYLE_CLICHE` list is kept beside it) |
| `STYLE_LIST` | A bullet or numbered list in a chat channel; headings or bold anywhere |
| `STYLE_REPEATED_OPENER` | Three sentences opening with the same word, or the same stock opening as the last message |
| `STYLE_EXCLAMATION` | More than one exclamation mark |
| `STYLE_US_SPELLING` | Common US spellings with an unambiguous UK form |
| `STYLE_NAME_OVERUSE` | The lead's first name more than once |
| `STYLE_SIGN_OFF` | A letter-style sign-off in a chat channel |
| `STYLE_INSTRUCTION_LEAK` | Wording from the strategy block ("Next best question", "How to ask it:", "Close:", "Shape: acknowledge", ...) in a draft. Instruction lines are always their own lines in the block, never appended to the question a reader (or the story harness's scripted model) takes from the end of the line |

**Rejected drafts are regenerated once, then fixed text is used**
(`compose-policy.ts nextComposeStep`). A draft failing only these rules is
sent back to the model with the corrections; if the second draft still fails
only these rules, `fixHumanStyle` repairs it deterministically (strips emojis
and dashes, turns a list into a sentence, replaces or drops the stock phrase,
UK spelling, one name, no sign-off) and the repair goes through the whole
validator again. If only polish is left after the repair (a repeated opener, a
stock phrase it could not rephrase), the repaired draft is sent
(`SEND_FIXED`); an emoji, dash or leaked instruction left over is never sent.
A style slip therefore costs at most two model calls and never hands a lead
to a person. Anything else keeps the ordinary path (three
rejections, then a hand-over). Measured on the compose scenarios in
`tests/agent-human-style.test.ts`: mean 2.0 calls, a style-only slip at most 2.

**Backstop:** `normaliseForSms` (the GSM-7 normalisation at the one SMS send
choke-point) strips emojis and turns a dash into a comma or full stop, so an
SMS never carries one whoever wrote it.

The composition prompt and the offer card teach the voice: contractions, UK
spelling, plain words, short sentences of varied length, mirror the lead's
length and register, one idea, the name once at most, answer their question
first, end on one clear question or next step, no greeting block, list or
sign-off in chat. The `agent_decision` prompt got **shorter** doing it
(1,115 to 988 tokens): the rules were rewritten tightly rather than added.

### Objection handling

The library (`sales-library/objections.ts`, `sl-2026.09.3`) covers price,
budget, timing, authority, need, status quo, trust, send me information,
already have a supplier, competitor, too busy, not now, contract lock-in,
security and procurement (an assist: a colleague sends the documents), just
looking, and the rest. Every objection has detection phrases, underlying
concerns, and **2 or 3 response patterns** (`objection-responses.ts`) in the
proven shape: acknowledge, clarify the real concern with one question when it
is unclear, reframe with value or approved proof, then one small next step.
The first objection of a kind gets the clarifying pattern; a repeat gets the
reframe (`objectionRaisedBefore`).

**Objection matrix pass (2026-09-28).** The next step now follows the goal
(`objectionGoalFor`, `GOAL_NEXT_STEP`): a pattern that advances the sale
closes on a meeting at two confirmed times, the checkout link, the sign-up
link or a priced quote, so a direct-sale or trial lead is no longer steered
into a call. A clarifying turn ends on its one question and keeps the step
for the answer; a repeat carries "take a new angle, never repeat an earlier
question or reason". The AI concern ("is this a bot?", "I'd rather not talk
to a robot") is a TRUST playbook answered honestly (`trust-ai-honest`). A
figure was removed from a library step ("a 15 minute slot"). Evidence:
`tests/objection-matrix.test.ts`, 120 cells (objection x SMS / email /
WhatsApp / voice x meeting / sale / trial / quote x first / repeat), each
checked against the strategy block or call brief and graded by the reply
grader plus a written rubric: before 54 of 120 at 90 or above (mean 84.5),
after 120 of 120 (mean 99.6). The replies were written by Claude acting as
the model: this proves the library and the plan, not production wording.

A contract **lock-in** ("tied in until
March") is the AI's to handle and never matches the CONTRACT hand-over, which
is now reserved for a question about terms.

**The business's own objections** (Settings -> AI & selling -> Objections;
`workspace_sales_overrides` kind OBJECTION, payloads validated by
`workspace-objections.ts`, documented by migration 0147): the objections it
hears most, how leads phrase them, its best answer, and reassurance assets
(SLAs, guarantees, case studies, testimonials it owns, response-time
commitments). A business phrase wins over the library in any mode; its answer
to a library objection refines that playbook. The strategy line says to use
it, paraphrase it and add nothing; reassurance is quoted word for word or not
at all, and also sits in the offer card as approved claims. The business's
text is held to the same rules as a draft on save (no emoji, dash, list or
pressure). **Try it** (`objection-preview.ts`, `sales_objections.preview`) runs
a message through the real matcher, strategy block, validator and reply grader
offline with a deterministic stub composer (production code has no fake
model; the story harness's scripted model is test-only) and spends nothing.

### Closing by motion (`closing.ts`)

| Goal | Close |
|---|---|
| Meeting / consultation / quote | Assumptive: two of the confirmed times, "I can do X or Y", then "Does either work?" |
| Direct sale | The approved checkout link plus the one line of value that matters to this lead, in their words |
| Trial or sign-up | Make starting easy: the link, and the one friction they raised answered from approved facts |
| Enterprise | A meeting, with a brief of what they said passed to the person who takes it |

**A call request is a warm close, not a hand-over.** "Can you give me a
call?" still classifies as `HUMAN_REQUEST` (so a workspace with the agent off
is told), but when a booking route exists the orchestrator treats it as a
booking request: bookable call times through the ordinary booking flow, the
lead's preference recorded as `phone`, the booking marked as a phone call and
a "Phone call" meeting type used when the workspace has one
(`selectCallMeetingType`). An explicit ask for a person, or no way to book,
still hands over. The call close still names the booking tool in the plan's
move ("offer the confirmed slots (SEND_BOOKING_OPTIONS)", then how to word a
phone-call close): without it the model was told how to word a close it had no
way to take, and "can we book a call?" never reached the slots (stories Q1, S3).

**Trial close on buying signals.** `detectBuyingSignal` ("what's the next
step?", "how do we get started?", "let's do it") skips an optional qualifying
question and trial-closes instead; a required question is still asked. The
engine reads it too: `interpret()` sets `close_instead`, and the NBA treats it
as booking-ready (goals B/E) or purchase-ready (goals C/D), so an engine-LIVE
turn goes to R7 / R8 (at most one gating question). A request to book never
becomes a checkout, nor a purchase a meeting.

### Qualification craft (`question-craft.ts`)

The one question per turn is asked the way a skilled seller asks it: tied to
the lead's last answer, with an honest reason where a question could feel
nosy (`WHY_ASK`: budget "so you can point them to the option that fits",
authority, timing, size, location, current solution, technical fit). The NBA
still decides what is asked.

### Contact-channel preference (`channel-preference.ts`, 0147)

Asked at most once, lightly, never as the first question (not before the
lead's second message), never on a turn that already asks something, handles
an objection or closes. The answer is parsed deterministically and stored on
`leads.preferred_contact_channel`; automated follow-up uses that channel when
it is usable (`preferredStepChannel`), and the policy gate still decides every
send. The columns are read on their own, so the code is safe before 0147 is
applied.

### Evidence

* `tests/agent-human-style.test.ts`: every lint rule, the repair, the GSM
  backstop, the compose loop's model calls, and no prompt or template with an
  emoji or dash.
* `tests/elite-closer.test.ts`: the taxonomy and response patterns, hard
  cases per objection, workspace objections and Try it, closes per motion, the
  call close, buying signals, the channel question, and the reply grader.
* **Reply grader** (`reply-grader.ts`, /100): human style (no AI tells, length
  fit, natural voice, UK spelling, chat format) and persuasion (answers first,
  specific to the lead, one CTA, grounded proof on an objection). Held-out
  fixture `tests/fixtures/reply-grades-heldout.json` (22 labelled replies)
  was written before the grader and never edited to fit it: the first version
  agreed on 16 of 22; one principled change (a reply with one clear flaw
  fails, so no criterion may fall below half marks) brought it to 22 of 22.
* 20 new eval cases (`tests/evals/cases/objection-*`, `close-*`) with a
  plan check, human and AI-voice candidates and a grade floor, and three new
  golden conversations.

## Where it sits

```
Twilio / Meta / mailbox
        │  webhook, verified + stored (existing code)
        ▼
message-inbound.ts ──► deterministic opt-out check ──► suppression (no model)
        │
        │  agent enabled for this workspace + channel?
        ▼
enqueueAgentTurn()  ──►  jobs table  ──►  /api/cron/worker  ──►  agent.run
                                                                    │
                                                                    ▼
                                                          orchestrator.runAgentTurn
```

The webhook never waits for a model call. It stores the inbound message,
queues a turn, and acknowledges — which is what stops Twilio and Meta from
retrying (and therefore duplicating) because inference was slow.

With `agent_mode = 'OFF'` — the default for every workspace — the inbound
handler's original deterministic flow runs completely unchanged.

## The turn

`src/lib/agent/orchestrator.ts`. Linear, bounded, no free-running ReAct loop:

```
assemble context
  → run gate            may the agent act at all?
  → claim turn lock     one turn per conversation at a time
  → deterministic classification    (binding verdicts short-circuit here)
  → send-guard prediction           would the reply even be sent? (story I3)
  → preferred-time reply?           manual booking mode (story H3)
  → record configured answers, engine verdict
  → qualification engine            interpret + write back, re-assess, NBA
                                    (OFF: skipped; SHADOW: recorded; LIVE: acted on)
  → zero-token NBA actions          wait / stop / disqualify / escalate / ask a time
  → slots fetched when booking is the plan
  → model proposal      exactly one call, plus at most one retry
  → policy validation
  → tools
  → compose + validate + question QA  up to three drafts, then hand over
  → send / draft / queue
  → persist + log       decision_json.strategy + decision_json.qi
  → release turn lock
```

`MAX_AGENT_STEPS = 5` is the ceiling. Most turns use one or two.

## Module map

| File | Responsibility | Pure? |
|---|---|---|
| `types.ts` | Vocabulary, `agentDecisionSchema`, confidence policy, limits, `ESCALATION_KINDS`, `ASSIST_REASONS` | ✅ |
| `handover-policy.ts` | The hand-over policy: the last resorts, clarification counting, assists, the fixed clarifying and assist wording | ✅ |
| `classification.ts` | Deterministic reply classification — binding verdicts | ✅ |
| `lifecycle.ts` | Lifecycle + mode derivation from existing columns | ✅ |
| `policy.ts` | Run gate, send gate, tool gate, length policy | ✅ |
| `validate.ts` | Outbound claim validation + style/QA lint (clichés, "just", one question, pressure, workspace forbidden phrases / prohibited claims) and the human-style lint | ✅ |
| `human-style.ts` | The "sounds like AI" lint (emoji, dashes, AI tells, lists, openers, exclamations, UK spelling, name, sign-off) and `fixHumanStyle` | ✅ |
| `compose-policy.ts` | After a rejected draft: regenerate, repair (style only, after one regeneration) or hand over; the call-count simulator | ✅ |
| `closing.ts` | Close lines per motion, buying signals, call requests | ✅ |
| `quote-flow.ts` | The quote path: detection, catalogue items, inputs, the one step per turn, the tool gate, the concession, the verbatim figures and the fallback wording (see Quotes) | ✅ |
| `quote-turn.ts` | The quote path's reads for one turn: the open quote, the path state, the catalogue, facts, the AI policy | server |
| `question-craft.ts` | How the one question is asked: tied to the last answer, with a reason where it helps | ✅ |
| `channel-preference.ts` / `-store.ts` | The one-time channel question and its answer (0147) | ✅ / server |
| `reply-grader.ts` | The /100 human-style and persuasion grader | ✅ |
| `objection-preview.ts` | Settings "Try it": offline objection preview, stub composer | ✅ |
| `strategy.ts` | The per-turn strategy block: motion, question style, objective, the one next question or "stop and propose the close", what not to ask, objection playbook. Method + reason stored in `decision_json.strategy`. `buildNbaStrategyBlock` renders the engine-LIVE block from the NBA alone (≤150 tokens) | ✅ |
| `qi-turn.ts` | The engine inside a turn, pure: the LIVE plan for an NBA (`planFor`), the SHADOW diff, the QA context, `decision_json.qi` accounting, tokens by action, the asked-intent lookup, VERIFY answers | ✅ |
| `qi-runtime.ts` | The engine inside a turn, server: engine mode, `interpret()` + write-back, re-assessment, NBA with the real checkout gate, QUESTION_STRATEGY wording; the non-agent inbound write-back | server |
| `availability/preferred-time.ts` | Manual booking mode: the lead's stated day and time as one concrete slot, or ambiguous | ✅ |
| `../qualification-intelligence/qa.ts` | The 13 pre-send question checks (design 08 §16) | ✅ |
| `../qualification-intelligence/grade.ts` | The /100 question grader (design 08 §24), stored on the turn's accounting | ✅ |
| `offer-card.ts` | One voice profile + budgeted offer card (≤600 tokens), accepted/verified facts only, sent as the stable prompt prefix | ✅ |
| `../qualification/next-question.ts` | Adaptive question selection: known/inferred questions never asked, value-ranked, stops at the motion's decision threshold | ✅ |
| `context.ts` | Context assembly + prompt block rendering | server |
| `tools.ts` | Tool registry, permissions, executors | server |
| `orchestrator.ts` | The turn | server |
| `availability/slots.ts` | Slot generation, timezone maths, confirmation matching | ✅ |
| `availability/index.ts` | Google/Calendly providers and the resolver | server |
| `summary.ts` | Rolling conversation memory | server |
| `queries.ts` | Reads for the assistant surfaces | server |
| `actions.ts` | Handover / draft / ownership CRUD | server |
| `views.ts` | Read models and labels for the UI | ✅ |
| `audit.ts` | Runs, actions, extractions, skipped runs | server |
| `events.ts` | Event normalisation + queueing | server |

The pure modules are unit-tested with no database — `tests/agent.test.ts`
(71 cases) and `tests/agent-availability.test.ts` (28 cases). That is
deliberate: a rule like *never message a suppressed contact* is only credible
if it can be proven without infrastructure.

> Note the naming: `src/lib/agent/` (singular) is this conversation runtime.
> `src/lib/agents/` (plural) is the separate V4 sourcing-agent feature.

## What the model cannot do

### Deterministic verdicts outrank it

`classifyDeterministic()` runs **before** the model on every inbound message.
When it returns a binding verdict there is no model call at all:

| Message | Verdict | Consequence |
|---|---|---|
| "STOP", "take me off your list", "do not message me" | `UNSUBSCRIBE` | Suppress, stop every queued send, close |
| "wrong number", "who is this" | `WRONG_NUMBER` | Suppress **that endpoint only** |
| "this is a scam", "I want a refund" | `COMPLAINT` | Handover, urgent |
| "gas leak", "flooded" | `EMERGENCY` | Handover, urgent |
| "speak to a human", "can I talk to a person" | `HUMAN_REQUEST` | Handover |
| "are you a bot?", "am I talking to a real person?" | Not binding (`isBotQuestion`) | Answered honestly: the business's AI assistant, a person can join if they would like (`disclosureGuidance`); the conversation carries on. The validator rejects any claim or implication of being human (`CLAIMS_TO_BE_HUMAN`). A hand-over only if they then ask for a person |
| "are you hiring", supplier pitches | Not a lead | Stop sequence, no sales reply |

Precedence matters: an opt-out inside an otherwise friendly message is still
an opt-out, and suppression outranks a complaint in the same message.

This layer also strengthened the **non-agent** path: `message-inbound.ts` now
checks these phrases alongside the existing carrier keywords, so a workspace
with the agent off also honours "please don't text me again".

### The response validator

Every candidate reply is checked before it becomes a message. A failure
discards the draft and feeds a correction back for a retry; the third
rejection in one turn hands over (`MAX_VALIDATOR_REJECTIONS`).

| Rejected | Unless |
|---|---|
| Any money amount | It appears in wording the workspace published, an approved checkout link's price text on the turn that sends it, or this turn's quote figures (`calculate_quote` / the current revision) |
| Any VAT or tax statement | A VAT-registered quote is in play, and any rate named is on it. Never improvised |
| A delivery, start or completion promise ("ready in two weeks", "we can start on Monday") | Never |
| Any specific time offered | It came back from a calendar tool this turn |
| "You're booked" | `create_booking` actually succeeded |
| "We cover your postcode" | A service-area tool positively matched |
| "Someone will call within 10 minutes" | Never — no SLA is configured |
| Any link | It is the configured booking link |
| Mentioning prompts, providers, credentials | Never |
| Claiming to be human | Never |
| Over the channel's hard length | Rejected, never truncated mid-fact |
| Pressure language: invented deadlines or scarcity, "act now", threats of loss, guilt | Never (`STYLE_PRESSURE`; also applied to restyled and reactivation copy, which falls back to the template) |
| An emoji, an em or en dash used as a dash, an AI tell, a list in chat, US spelling, the name twice, a chat sign-off | Never (the human-style lint). Regenerated once, then repaired deterministically, never handed over |
| A question the business already asked on this thread, word for word or nearly (normalised words; ≥80% overlap of the smaller question and ≥0.6 Jaccard) | Never verbatim. A near-duplicate is allowed only when the engine (LIVE) planned a VERIFY of a stale fact (`QA_REPEAT`; `repeatedQuestion` in `validate.ts`, prior messages from `recentMessages`) |

Truncation is deliberately not a remedy: cutting a message in half can change
what it promises.

### Pricing

`services.pricing_visibility` defaults to `QUOTE_REQUIRED`. The existing
`services.average_value` is internal commercial data and is **never** loaded
into a prompt. A workspace must explicitly set `PUBLIC_FIXED` / `PUBLIC_FROM`
and write the wording it is willing to have quoted.

### Tools

The model names an action, never a target. Every tool receives a `ToolContext`
the runtime built from the verified event — business, lead, conversation,
channel — and no tool's input schema contains those identifiers, so no model
output can redirect one at another workspace or another lead.

There is no SQL tool, no HTTP tool, no shell. No tool is `CRITICAL` risk:
billing, account administration, permissions and credentials are outside this
agent's authority entirely, and `evaluateToolGate` refuses `CRITICAL`
unconditionally.

| Tool | Risk | Requires |
|---|---|---|
| `check_service_area` | LOW | — |
| `get_calendar_availability` | LOW | A connected, healthy calendar |
| `record_reply_classification` | LOW | — |
| `draft_message` | LOW | — |
| `record_qualification_answer` | MEDIUM | Value re-validated by the deterministic matcher |
| `update_lead_fields` | MEDIUM | Whitelisted field, blank target, confidence ≥ 0.85 |
| `send_message` / `send_booking_link` | MEDIUM | Contactability |
| `stop_follow_up` | MEDIUM | — |
| `create_booking` | HIGH | Confirmed availability + eligible lifecycle + confidence ≥ 0.9. Eligible = QUALIFIED, BOOKING_PENDING or BOOKED, **or** (engine LIVE) the engine judged the lead booking-ready on the turn that offered the booking (`qi-turn.ts` `engineBookingReadiness`: CTA_BOOK with no gating question left, goal B, gating and required dimensions known, no NOT_QUALIFIED/REVIEW verdict) and the lifecycle is NEW, CONTACTED, ENGAGED or QUALIFYING. Readiness is recorded in `decision_json.engineBookingReady` when slots are offered or the preferred time is asked, and read back with them |
| `request_human_handover` | HIGH | — (a last resort only: see Hand-over policy) |
| `request_assist` | LOW | — (a background task; ownership never moves) |
| `apply_suppression` | HIGH | A **recognised** opt-out — only the deterministic layer can set this |
| `propose_checkout` | HIGH | The checkout gate (direct close on, the motion, an approved link, the value ceiling) + contactability |
| `calculate_quote` | LOW | `quoteToolGate`: AI on, `quote_ai_enabled`, "Draft quotes" (see Quotes) |
| `draft_quote` | MEDIUM | As above; idempotent on the conversation plus the message that asked |
| `request_quote_approval` | MEDIUM | As above; once per revision |
| `send_quote` | HIGH | "Send quotes" (the owner's standing confirmation for this EXTERNAL operation) + contactability |
| `propose_discount` | HIGH | "Offer discounts"; the quote core's discount policy decides |

Allowed calls and refusals are both written to
`conversation_agent_actions`. A denial is the interesting row.

**Context is pushed, actions are pulled.** There are no `get_lead` /
`get_services` / `get_qualification_state` tools — the assembler already holds
that, and a round trip to fetch it would spend a model call for nothing.

## Ownership and concurrency

`conversations.owner` is a separate axis from `conversations.state`:

`AI_ACTIVE` → `HUMAN_ACTIVE` / `HANDED_OVER` → `CLOSED`

The agent may only act while `AI_ACTIVE`, and **never takes ownership back on
its own**. A handover moves ownership in the same operation that creates the
handoff row, so the agent cannot take another turn on that conversation.

Two inbound messages arriving together cannot produce two replies:
`claim_agent_turn()` bumps a monotonic sequence under a lock and returns null
to the loser, which drops its turn.

## Idempotency

| Layer | Key |
|---|---|
| Inbound message | `(provider, provider_message_id)` — existing |
| Agent run | `(business_id, idempotency_key)` from the stored message id |
| Job | `agent.run:<idempotency_key>` |
| Outbound message | `send_key` = `agent:<run id>` |
| Qualification answer | upsert on `(lead_id, question_id)` |
| Handoff | one open row per conversation (partial unique index) |
| Agent quote | `agent:<conversation>:<message that asked>` -> `quotes.request_key` |
| Agent quote send / approval request / discount | `commercial_action_claims.action_key`, per revision |
| Commercial actions on one lead | `claim_commercial_action` (0160): the lead's advisory lock (the voice dial's) and the one-actor lease |
| Suppression | upsert on `(business_id, normalized_contact, channel)` |

A retried job either resumes a crashed turn or finds the work done. Model
generation retries are separated from tool execution, so a successful side
effect is never repeated because a later generation failed.

## The qualification engine in the turn

`docs/revenue-engine/08-qualification-intelligence.md` (design) and its
contract, `qualification-intelligence/types.ts`. The engine (intent, facts,
offer, goal, question value, next best action) is deterministic; the model
still only words what code decided.

**Engine mode** (`QUALIFICATION_POLICY '*'` payload `engineMode`, CD-9):

| Mode | What the turn does |
|---|---|
| OFF | Nothing below runs. The turn is the legacy turn, unchanged, and no `decision_json.qi` is written. |
| SHADOW | The reply is interpreted and written back, the lead re-assessed and the NBA decided and stored (`lead_assessments`), and the turn-level difference from the legacy decision is recorded (`decision_json.qi.accounting.shadow_differs`). QA and the question grade are recorded on the run. The turn acts on the legacy decision: nothing the lead sees changes. SHADOW is a rollout stage (the default until the §C.5 release gates pass), not a permanent mode. |
| LIVE | The turn acts on the NBA. |

**Every inbound reply is written back (CD-15).** `interpret()` reads the reply
across every dimension, deterministic first; the optional AI assist (one nano
`answer_extraction` call, only when the rules found nothing) proposes INFERRED
candidates with verbatim evidence. Facts go to `lead_qualification_facts` and
signals to `lead_intent_signals`, both with `source_ref` = the inbound message
id. A "yes" to a VERIFY question confirms the value it showed. The same
write-back runs on the non-agent inbound path when the engine is on.

**The NBA decides whether a message is needed at all.** LIVE:

| NBA | Turn |
|---|---|
| WAIT, NO_ACTION, DISQUALIFY | No message and no model call. Follow-up is stopped where the NBA says so; a WAIT re-assesses at its resume time. A DISQUALIFY with `suppress: true` also hands the conversation to a person **without** an acknowledgement, asking them to confirm the suppression. The agent never suppresses (`apply_suppression` still needs a recognised opt-out). The handover sets `human_takeover`, so the run gate refuses further turns (no model or AI-assist spend), and the send guard stops automated sends until a person decides. |
| ESCALATE | The handover, with its fixed acknowledgement. No model call. The engine escalates only for a last resort (a person asked for, a complaint, an emergency, a legal or contract question, a verify asked twice, a rule the workspace configured). |
| CTA_BOOK in manual booking mode | The fixed "which day and time?" question (below). No model call. |
| ASK, ANSWER_AND_ASK, ANSWER, INFORM, NURTURE, CTA_* | The model composes, from the NBA strategy block: the move, the one question intent's rendering (or none), what is known by dimension. Never the full plan, never a method name. When the NBA carries an `assist_reason`, the assist is raised and the block adds one line on what to tell the lead (nothing for a REVIEW). |

**Pre-send question QA** (`qa.ts`, 13 checks) runs on every draft of an
engine-planned turn: an unplanned question, asking the known, a forbidden,
premature or off-profile question, intrusive, generic, form-like, channel
formatting, ignoring the lead's own question or asking before answering it,
qualifying when the plan is to close, and repeating an unanswered question. In
LIVE a rejection takes the validator's path (retries with the correction,
a handover after the third rejection). The sent question's /100 grade is
recorded.

**`decision_json.qi = { nba, interpretation, accounting }`** on every run the
engine took part in (CD-14), validated against `agentRunQiSchema`. The
accounting says which action and rule, whether the model was called or the
call avoided, the strategy-block and interpretation tokens, the QA findings and
the question grade. Tokens and cost stay on the run's own columns, so tokens
per action and calls avoided are read from the run (`qi-turn.ts tokensByAction`).

**Question features.** Every message that asks a question carries
`messages.features.questionIntent` (MessageFeatures v2): the NBA's intent in
LIVE, the configured question as `custom:<id>` otherwise. The engine's ask
history, the one permitted sticky re-ask and question performance
(`analytics/question-performance.ts`) all read it. A running QUESTION_STRATEGY
experiment may change a planned question's wording (never its plan); its
metric is bookings or wins, never replies.

## Several interests

`qualification-intelligence/interests.ts` (pure), 08 §B.20, migration
`0144_lead_interests.sql`. A lead can want more than one thing: a
subscription (a sign-up by checkout link) and a website rebuild (a meeting).
Each is an **interest**: its own opportunity with its own resolved goal,
motion, stage, close target, qualification state and next best action.

**Detection.** The service the lead came in on; any configured service its
own messages name (`servicesMentioned`: full name, all significant words in
any order, or an unshared head noun; a negated mention names nothing); a
service a form it submitted selected; one a person added on the lead page
(registry `opportunity.add_interest`). Each is recorded as a CONFIRMED
`SERVICE_NEEDED` fact for that service (`source_ref` `...#interest:<service>`),
so it survives without 0144 and the interest's own service is never asked.

**Shared and per-interest facts.** `SHARED_DIMENSIONS` (company size, team
size, the decision maker, stakeholders, decision process, timing, location,
availability, compliance) are asked once and read by every interest.
Everything else (budget, scope, use case, the problem, current solution ...)
belongs to one interest: a reply's per-offer facts go to the interest it
names, else the one the last turn was about (`decision_json.interests`),
else the lead's own; facts merge only within their interest
(`factsInMergeScope`), so the website's budget never conflicts with the
subscription's. With one interest nothing is scoped and the engine is
unchanged.

**One move per turn.** Every interest is planned by the unchanged NBA over its
own facts, offer and goal (`planInterests`). `coordinateInterests` picks one:

| Order | Rule |
|---|---|
| 1 | Lead-level rules bind every interest: a binding verdict, an opt-out or negative intent, a hand-over |
| 2 | Closed interests are done; a disqualified or waiting one is not pursued this turn |
| 3 | The interest closest to its close (a CTA, then threshold met, then stage and completeness), then the one the lead just named, then deal value |
| 4 | A checkout or sign-up link (which asks nothing) may carry one light touch on the next interest: its one planned question (not on SMS/WhatsApp), or "would a quick call about it help?" with no day or time named. A question the lead asked about another interest is answered. Everything else waits for a later turn |

The strategy block names the offer ("This turn is about ..."), the approved
link for it, the light touch, and "do not raise X in this message". Pre-send
QA treats the companion question as planned and checks it against that
interest's own dimensions (`QaContext.companionQuestion`). One question per
reply still holds.

**Closing each.** The turn is narrowed to the chosen interest
(`agent/interest-focus.ts`): the direct-close gate reads that offer's motion
(a self-serve subscription closes by checkout in a meeting-led workspace), its
own approved link (`offer_profile.checkoutLinkId`, else the link whose product
names the service, never another offer's), and booking uses that service's
meeting type. The checkout path, tracked links and the validator are the
existing ones; nothing is loosened. `advanceLeadOpportunity` routes each
funnel event to its interest (a named service; a checkout by the service its
link sells; a booking to a meeting-goal interest not yet booked). With 0144,
`close_opportunity` projects the lead's status only when no other opportunity
is open: winning the subscription stamps `won_at` but the lead stays in its
funnel status, `automation_active` stays on and follow-up continues for the
website. Follow-up stops when every interest is closed or the lead opts out.

**Records.** `decision_json.interests` on every coordinated run (primary,
companion, each interest's action and rule). `opportunities.goal /
qualification_state / nba / interest_source / assessed_at` per interest
(0144), written after each assessment. The CRM push sends each interest as
its own deal (HubSpot deals, Salesforce Opportunities; `crm_push_records.
external_deal_ids`); the existing deal stays attached to its own opportunity,
and a single-interest lead pushes exactly as before. Zoho has no deal object
here and is unchanged.

**Without 0144** the engine still plans and coordinates across interests
from the facts, and the conversation behaves the same; the per-interest
opportunity rows, the guarded close projection and the extra CRM deals start
when it is applied.

## Quiet hours, suppression and sending

The agent does **not** own any of these. `evaluateSendGate` predicts what the
existing send guard in `send-core.ts` will do so the turn can report the right
outcome (`MESSAGE_QUEUED` vs `MESSAGE_SENT`) — but the guard re-checks stop
conditions, suppression, quiet hours and connection health against live state
immediately before dispatch, and it has the last word.

`origin = "agent"` is the conversation agent's reply to a message the lead
sent (story I3). A lead having replied does not block the reply owed back to
them; `automation_active` governs outbound *follow-up*, not replies, so a lead
created through the API or an import (follow-up off) is still answered; and a
BOOKED lead is still helped with their booking. Opt-out, suppression, human
takeover, won / lost, channel health and quiet hours bind absolutely. A turn
not triggered by an inbound message keeps the paused meaning.

The turn predicts the guard (`predictAgentSend`) before any model call: a reply
the guard would stop is never composed, and the run records `NO_ACTION` with
`error_code = STOPPED_<REASON>` rather than `MESSAGE_SENT` for a message that
was never going to leave.

## Re-engagement: when the agent reaches out first

The agent is started by an inbound message, with three exceptions that are
all `FOLLOW_UP_DUE` turns: the direct-sale agent's abandoned-checkout nudges
(`payments/nudge-event.ts`) and two intent triggers from
`src/lib/reengagement/`:

| Trigger | When | Who writes the message |
|---|---|---|
| `NOT_NOW_RESUME` | 30 min after a NOT_NOW signal's `resume_at` (the engine re-scores at `resume_at`), then moved to the lead's best send hour | the agent (`FOLLOW_UP_DUE`, mode `FOLLOW_UP`) |
| `DEADLINE_PASSED` | the day after the date in a TIMEFRAME signal (`flat_until` minus 7 days) | the agent |
| `NO_SHOW_REBOOK` / `NO_SHOW_NUDGE` | 15 min and 24 h after a booking is marked no-show | fixed copy with the calendar's own free times and the booking link |
| `WIN_BACK` | after a lost deal, by loss reason (Price 75 d, Timing at the stated date else 90 d, Competitor 120 d, No response 60 d; never No need, Other or do-not-contact) | fixed copy; a Price loss may include the workspace's first **approved** checkout link with its exact price wording, never a discount |

Each trigger is a `reengage.trigger` job keyed `reengage.trigger:<trigger>:<source>`,
planned once per source by the outbox consumer (`meeting.no_show`,
`opportunity.lost`, `lead.intent_changed`, `lead.scored`) or the hourly
`reengage.sweep`. The job re-reads the lead, the source and the workspace
switches and cancels on any stop condition (opt-out, takeover, won, archived,
a newer signal, a new booking, a live conversation, paused follow-up), then
checks the frequency guard, then picks the channel cost-first, and only then
acts. The agent turn it asks for is keyed `reengage:<trigger>:<source>` (so the
run names its loop) and carries **no text**: `text` is the lead's words, and a
trigger has none. The model sees the conversation, including what the lead
said ("try me in March"), through the normal transcript blocks.

**Why it is writing.** The trigger queues the reason as structured facts on
the event payload (`reengagement`, `sourceId`, `reengagementDate`: the NOT_NOW
`resume_at`, or the TIMEFRAME's stated date). The orchestrator renders them
with `reengagementReasonLine` (`reengagement/triggers.ts`) into one line on the
turn's plan, legacy or engine ("Why you are writing: a planned check-in,
because they asked to be contacted around 1 March 2027..."). No new event type:
the check-in stays a `FOLLOW_UP_DUE` turn, and the line is built from our own
fields, never from free text.

**The engine never answers a due check-in with another WAIT.** The turn passes
`checkInDue` to the NBA (`qi-runtime.ts`). A NOT_NOW whose resume date has
passed (R6), or a LOW / no-intent lead who has not replied (R11), is planned
`NURTURE` on that turn: re-engage briefly from what is known, no new discovery
question. A NOT_NOW the lead renewed (resume still ahead), a negative or
suppressed lead are unchanged. Before this, a "not now, try me in March"
check-in composed nothing (story R1).

**A dated lock-in is a planned reconnect.** "We're tied into a contract until
March" (objection `LOCK_IN` with an end date more than six weeks away) is a
NOT_NOW whose `resume_at` is six weeks before the end
(`signals.ts lockInReconnectAt`), so `NOT_NOW_RESUME` reconnects in time to
compare. Never a hand-over. "Our contract ends next month" is a lead in the
market now, not a wait.

Where the agent cannot run (AI off, agent OFF, or not enabled on the chosen
channel), the check-ins fall back to the fixed copy in
`reengagement/templates.ts`. No template names a price, a time or an area the
workspace did not register.

### The frequency guard binds every automated touch

`send-store.ts policy()` calls `frequencyGateForMessage` first, for every
message, immediately before sending. An **automated touch** is a sequence
step, a campaign message, a trigger message, and an agent message whose run
was not started by the lead (`isReplyTrigger` false, from the run's
`trigger_event_type`; the run id comes from `agent_run_id` or the tail of the
`agent:<run id>` send key, so the tagging race cannot let one through). A
reply to the lead, a person's message, a system message and a booking
reminder are never counted and never limited.

Defaults per lead, across every loop: **1 a rolling day** (over it: deferred
until the day frees), **3 a rolling week** and **6 per 30 days** (over them:
skipped, `policy:BLOCKED_CONTACT_FREQUENCY`; a deferral that would wait more
than 48 h is a skip). The **dead-lead rule**: after **4** automated touches in a
row with no reply and no open or read receipt, at intent LOW or below, every
automated loop stops (`policy:BLOCKED_DEAD_LEAD`, sequence runs stopped with
`dead_lead`) until the lead engages; a person can still message them. The
first 72 hours of the enquiry's own sequence are exempt from the day and week
caps (the lead has just asked to be contacted), not from the 30-day cap or the
dead-lead rule. Workspace-configurable within bounds in Follow-Up > Settings
(0146 `business_settings.contact_cap_*`, `dead_lead_after_touches`).

Other loops that want the verdict before they queue call
`checkAutomatedTouchAllowed({ businessId, leadId, loop })`
(`reengagement/service.ts`). The send gate enforces it again regardless.

## LinkedIn: a different gate, and a different arrival

The agent runs on `linkedin` too, but it gets there by a route no other channel
uses, and the difference is worth stating before the Meta section below —
because the two look alike and their gates have nothing in common.

**There is no reply window.** Meta's gate is time: 24 hours from the person's
last message, and only they can reopen it. LinkedIn's gate is *acceptance of a
connection request*, which never expires once granted. A LinkedIn thread that
has been quiet for three months is still answerable; a Messenger thread quiet
for 25 hours is not. Nothing in `withinSocialReplyWindow` applies here, and
applying it would silently stop the agent answering conversations it may
perfectly well answer.

**The agent never opens the conversation.** Everything before the first reply —
the connection request, the opening message, up to two follow-ups — is composed
by the deterministic sequencer in `lib/outreach/social-sequence.ts` and never
enters the agent runtime. That is a deliberate boundary, not an omission: cold
outreach copy is the highest-risk text the product produces, and it is guarded
by `checkComposedCopy` (no price, no promise, no availability, no invented
familiarity, no uncited fact) with a template fallback that is always sendable.

**The agent arrives with the lead.** A prospect who replies is promoted — the
same `conversations` row gains a `lead_id`, so the whole social thread is
already there — and `ingestSocialReply` enqueues the turn. From that point it is
an ordinary lead conversation: same tools, same qualification, same booking
path, same handover rules.

**There is no send transport.** `messaging/registry.ts` refuses `linkedin`
explicitly rather than falling through to the carrier. An agent reply on this
channel is stored and performed from the social queue, or through a partner
integration where a workspace has one. See `lib/outreach/social-partners.ts`.

Length is the one ordinary thing: `CHANNEL_LIMITS.linkedin` is
`{ preferred: 700, hard: 1900 }` — the hard figure is the platform's own
ceiling, the preferred one is far below it because the message is read in a
narrow chat pane and not in an inbox.

## Social channels: Messenger and Instagram

The agent runs on `messenger` and `instagram` exactly as it runs on SMS. Same
turn, same tools, same guardrails, same deterministic qualification. Three
things differ, and all three are consequences of one fact about Meta.

**Meta lets a business answer someone who interacted with it, and nobody else.**
There is no API for a Page to follow a person, and no way to message a stranger.
But "interacted" is broader than "messaged", and the difference is what makes
this channel work at all:

| They did this | We may send | Within |
|---|---|---|
| Messaged the Page or account | Unlimited replies | 24 hours of their last message |
| Commented on a post, reel or ad | **One** private reply | 7 days of the comment |
| Mentioned the account in a story | **One** private reply | 7 days |
| Nothing | Nothing | — |

The private reply is the entry point. It is addressed to a **comment id**, not
to a person — `recipient: { comment_id }` — so there is no way to express
"message this user", only "answer this thing they said on our post". That is
precisely why it is permitted, and it is why `engagement-ingest` records the
comment's own id and timestamp: both are needed to send one.

Three properties of the private reply that the code must respect exactly:

* **One per comment, ever.** Not one per person, not one per day. A second
  attempt against the same comment id is refused.
* **Seven days from the comment, not from when we noticed it.** Meta clocks it
  against the comment's creation timestamp, so a backlogged worker can miss the
  window on a comment posted minutes ago in real time.
* **It does not open the 24-hour window.** Only their answer does. Until then
  the business has had its one turn.

### 1. The two reply windows

An automated reply is permitted for 24 hours after the person last wrote.
`evaluateSendGate` enforces it (`SOCIAL_WINDOW_CLOSED`) and the constant is
`SOCIAL_REPLY_WINDOW_HOURS`, asserted equal to the transport's
`META_MESSAGING_WINDOW_HOURS` in `tests/meta-flows.test.ts`.

Three properties are deliberate:

* **It is a DENY, not a QUEUE.** Waiting cannot help — the window only ever
  shuts further, and nothing this product does reopens it. Only the person can,
  by writing again.
* **Nothing the business sends extends it.** `withinSocialReplyWindow` takes
  `lastInboundAt` and not the outbound timestamp, so the mistake is unavailable.
* **It denies above the SUGGEST_ONLY branch.** Drafting an automated reply for a
  person to rubber-stamp would be using the human-agent allowance to deliver
  machine output, which misrepresents to Meta what the message is.

A **person**, however, gets seven days, via Meta's human-agent tag — it exists so
somebody who has to go and look something up is not locked out. So the inbox
composer stays usable after the agent has stopped, with the difference stated
plainly (`ReplyWindow.HUMAN_ONLY`), rather than being greyed out at 24 hours and
having customers abandon threads they could still rescue. Two bounds, two legal
bases, two separate functions — `withinMetaMessagingWindow` and
`withinHumanAgentWindow`. A shared helper with a boolean flag is exactly how the
automated path ends up borrowing the human one.

### 2. The address belongs to the thread, not the lead

`leadContact` returns **null** for a platform channel, on purpose. A page-scoped
id has nowhere to live on `leads`, the same person can hold a Messenger thread
and an Instagram one, and falling back to the phone number would send an SMS to
somebody who only ever wrote on Instagram — or to a different person entirely.

The address is `conversations.external_thread_id`, prefixed by platform
(`meta_psid:` / `meta_igsid:`). `assembleContext` resolves it for social
channels; `send-store.ts` re-reads it fresh at dispatch.

Suppression is filed under `PolicyChannel.SOCIAL` against the `social` column,
never coerced into `phone`. `normalisePhone("meta_igsid:17841…")` would return a
plausible-looking E.164 string that matches nothing, so a suppression written
that way would silently never fire again.

### 3. Where a lead comes from

A first inbound DM **creates a Lead**, because opening a conversation with a
business is asking to be answered — the same act as submitting a lead form. A
comment or a like is not, and `engagement-ingest` sends those to a human as
Prospects instead.

Where a Prospect already exists for that platform id — we found them, and the
assisted queue followed and messaged them — the reply **promotes** it rather
than creating a rival record, and the name we already knew travels with it.

`resolveSocialThread` is idempotent on the thread address, which is what makes
it safe under Meta's retry policy: a redelivered first message finds the
conversation the first delivery created.

### What is and is not autonomous

**Autonomous on Meta.** Answering a DM, and sending the one private reply to a
commenter. Both go out through Meta's own messaging API under permissions the
customer granted, so no person is required at any point.

**Not autonomous, anywhere.** Following an account. Meta publishes no API for a
Page to follow a person, and doing it another way — driving a logged-in session —
breaches the Platform Terms and gets the customer's account restricted. There is
no version of this the product will ship.

**Assisted on LinkedIn and TikTok.** Neither offers a private-reply equivalent,
and neither exposes an inbox to read. The connection request, the follow and the
opening message are composed and paced here and performed by a person
(`ASSISTED` mode in `outreach/social-outreach.ts`); replies are recorded rather
than synced. `PARTNER_API` mode exists for workspaces holding a compliant
integration and takes the identical path through every check above.

### Meta's own conduct rules for automation

Two obligations the platform places on an automated conversation, both already
met and both worth knowing about before changing the prompt:

* **Disclose that it is automated.** Enforced in `validate.ts` — a reply that
  denies being automated is rejected and re-drafted.
* **Respond within 30 seconds.** This is why inbound DMs arrive by webhook and
  the turn runs off the request path. The old polling sweep could not have met
  it under any configuration.

## Memory

Four layers, and no free-form long-term memory:

1. **Turn context** — last 8 messages verbatim
2. **Rolling summary** — `conversation_summaries`, compressed beyond that
3. **Structured lead** — the lead row and qualification answers
4. **Workspace config** — settings, services, booking

The structured half of a summary (opt-out, booking, handover, qualification,
key answers) is written by the runtime from database state, not by the model,
so a compression pass cannot lose the facts that matter. Summaries refresh
once per window of new messages, not every turn.

**Opportunity memory** (0131, `src/lib/opportunities/memory.ts`) sits beside
the structured lead: one small jsonb per opportunity holding goals, pains,
requirements, objections, budget signals, timeframe, people involved,
commitments the business made, open questions and the next action. It is
derived deterministically from answers, the lead's and the business's own
messages and the summary, refreshed every turn, and rendered into the
volatile context in under 600 characters. The model never writes it.

## Workspace selling preferences

Settings -> AI & selling stores five preferences the runtime now reads
(`workspace_sales_overrides` ARCHETYPE_SETTINGS '*'):

| Setting | Effect |
|---|---|
| Qualification depth | LIGHT asks only what fills the motion's decision threshold; STANDARD stops at the threshold; THOROUGH asks every applicable question. Required questions are always asked. |
| Preferred methods | Bias the method router, only within `eligibleMethods` (MEDDPICC only on ENTERPRISE; insight-led only with an approved claim). Method names never reach the prompt. |
| Research depth | Moves the tier ceiling of research tasks only (LIGHT cheapest; DEEP one tier up if every budget and the value rule allow). |
| Risk tolerance | Can only raise the clarify floor: CAUTIOUS asks the lead to clarify any reply read below ACT (0.85). BALANCED (the default) and ASSERTIVE keep the 0.6 floor; nothing lowers it. Confidence alone never hands over. |
| Example messages | Tone examples in the offer card, labelled "not facts", dropped first under its budget. |

The method router also receives the relationship's real direction
(`leadDirection`: a promoted prospect, a sourcing-run lead or FOUND_BY_US is
OUTBOUND) and the number of people involved from opportunity memory.

## Observability

**Customers** see outcomes: assistant replied, reply drafted for review,
qualification updated, booking options sent, passed to the team. They never see
prompts, tool arguments, reasoning or provider detail.

**Platform admin** sees `conversation_agent_runs` — trigger, mode, outcome,
latency, tokens, cost, error code, tools used and refused.

Tokens and cost on a run are the sum of the model calls made for it, added by
`runTask` whenever it is given `agentRunId` (via `add_agent_run_usage`, which
increments rather than overwrites, so a run with several calls accumulates):

- `input_tokens`, `output_tokens` — the provider's prompt and completion counts
  (prompt already includes any cached prefix).
- `estimated_cost_usd` — the cost `recordAiUsage` priced for each call.
- `model_provider`, `model_name` — the last call's (`azure_openai`, `nano` or
  `mini`).

The calls that carry the run id are the `agent_decision` call (and its single
retry after a validation failure) and the rolling `conversation_summary`
refresh made during the same turn. Each also writes its own `ai_runs` row and
a token-ledger row linked to the run. A call that never reached the provider
(AI off, no tokens, transport error) adds nothing, so a run with zero tokens
made no billable call. Model calls outside a conversation turn — answer
extraction and restyling in the deterministic inbound path, campaigns, Find
Leads, Copilot — are not agent runs and are metered only in `ai_runs` and the
token ledger.

Every call's token debit is keyed so a retried job is charged once: the
decision call on `agent:<run id>:first|retry`, the summary on the conversation
plus the last message of the window being compressed.

`conversation_agent_runs` and `agent_handoffs` are member-readable via RLS
(they carry no internals). `conversation_agent_actions`,
`conversation_agent_extractions` and `conversation_summaries` are server-only:
RLS on, no policies.

**No chain-of-thought is stored anywhere, because none is ever requested.**
`reasoning_code` is a single auditable token like
`USER_EXPLICITLY_REQUESTED_BOOKING`.

Skipped runs are recorded too — "why did the assistant not reply to this" is
answerable without re-running anything.

## Prompt injection

Lead text is untrusted content. It is never interpolated into a labelled
policy field; it arrives wrapped by `wrapUntrustedContent()` inside the user
message, with system policy assembled separately in `prompts.ts`.

Injection probes are detected and recorded on the run for audit, but they do
**not** change handling — the message is processed as the ordinary enquiry it
is. Even a perfectly persuasive injection reaches a model whose entire output
is a fixed JSON schema, every field of which is re-validated before use.

## Turning it on

Settings → Workspace → **AI assistant**. Four controls:

- **Mode** — Off (default) / Suggest replies / Reply automatically
- **Channels** — SMS, WhatsApp, Email (only those actually connected)
- **When to involve a person** — an opt-in to hand over on qualification
  review (off by default: a REVIEW is flagged and the assistant carries on);
  whether to answer service questions at all
- **Tone**, and an optional extra handover rule

`SUGGEST_ONLY` writes a real `DRAFT` message row that the send worker never
claims, and notifies the workspace. Nothing escapes review.

The agent is additionally gated by `business_settings.ai_assist_enabled` and
the plan's AI entitlement — turning AI assist off writes `agent_mode = 'OFF'`
in the same operation, so there is never a live actor with its master switch
off.

## The checkout loop: tracked links, payment, thank-you, nudges

Direct close (the `PROPOSE_CHECKOUT` action) no longer ends at "link sent".
The loop is in `src/lib/payments/`, migration 0143 (not applied until the owner
applies it; until then links go out untracked, exactly as before).

**1. The link is tracked before it is composed.** `proposeTheCheckout` passes
the gate, then `trackCheckoutLink` adds one query parameter carrying an opaque
token (`client_reference_id` on Stripe Payment Links, `ct_ref` or the link's own
parameter elsewhere). The token is HMAC-derived from the send key, so a retried
turn (whose message the send key dedupes) records the token the lead actually
received. `composeValidated` checks the exact text that goes out: the model's
words plus the tracked URL. The validator admits it only when the base is an
approved link allowed on this turn and the one difference is that link's
tracking parameter with a well-formed token; any other added parameter is
`UNAPPROVED_LINK`, and the price check still ties any price to that link's
`price_text`. `proposeCheckout` then writes the `checkout_attempts` row and
queues the first `checkout.nudge` check.

**2. Payment arrives from outside the conversation.** The customer's own Stripe
account or a signed order-paid webhook (docs/DEVELOPER_PLATFORM.md, "Payment
confirmation") queues `payment.confirm`. A token match is applied; an
email-only match waits for a person (REVIEW). Applying marks the attempt PAID,
closes the opportunity WON with the amount (MRR for a subscription) through
`closeOpportunity`, stops the lead's automation and queues the thank-you.

**The model never says a payment happened.** `PURCHASE_CLAIM` still binds every
model draft. The thank-you is deterministic (`thankYouMessage`): its facts are
ones the runtime holds, and its next steps are the workspace's own words (the
link's **Next steps after payment** text) or a generic line that promises no
time. It is queued as `system` origin with a `payment-thanks:<payment id>` send
key; the send guard lets exactly that through WON, BOOKED, a reply and the
paused flag, and nothing else. Opt-out, suppression, human takeover, channel
health, quiet hours and the policy gate still bind it.

**3. Abandoned checkout.** `checkout.nudge` (one job per nudge, at its due
time) re-reads the attempt, the lead, any payment under review and the
settings (Selling: direct close → Follow up abandoned checkouts: default on,
first after 24h, at most 2, 48h apart). `nudgeDecision` stops on payment first
(a PAID attempt, or any payment for the lead still waiting for a person), then
a closed, opted-out, archived, taken-over or paused lead, then the settings. A
due nudge marks the attempt ABANDONED and queues ONE `FOLLOW_UP_DUE` agent turn
carrying the attempt (`payments/nudge-event.ts`). The orchestrator's
`nudgeTheCheckout` branch re-reads the attempt, adds the nudge guidance
(objection handling in one sentence, no pressure, the approved price text only)
to the strategy block, asks the model, validates with the same tracked link and
queues it (email as MARKETING, with the unsubscribe link). A reminder that
cannot be composed safely is skipped, not handed over. The run gate, the
"paused" rule for non-reply triggers and the send guard apply as to any
outbound turn; a payment in between makes the lead WON, which the guard
refuses to message. Channel: an engaged lead hears on the channel the link went
out on; an unengaged one by email, SMS only when affordable under the channel
budget (`follow-up/channel-strategy.ts`). An unpaid attempt EXPIRES a week after
its last nudge; a later payment still counts.

## Quotes: the assistant quotes, and the numbers are never its own

Brief §7, §13-14, §53, §72-74 (2026-09-27). The pure decisions are in
`agent/quote-flow.ts`, the turn's reads in `agent/quote-turn.ts`, the tools in
`agent/tools.ts` and the branch in `orchestrator.ts` (`quoteTheLead`). Quote
follow-up is `quotes/follow-up.ts`; the locks are `commercial/locks.ts`.
Migration **0160** (not applied until the owner applies it; see below).

**Every figure comes from the quote core.** The only source of a price, total,
VAT amount, deposit or discount the assistant may state is a
`calculate_quote` result or the current quote revision, formatted exactly as
the quote document shows it (`quoteFigures`). The strategy line hands the
model those figures verbatim ("Figures you may state, exactly as written:
£1,440.00 (total including VAT), ..."), and the validator rejects any other
money amount, any VAT statement the quote does not support, and any
delivery, start or completion promise. A model that states nothing is fine;
a model that invents a figure is regenerated, then replaced by deterministic
wording built from the same figures (`quoteFallbackText`).

### The path: one move per turn

| Step | When | What happens |
|---|---|---|
| `COLLECT` | The lead asked for a quote or price for catalogue items it names (or the turn's offer has exactly one sellable item), and an input is missing | One question: quantity (for per-unit items), then options (items with options), then timing. A fact the engine already holds (TEAM_SIZE, VOLUME, TIMING) or something the lead already wrote is never asked; an input is asked at most twice. The question is the turn's one question (question QA is skipped for this step because the quote path owns it) |
| `DRAFT` | Nothing left to ask | `calculate_quote`, then `draft_quote` (idempotent on the conversation plus the message that asked). The policy decides approval; then `request_quote_approval`, or `send_quote` where permitted, or a person sends it (`QUOTE_REVIEW` assist) |
| `SEND` | A quote a person approved, and "Send quotes" is on | `send_quote` |
| `ANSWER_FROM_QUOTE` | The lead has a sent or viewed quote and asks about it | The reply answers from the quote's figures only; anything the quote does not say, a colleague confirms |
| `DISCOUNT` | The lead asks for a lower price, or objects on price, with a live quote | `planConcession` + `propose_discount` (below) |
| `AWAITING_APPROVAL` | The quote waits for a person | An honest "a colleague is checking it", no figure, no time |
| `NEXT_STEP` | Accepted, signed or deposit paid | The signature or payment step on their quote page (only with "Ask for a signature" / "Send payment links" on; otherwise a colleague follows up) |
| `DEFERRED` | Several interests, and the quote is for an offer this turn is not about | One line: it will come back to that; the coordinator's move goes ahead |
| `NOT_PERMITTED` | A quote would be the move but the assistant may not make it | The ordinary price handling: a colleague confirms the price (`CONFIRM_PRICE`) |

**Closing by quote.** An offer whose pricing model is `QUOTE`, with a sellable
catalogue item, closes with the quote: when the engine reaches its close
(CTA_BOOK or CTA_CHECKOUT) the quote path takes the turn instead
(`quoteIsTheClose`). It still needs "Draft quotes" on.

**Several interests.** The quote is for the coordinator's primary interest;
another offer's quote is deferred to a later turn. One question per reply
still holds.

### The tools

All five go through the service registry as caller `AGENT`
(`AGENT_QUOTE_OPERATIONS`), never a separate implementation, after
`quoteToolGate`: the AI switched on, `can(businessId, "quote_ai_enabled")`,
and the workspace's own permission for that tool. A refusal is written to
`conversation_agent_actions` as `DENIED_PERMISSION`.

| Tool | Operation | Needs | Idempotent on |
|---|---|---|---|
| `calculate_quote` | `quote.calculate` (READ) | Draft quotes | nothing written |
| `draft_quote` | `quote.create` | Draft quotes | `agent:<conversation>:<message that asked>` -> `quotes.request_key` |
| `request_quote_approval` | `quote.submit_for_approval` | Draft quotes | one per quote revision (`commercial_action_claims`) |
| `send_quote` | `quote.send` (EXTERNAL) | Send quotes | one per revision; the SEND transition's action key |
| `propose_discount` | `quote.apply_discount` | Offer discounts | one per revision and percentage |

`quote.send` is EXTERNAL, so it needs a person's confirmation. The agent
supplies it only for this one operation, and only when the owner turned
"Send quotes" on: that setting is the standing confirmation, and the audit
row records `confirmation_source: standing_permission`. With it off, a
person sends the drafted quote.

### Discounts: the policy decides, never the model

`quote.apply_discount` (new, AGENT only) takes a whole-quote percentage. The
quote core decides with `approvalVerdict` and the assistant's policy
(`discount-policy.ts aiDiscountPolicy`: the owner's AI limits, plus the
workspace's quote approval rules and margin floor), on the full calculation,
cost included, which the assistant never sees:

| Outcome | What happens | What the lead hears |
|---|---|---|
| `ALLOW` | A new revision with the discount (a sent quote's old link stops working), sent where permitted | The discount and the new total, from the new calculation |
| `REQUIRE_APPROVAL` | The discounted revision is stored needing approval; approval is requested; `QUOTE_REVIEW` assist | Honestly, that the team is looking at it. No figure, no promise |
| `DENY` | Nothing changes | The price held politely with objection craft: acknowledge, ask what is driving it or reframe with value, one small next step |

What the assistant proposes: the lead's own figure when they named one,
otherwise the first concession. Above the limits it counters with the most
the policy allows when that is allowed ("I can't do 20%, the most I can do
is 5%"); a second concession always goes to a person (the two-step rule,
`TWO_STEP_ESCALATION`). `ONLY_AFTER_OBJECTION` means a bare "any discount?"
is held and a price objection ("it's over our budget") may be conceded;
`PROACTIVE` may concede on the bare ask. The legacy chat discount rule
(`discountGuidance`, the insist-then-hand-over) does not apply on a quote
discount turn: the policy's approval replaces the hand-over.

### What the AI may do (commercial authority v2)

Settings -> AI & selling -> **What the AI may do** (owner/admin; stored in
`commercial_authority.ai_permissions` and `ai_discount_policy`, 0160; read
defensively by `ai-permissions.ts`). Least privilege: only qualify and book
start on.

| Permission | Default | Enforced by |
|---|---|---|
| Qualify leads | on | Always on while the assistant is on (turn the assistant off to stop it) |
| Book meetings | on | `create_booking`, `send_booking_link` (refused, `DENIED_PERMISSION`, when off) |
| Phone leads | off | Voice calling reads it (its own settings) |
| Draft quotes | off | `calculate_quote`, `draft_quote`, `request_quote_approval` |
| Send quotes | off | `send_quote`; needs Draft quotes |
| Offer discounts | off | `propose_discount`; needs Draft quotes; with its limits below |
| Ask for a signature | off | The step after acceptance; needs Send quotes |
| Raise invoices | off | Invoicing reads it; the assistant has no invoice tool |
| Send payment links | off | The payment step after signing; needs Send quotes |
| Mark deals won | off | The assistant has no such tool: payment confirmation marks a deal won |
| Transfer live calls to a person | off | Voice calling reads it |

Discount limits (shown only with Offer discounts on; the rest behind "More
limits"): when it may offer one (only after a price objection, or
unprompted), the most it may take off in percent and in pounds, the first
concession, the lowest margin kept, approval above a percentage, an amount
off or a quote value, and who approves (an owner or admin, or the owner).
`quote_ai_enabled` (`can()`) gates every quote tool on top, server-side.

### Follow-up after the quote (§72)

The quote-P2 `quote.nudge` job is still the one reminder job; `quoteNudgeDecision`
decides each run, and every touch asks `checkAutomatedTouchAllowed` (loop
`quote_follow_up`) and the send gate:

| Situation | What happens |
|---|---|
| Sent, not viewed after 3 days | A reminder |
| Viewed | No "have you seen it" reminder; the next one is the expiry reminder |
| Viewed 3 or more times (all its links) | A HIGH buying-intent signal, `QUOTE_VIEWED_REPEATEDLY` (behavioural, strength 0.85), once per revision |
| Viewed, and the lead asks a question | The agent answers from the quote (`ANSWER_FROM_QUOTE`) |
| 2 days before expiry | A reminder (none within 12 hours of expiry) |
| The lead replied since it was sent | No reminder: the conversation is live |
| Expired | The re-engagement route: `QUOTE_EXPIRED` a week later (`reengagement/triggers.ts`), with the usual stop conditions; the agent writes it where it can ("their quote expired on ..."), else fixed copy with no figure |
| Accepted | The signature step; then payment |
| Paid (deposit or in full) | Every sales chase stops at once: follow-up automation off, queued quote reminders, checkout nudges and re-engagement triggers for the lead cancelled (`quotes/chasing.ts`, from the invoicing store's transition) |

### No duplicate commercial actions (§73)

Each commercial row has a UNIQUE idempotency key (one quote per request, one
send per revision, one invoice per schedule row, one payment link per
action, one booking per slot and lead, one voice call per attempt), and a
commercial action takes the lead's lock first. `claim_commercial_action`
(0160) takes `pg_advisory_xact_lock` on the lead's lock id, which is the voice
dial's own (`voiceLeadLockKey`), so a dial and a quote never interleave; it
then checks a short lease naming who is working the lead (the AI 2 minutes,
a person 10, a voice call 30). Another kind of actor is refused while the
lease holds: the assistant leaves the quote to a person who is sending one
(`LEAD_HELD`), a person is asked to wait a minute while the assistant is
mid-action, and a second voice agent is refused. Before 0160 is applied the
claim degrades to the per-row keys alone.

### Migration 0160 (not applied)

`commercial_authority.ai_permissions` / `ai_discount_policy`, the lease and
claim tables with `claim_commercial_action` / `release_commercial_lease`
(service role only, RLS on with no policies, cleared on anonymise), and the
`QUOTE_VIEWED_REPEATEDLY` signal type. Until it is applied every workspace
reads the least-privilege defaults, so no quote tool runs.

### Evidence

* `tests/agent-quotes.test.ts`: the permissions and their defaults, the tool
  gate by permission and capability, the service-registry-only rule, the
  standing confirmation, the policy mapping, the figure-leak test, VAT and
  delivery rules, the token budget, and the discount matrix end to end
  through the quote core with approval.
* `tests/agent-quote-journeys.test.ts`: golden conversations (a quote asked
  for, inputs collected, sent; a discount within limits; one outside limits
  and one refused; a lead who viewed three times), quote follow-up, paid stops
  chasing, expired to re-engagement, and the locks.

## Working with what the assistant did

`src/lib/agent/queries.ts` (reads) and `src/lib/agent/actions.ts` (writes),
surfaced as a strip above the thread in **Inbox**.

Three rules hold across every write:

1. **A person is always the actor.** Each action starts with `requireRole`,
   re-reads the target scoped to that person's workspace, and records who did
   it in the audit log. None of them are reachable by the agent.
2. **Ownership moves explicitly.** The agent may hand a conversation to a
   person; only a person hands it back. There is no timeout that reclaims it,
   because "the human went quiet" and "the human is done" are not the same
   thing.
3. **A draft is a message, not a suggestion blob.** Approving one queues it
   through the ordinary `message.send` pipeline, so the send guard re-checks
   suppression, stop conditions and quiet hours exactly as for any other
   outbound message.

| Object | Operations |
|---|---|
| Handover | read · acknowledge · assign (admin) · resolve (± hand back) · cancel (admin) |
| Suggested reply | read · edit · send · discard |
| Conversation ownership | take over · hand back to the assistant |
| Run history | read (outcomes only) |

Two details worth knowing:

- A discarded draft is kept as `DISCARDED`, not deleted. What the assistant
  proposed and a person declined is the most useful evidence there is for
  judging whether to trust it with more.
- Handing a conversation back is refused outright if the contact has opted
  out, whatever the UI offers.

## Booking: real availability, deterministic confirmation

`src/lib/agent/availability/`

Two providers, one contract. Each returns **busy intervals**, never slots —
slot generation is the pure code in `slots.ts`, so business hours, duration,
buffer and minimum notice apply identically whichever calendar a workspace
uses.

| Provider | How it is asked | Notes |
|---|---|---|
| Google Calendar | `freeBusy` across the selected calendars | Returns opaque busy blocks only: no titles, no attendees. A calendar that errors is never read as "free". |
| Calendly | `event_type_available_times` | Calendly owns its own availability rules, so its answer is authoritative and is not re-filtered through business hours. |

A provider that is missing, unhealthy or erroring returns a **typed failure**,
never an empty list. Empty means "genuinely nothing free", which is a different
answer and earns a different reply:

| Outcome | What the lead gets |
|---|---|
| Slots returned | Up to three real times, spread across the window |
| Empty (calendar answered, nothing free) | Told so plainly; a colleague arranges a time in the background (assist); the AI keeps the conversation |
| Provider failure, booking link configured | The configured booking link |
| Provider failure, no link | A person |

### Timezone correctness

`zonedTimeToUtc` resolves a wall-clock time in the workspace's IANA zone to the
right UTC instant in two passes — the second corrects using the offset actually
in force at the guessed instant, which is what makes the hours either side of a
DST change come out right. Tested against BST/GMT, both sides of a UK
transition, and a zone well off UTC.

### What the model is shown

The model can only offer a time it was handed. When booking is the plan (the
lead asked to book, or the engine's NBA is CTA_BOOK) and a calendar can be
read, the real slots are fetched first and put in front of the model's one
call. When the model asks for availability on a turn where they were not
fetched, the slots are read and the model is asked once more with them in
front of it. The validator still rejects any time that is not one of them.

### Manual booking mode (story H3)

booking_mode `handover` (or a calendar that cannot be read, with no booking
link) has no slots to offer. Owner decision (docs/revenue-engine/00 §6):
ClientTurn holds a PENDING booking for the time the lead asks for, and a person
confirms or declines it.

1. When booking is the next step, the agent asks one fixed question: which day
   and time suits them (no model call).
2. The reply is parsed by rules only (`availability/preferred-time.ts`), in the
   workspace's timezone: exactly one day and one clock time, in the future.
3. A concrete time goes through `create_booking`, whose manual route inserts a
   `pending` row and notifies the team; the lead is told the time is requested
   and someone will confirm it, never that it is booked.
4. Anything ambiguous is asked once more, with an example; a second ambiguous
   answer hands over.

### Confirming a time

`create_booking` is armed only by a slot **this runtime offered on a previous
turn**. The lead's reply is matched by `matchOfferedSlot` — pure string
matching, never a model judgement:

- an explicit time (`"1:30pm"`, `"3pm"`) that matches exactly one offer
- ordinal wording (`"the first one"`, `"second please"`, `"the last one"`)
- a bare number, read as an **hour** when one slot is at that hour — `"3"`
  after offering 1:30pm / 3:00pm / 4:30pm means three o'clock, not the third
  option, which would have been a wrong booking

Anything ambiguous or unrecognised returns null, which becomes a short
clarifying question rather than a booking.

The offer is persisted on the run's `decision_json` and expires after 24 hours,
so a confirmation is matched against exactly the list the lead was shown, and a
day-old offer is re-checked rather than booked from memory.

The confirmation sentence — the one line that must never be wrong — is composed
deterministically from the tool result, not by the model. If the insert fails
the turn hands over (a provider failure); if someone else took the slot, fresh
times are offered; the lead is never told they are booked when they are not. A
meeting booked for an ENTERPRISE or goal-E lead raises a `MEETING_BRIEF` assist,
so the person taking the meeting has the brief: the meeting is the hand-off.

## Paying for it: AI tokens

The assistant runs on a **token allowance**. It is the customer-facing unit —
countable, visible, and toppable-up. What a token costs the platform is not
customer-facing and never appears on any workspace surface; that stays in
`provider_price_book` and `cost_events`, which remain admin-only. The allowance
is the product, the unit cost is the business.

`src/lib/billing/tokens.ts` (pure) · `token-service.ts` (enforcement) ·
`token-actions.ts` (buying) · migration `0024c_ai_token_allowance.sql`

### Included per month

| Plan | Tokens | ≈ assistant replies |
|---|---|---|
| Trial | 100k | ~58 |
| Starter | 1M | ~590 |
| Growth | 4M | ~2,350 |
| Pro | 12M | ~7,050 |
| Enterprise | 40M | ~23,500 |

`plan_entitlements.ai_tokens` is the runtime authority, so changing an
allowance is a row edit rather than a deploy. `AI_TOKEN_ALLOWANCE` in
`tokens.ts` is the seeded default and what the pricing page advertises — a test
fails if the two drift apart.

### Three tables, three questions

| Table | Answers |
|---|---|
| `ai_token_balances` | How much is left right now? (one row per business per period) |
| `ai_token_ledger` | Why? (append-only, every grant, debit and purchase) |
| `ai_token_purchases` | What did they buy? (Stripe top-ups) |

The balance is a materialised convenience; the ledger is the truth, and a
balance can always be rebuilt from it.

### How enforcement behaves

- **Gated before the call, debited after it.** `runTask` estimates the cost and
  checks capacity *before* contacting the provider, so a workspace at its limit
  never spends on a call it cannot pay for. The debit that follows is the true
  token count, not the estimate.
- **Atomic.** The debit happens inside `consume_ai_tokens`, so two workers
  finishing at the same instant cannot both read the same remaining balance and
  both conclude there was room.
- **Idempotent.** Every debit carries a key. The agent keys on its run id, so a
  retried job is charged once; the retry after a validation failure is a
  genuinely second call and carries its own key.
- **Running out degrades, it does not fail.** `runTask` returns
  `skippedReason: "NO_TOKENS"` and the caller falls back to its deterministic
  path. Follow-up sequences, qualification rules and message sending carry on
  exactly as they do for a workspace that never had AI. **Nobody's leads go
  unanswered because of a billing state.**
- **Nothing is billed silently.** There is no overage. A workspace tops up
  deliberately or waits for the period to roll over.

Warnings fire once per threshold (80%, then 95%), watermarked on the balance
row so a workspace is not notified on every call once it is past 80%.

### Buying more

Three packs (£15 / £49 / £129), priced so a bigger pack is always better value
per pound — asserted by a test rather than left to trust. Checkout uses Stripe
`price_data`, so repricing a pack is a change to `tokens.ts` alone.

The split that matters: `token-actions.ts` *starts* a checkout and writes a
PENDING purchase. Only the Stripe webhook ever marks one PAID and credits
tokens — nothing in the app grants an allowance, because nothing in the app has
seen any money. Crediting is idempotent three times over (the webhook inbox
rejects a replayed event id, the purchase row's `credited_at` guards the
credit, and the ledger row is keyed), because a double credit gives real money
away.

Two deliberate asymmetries:

- **Included tokens expire at period end; purchased tokens carry forward.** A
  customer who paid for tokens has not agreed to lose them at a month boundary.
- **A refunded top-up is marked REFUNDED but the tokens are not clawed back.**
  Reversing an allowance someone may already have spent would leave them in a
  negative balance they cannot clear. Support adjusts deliberately if needed.

### Testing top-ups locally

The Stripe CLI needs installing, authenticating and a tunnel. `scripts/stripe-local-event.mjs`
does the same job with nothing but Node: it builds the event, signs it exactly
as Stripe does (`t=<ts>,v1=<hmac-sha256 of "<ts>.<payload>">`) using
`STRIPE_WEBHOOK_SECRET_LOCAL`, and posts it to the route.

```bash
node scripts/stripe-local-event.mjs list                    # find a purchase id
node scripts/stripe-local-event.mjs tokens <purchase_id>    # completed + paid
node scripts/stripe-local-event.mjs tokens-expired <id>     # abandoned checkout
node scripts/stripe-local-event.mjs subscription-created <business_id>
```

`STRIPE_WEBHOOK_SECRET_LOCAL` is a fourth accepted secret alongside snapshot,
thin and legacy, so local testing never means overwriting the deployed test
secret. It is simply unset in production. The script refuses to run against
anything but localhost — it forges valid signatures, so it must never be able
to target a deployed site.

If you do install the Stripe CLI, `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` prints a secret that goes in the same
variable.

### What consumes tokens

Assistant replies, reply interpretation, and conversation summaries — every
call that reaches `runTask`. Deterministic follow-up, the qualification engine,
message sending and the send guard consume none, which is why they keep working
when the allowance is gone.


## Voice: the same agent on a call (P3, 2026-09-28)

A phone call is an execution surface of this agent, not a second one
(docs/VOICE.md §16). Three touch points in this directory:

- **`tools.ts` ToolContext `holder`.** Optional. Absent, the text assistant
  claims the lead's commercial lease as `AI` keyed by the conversation, as
  before. A voice call's tools (`voice/tools/work.ts`) pass
  `{ kind: "VOICE", ref: <call id> }`, so a call and a text turn never act on
  the lead at once (commercial/locks.ts). Every other tool behaviour is
  unchanged: the voice tools reuse `getCalendarAvailability`,
  `createBooking`, `calculateQuoteForLead`, `draftQuote`, `sendQuoteToLead`,
  `proposeCheckout`, `requestHumanHandover` and `applySuppression`, with
  their gates, through `voice_agent.*` service operations as caller AGENT.
- **`orchestrator.ts` `callTheLeadInstead`.** Before a turn is composed, a
  call-only request ("can you give me a call?") is offered to
  `voice/text-to-call.ts`. When the deterministic channel choice
  (`voice/channel-orchestration.ts` rule V1: the owner's "Phone leads"
  permission, entitlement, a buying signal or MEDIUM+ intent, calling hours)
  says CALL, the lead's message is recorded as the CALL_REQUESTED evidence,
  the call is requested through every voice gate, and the turn's one move is
  a fixed line ("... will call you in the next few minutes ..."). Otherwise
  it returns null and the turn goes on exactly as before (bookable call
  times). It never throws.
- **Continuity.** After a call, its summary, agreed step and objections are
  merged into the lead's opportunity memory, and its words go through the
  same QI extractors, so the next text turn continues from the call.

The model on a call never composes a price, discount, availability or area:
it speaks only what a tool returned (resolved conflict 1), exactly as here.

## Schema

`supabase/migrations/0024a_agent_runtime.sql`

- `conversations` → `owner`, `agent_turn_seq`, `agent_locked_until`
- `messages` → `origin = 'agent'`, `status = 'DRAFT'`, `agent_run_id`
- `business_ai_settings` → `agent_mode`, `agent_channels`, two handover flags
- `services` → `pricing_visibility`, `public_price_text`
- New: `conversation_agent_runs`, `conversation_agent_actions`,
  `conversation_agent_extractions`, `conversation_summaries`, `agent_handoffs`
- New RPCs: `claim_agent_turn`, `release_agent_turn`

Named `conversation_agent_*` deliberately: `0032_v4_agents_usage` defines its
own `agent_runs` for the V4 sourcing profiles, which is a different thing with
a different shape. Both can coexist.

`supabase/migrations/0024c_ai_token_allowance.sql` adds `ai_token_balances`,
`ai_token_ledger`, `ai_token_purchases`, the `consume_ai_tokens` /
`credit_ai_tokens` RPCs and the per-tier allowance rows.

All three migrations are applied to the **Client Turn** project
(`losieaikadkadtmezini`).

Background execution: see [CRON.md](CRON.md).
