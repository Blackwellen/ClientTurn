# 12 — Voice provider research, competitors and voice pricing

**Retrieved:** 2026-09-27. Web research only. Every figure below is from an official provider page unless it is marked **secondary** or **unverified**.
**Method caveat:** pages were read through a fetch tool that summarises them. Figures are quoted as the tool returned them, so re-check any value before it is written into `plans.ts` or `unit-costs.ts`.
**FX:** **£0.7546 per $1**. This is the ECB reference-rate cross for **2026-09-25**: EUR/GBP 0.86045 ÷ EUR/USD 1.1403 = 0.75458, which is 1 GBP = $1.3252. `docs/economics.md` A21 uses £0.7549, a difference of 0.04%.

---

## 1. Sources and dates

| # | Source | URL | Retrieved | Status |
|---|---|---|---|---|
| V1 | Retell AI pricing | https://www.retellai.com/pricing | 2026-09-27 | fetched |
| V2 | Retell AI home (capabilities) | https://www.retellai.com/ | 2026-09-27 | fetched |
| V3 | Twilio Voice UK | https://www.twilio.com/en-us/voice/pricing/gb | 2026-09-27 | fetched |
| V4 | Twilio Elastic SIP Trunking UK | https://www.twilio.com/en-us/sip-trunking/pricing/gb | 2026-09-27 | fetched |
| V5 | Twilio phone-number pricing UK | https://www.twilio.com/en-us/phone-numbers/pricing/gb | 2026-09-27 | **HTTP 404** |
| V6 | Twilio UK regulatory guidelines | https://www.twilio.com/en-us/guidelines/gb/regulatory | 2026-09-27 | fetched |
| V7 | Twilio SMS UK | https://www.twilio.com/en-us/sms/pricing/gb | 2026-09-27 | fetched (page says "as of August 2026") |
| V8 | HighLevel AI product pricing | https://help.gohighlevel.com/support/solutions/articles/155000006652-ai-product-pricing | 2026-09-27 | fetched |
| V9 | HighLevel AI Employee overview | https://help.gohighlevel.com/support/solutions/articles/155000003906-ai-employee-overview | 2026-09-27 | fetched |
| V10 | HighLevel LC Phone pricing | https://help.gohighlevel.com/support/solutions/articles/48001223556 | 2026-09-27 | fetched (UK rates are in PDFs that were not read) |
| V11 | HighLevel pricing | https://www.gohighlevel.com/pricing | 2026-09-27 | fetched |
| V12 | HighLevel AI call agents | https://www.gohighlevel.com/ai-call-agents | 2026-09-27 | fetched |
| V13 | Vapi pricing | https://vapi.ai/pricing | 2026-09-27 | fetched |
| V14 | Vapi home and tools docs | https://vapi.ai/ , https://docs.vapi.ai/tools | 2026-09-27 | fetched |
| V15 | ElevenLabs pricing | https://elevenlabs.io/pricing | 2026-09-27 | fetched |
| V16 | ElevenLabs API/Agents pricing | https://elevenlabs.io/pricing/api | 2026-09-27 | fetched |
| V17 | ElevenLabs Agents | https://elevenlabs.io/agents | 2026-09-27 | fetched |
| V18 | Synthflow pricing and home | https://synthflow.ai/pricing , https://synthflow.ai/ | 2026-09-27 | fetched |
| V19 | Respond.io pricing | https://respond.io/pricing | 2026-09-27 | fetched |
| V20 | Stripe UK pricing | https://stripe.com/gb/pricing | 2026-09-27 | fetched |
| V21 | ECB euro reference rates (25 Sep 2026) | https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html | 2026-09-27 | fetched |
| V22 | Ofcom phone numbers and call costs | https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/phone-numbers-and-call-costs | 2026-09-27 | fetched |
| V23 | Lindy / Podium pricing | https://www.lindy.ai/pricing , https://www.podium.com/pricing | 2026-09-27 | fetched |
| S1 | HighLevel fair-use ceiling (about 50k minutes) | https://netpartners.marketing/gohighlevel-voice-ai-conversation-ai-pricing-2026/ | 2026-09-27 | **secondary, search snippet** |
| S2 | Twilio UK RC-bundle dates (27 May 2024 and 30 Sep 2024) | https://www.twilio.com/en-us/changelog/new-kyc-regulation-for-the-uk-long-codes | 2026-09-27 | **secondary, search snippet** |
| S3 | Ofcom 084/087 service-charge bands and 8p–67p access charge | https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/uk-calling | 2026-09-27 | **secondary, search snippet** |
| X | Fed H.10 GBP series | https://www.federalreserve.gov/releases/h10/hist/dat00_uk.htm | 2026-09-27 | **discarded**. It returned about 1.38, with rows dated after today, so the output is not trusted |

---

## 2. Pricing by provider (all prices in USD unless marked £)

### 2.1 Retell AI (V1)
| Item | Value |
|---|---|
| Voice infrastructure | $0.055/min |
| TTS: Retell Platform, Minimax, Fish, Cartesia, OpenAI, Inworld | $0.015/min |
| TTS: ElevenLabs | $0.040/min |
| LLM, standard tier | GPT 4.1 $0.045 · GPT 4.1 mini $0.0128 · GPT 4.1 nano $0.0032 · GPT 5 $0.04 · GPT 5 mini $0.008 · GPT 5 nano $0.0016 · GPT 5.1 $0.04 · GPT 5.2 $0.056 · GPT 5.4 $0.080 · GPT 5.4 mini $0.024 · GPT 5.4 nano $0.0064 · GPT 5.5 $0.16 · GPT 5.6 Terra $0.064 · GPT 5.6 Luna $0.0064 · GPT 6 Astra $0.32 · Claude 5 Sonnet $0.064 · Claude 4.6 Sonnet $0.08 · Claude 4.5 Sonnet $0.08 · Claude 4.5 Haiku $0.025 · Gemini 3.0 Flash $0.016 · 3.1 Flash Lite $0.008 · 3.5 Flash $0.048 · 3.5 Flash Lite $0.0096 · 3.6 Flash $0.024 · 3.7 Flash $0.048 · 3.8 Flash $0.048 (per min) |
| LLM, fast tier | 2 × standard (GPT 5.5 / 5.4 / 5.2 / 5.1 / 5 / 4.1 families) |
| GPT-4o-mini | not listed |
| Telephony via Retell (Twilio/Telnyx) | $0.015/min "varies by country". Custom telephony or SIP: **no Retell charge** |
| Phone number | $2.00/month. Verified number $10.00/month |
| Branded Call ID | $0.10 per outbound call |
| Concurrency | 20 concurrent calls free, then $8.00 per concurrency per month |
| Knowledge base | 10 free, then $8.00 per KB per month |
| Batch call | $0.005/dial |
| Advanced features (denoise, guardrails, PII removal) | $0.005–$0.01/min |
| Trial / minimum | $10 credit. No minimum on PAYG. Enterprise is "custom pricing" |
| AMD / voicemail detection | **unverified** (no line item shown) |

### 2.2 Twilio UK Voice (V3) and Elastic SIP (V4)
| Item | Programmable Voice | Elastic SIP |
|---|---|---|
| Outbound to UK landline | $0.0158/min | $0.0118/min |
| Outbound to UK mobile | $0.0305/min | $0.0265/min |
| Inbound, local | $0.0100/min | $0.0060/min |
| Inbound, mobile | $0.0100/min | $0.0060/min |
| Inbound, toll-free | $0.0798/min | $0.0758/min |
| SIP interface | $0.0040/min | — |
| Number: local | $3.50/month (voice page) | $1.15/month (SIP and SMS pages): **discrepancy** |
| Number: mobile | $2.50/month | $2.50/month |
| Number: toll-free | $2.70/month | $2.70/month |
| Number: national | **unverified** | **unverified** |
| Recording | $0.0025/min, plus storage at $0.0005/min per month | same |
| Transcription | $0.0500/min | — |
| Answering machine detection | $0.0075/call | — |
| Media Streams | $0.0044/min | — |
| ConversationRelay | $0.07/min | — |
| Concurrency | — | unlimited |

**Other Twilio items**
- **Subaccounts:** usage is billed to the parent account. No explicit "free" statement was fetched, so this is **unverified** (though implied).
- **Regulatory requirements (V6):**
  - UK local and national numbers need a valid UK address. Businesses must also give their name, registration details and an authorised representative with a mobile and work email.
  - Mobile and toll-free numbers accept an address anywhere.
  - An approved UK RC bundle has been required for all UK long codes (S2, **secondary**).

### 2.3 HighLevel (V8–V12)
| Item | Value |
|---|---|
| Voice Engine | $0.045/min (from 2026-05-20) |
| TTS | OpenAI $0.015 · Cartesia $0.015 · ElevenLabs V2.5 $0.035 · ElevenLabs V3 $0.170 (per min) |
| LLM tokens, per 1M | Gemini $0.10–$0.30 · OpenAI $0.05–$2.50 · Claude $0.80–$3.00 |
| Speech-to-speech | gemini-3.1-flash-live-preview $0.10/min · gpt-realtime-2/2.1 $0.20/min |
| AI Employee Growth | $50/month per location, includes 100 Voice AI minutes |
| AI Employee Unlimited | $97/month per location, fair use (about 50k min ceiling, S1 **secondary**) |
| LC Phone (US) | out $0.0166/min · in $0.01165/min · local number $1.15/month · recording $0.0025/min · transcription $0.024/min · AMD $0.0075/call · client minutes $0.004/min · Voice AI over SIP +$0.004/min |
| LC Phone (UK) | **unverified** (country PDFs). The page says it matches Twilio |
| Platform plans | Starter $97 · Unlimited $297 · Agency Pro $497 · Enterprise custom |

### 2.4 Vapi (V13)
| Item | Value |
|---|---|
| Hosting fee | $0.05/min (PAYG). Pro: 10% of the hosting fee |
| Pass-through at cost | Deepgram $0.0095–$0.0099 · OpenAI $0.0077–$0.0452 · ElevenLabs $0.0146–$0.0238 (per min) |
| Telephony | Vapi SIP free · Twilio in $0.008 / out $0.014 · Vonage $0.00814 · Telnyx $0.0055 (per min; these look like US rates) |
| Plans | PAYG, $5 credit, 4 concurrent calls · Core $29/month, 10 calls · Pro $999/month minimum, 30 calls · Premier custom |
| Extra concurrency | $10/line/month |

### 2.5 ElevenLabs Agents (V15–V16)
| Plan | $/month | Agent minutes included | Concurrent calls |
|---|---|---|---|
| Starter | 6 | 15 | 4 |
| Creator | 22 (first month 50% off) | 75 | 6 |
| Pro | 99 | 275 | 10 |
| Scale | 299 | 1,238 | 20 |
| Business | 990 | 3,738 | 30 |
| Enterprise | custom | 12,375 | 40 |

- **Additional minutes:** $0.080/min, or $0.160/min at burst.
- **LLM pass-through and telephony:** **unverified**.

### 2.6 Synthflow (V18)
- Only an Enterprise plan is published, **from $30,000/year**, custom-scoped.
- Per-minute, concurrency and telephony prices: **unverified**.

### 2.7 Respond.io (V19)
- **Plans:** Starter $79 · Growth $159 · Advanced $279 per month. Yearly: $948 / $1,908 / $3,348. Enterprise is custom.
- **AI Voice Calls:** on Growth and above. AI usage is "included at no extra cost" there.
- **AI credits:** 5k/10k/20k/40k, then $15 per 1k, capped at 200%.
- **Contacts:** Growth and Advanced include 1,000 MACs, then $12 or $15 per 100.
- **WhatsApp:** Meta fees are separate.
- **Per-minute voice price:** **not published**.

### 2.8 Stripe UK (V20, GBP)
| Item | Value |
|---|---|
| UK standard cards | 1.5% + 20p |
| UK premium cards | 2.8% + 20p |
| EEA cards | 2.5% + 20p |
| International cards | 3.15% + 20p |
| Currency conversion | +2% |
| Billing | PAYG 0.7% of billing volume (or from £450/month on a 1-year contract) |
| Invoicing Starter | 0.4% per paid invoice |
| Tax Basic | 0.5% per transaction (no-code) or £0.40 (API) |
| Tax Complete | from £70/month |
| Dispute | £20 |
| Instant Payouts | 1% (minimum 40p) |

### 2.9 Twilio UK SMS (V7), for context
| Item | Value |
|---|---|
| Outbound, long code | $0.056/message |
| Outbound, alphanumeric sender | $0.056/message |
| Outbound, short code | $0.0524/message |
| Inbound | $0.0075/message |
| Failed-message fee | $0.001 |
| Carrier fees | "may apply", amount unstated |

---

## 3. Competitor capability matrix

**Key.** Y = stated on the official page. "—" = not stated, so **unverified**. "Voice $" is the raw price. "Tel sep." means telephony is billed separately. Prices in USD.

| Vendor | Voice / Voice $ / Tel sep. | Minutes and model | Qualify | Objections | Booking | Quote | Close / payment | Lead sourcing | Cross-channel | Analytics | Usage rebilling | Agent tools |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **HighLevel** | Y / $0.045 + TTS + LLM / **Y** (LC Phone at Twilio parity) | PAYG, or $50 (100 min), or $97 unlimited (fair use) per location, on top of the $97–$497 platform | Y | — | Y (native calendars) | — | Y: Payments and Invoicing in the platform. In-call payment — | — | Y: SMS, email, calls, WhatsApp add-on, social, chat | Y | **Y** (Unlimited: rebilling; Agency Pro: SaaS mode) | Y: workflows, transfer, CRM update |
| **Respond.io** | Y / **unpublished** / WhatsApp calls billed by Meta; others — | Seats + MAC + AI credits, $79–$279 | Y | — | — | — | — | — | **Y**: WhatsApp, SMS, email, Messenger, IG, TikTok, calls | Y | — | Y: workflows, HubSpot/Salesforce, API, webhooks (Advanced) |
| **Retell** | Y / $0.055 + TTS + LLM / **Y** (or free own SIP) | Pure PAYG. 20 concurrent calls free | by configuration | — | Y | — | — | — | Voice, chat, SMS | Y: post-call analysis, QA, A/B | — | Y: functions, webhooks, transfer, IVR, batch, KB |
| **Vapi** | Y / $0.05 + providers at cost / **Y** | PAYG; $29; $999 minimum | Y (use case) | — | Y (use case) | — | — (PCI claim only) | — | Voice + SMS tool | — | — | Y: transfer, end, SMS, DTMF, API, function, MCP |
| **ElevenLabs** | Y / $0.08 (burst $0.16) / **unverified** | Minutes bundled in credit plans, $6–$990 | Y | — | via tools | — | Stripe integration mentioned | — | Y: phone, web, WhatsApp, SMS, email, chat | Y | — | Y: MCP, API, webhooks, any LLM |
| **Synthflow** | Y / unpublished / own carrier | Enterprise from $30k/year | Y | — | Y | — | — | — | Y: voice, chat, SMS | Y: Auto-QA | Y: white-label | Y: 200+ integrations |
| HubSpot Sales Hub | calling exists (from memory, **unverified**) | per seat (economics.md A19) | — | — | — | — | — | — | — | — | — | — |
| Instantly / Smartlead | **no voice** (email tools, economics.md A20/A22) | email volume | — | — | — | — | — | Y (lead credits, Instantly) | email only | — | — | — |
| Lindy | voice not listed (V23) | credits per user | — | — | "meeting scheduling" | — | — | — | — | — | — | Y: 40+ skills |
| Podium | calls in the inbox; AI voice **unverified** | no public price | — | — | "schedules" | — | — | — | Y | — | — | — |
| Artisan, 11x | **unverified** | no public price | — | — | — | — | — | — | — | — | — | — |

- No vendor's official page claims AI objection handling, binding quotes or taking payment inside a call.
- ClientTurn's rule that AI never composes a quote (CLAUDE.md, Resolved conflict 1) is therefore not a competitive gap.

---

## 4. Twilio UK outbound destinations (USD/min, V3 and V4)

| Twilio route | Programmable Voice | SIP termination |
|---|---|---|
| United Kingdom (geographic) | 0.0158 | 0.0118 |
| UK Mobile | 0.0305 | 0.0265 |
| From Surcharged Zone 1/2 | 0.2293 | 0.2253 |
| Mobile, from Surcharged Zone 1/2 | 0.4730 | 0.4690 |
| Mobile Other | 0.3200 | 0.3160 |
| Personal | 0.5577 | 0.5537 |
| Special Services | 0.2625 | 0.2585 |
| Special Services Other | 0.0368 | 0.0328 |
| Special Services Other, surcharged | 0.4200 | 0.4160 |
| Premium Services | 1.0479 | 1.0439 |
| Toll-free | 0.0798 | — |

**Ofcom number ranges (V22; S3 secondary)**

| Range | Type |
|---|---|
| 01/02 | Geographic |
| 03 | Same price as 01/02 |
| 07 | Mobile |
| 070 | Personal |
| 076 | Pager |
| 080 | Freephone |
| 084, 087, 09, 118 | Access charge (8p–67p/min, consumer) plus a service charge: 084 is 0–7p/min, 087 is 0–13p/min, 09/118 are capped separately |

Twilio publishes **no prefix-to-route map**. Which prefixes land in "Special Services", "Surcharged" or "Mobile Other" is **unverified**.

**Recommendation for the dialler and send gate.** Normalise to E.164 first, then apply these rules.

- **Allow:** `+441…`, `+442…`, `+443…`, and `+447…` except `+4470` and `+4476`.
- **Block unless a price row exists:**
  - `+4470` (personal, $0.5577)
  - `+4476` (pager)
  - `+44500`, `+4455`, `+4456`
  - `+4484`, `+4487` (service charge)
  - `+449` (premium, $1.0479)
  - `+44118`
  - `+44800` and `+44808` for outbound. They are free to the caller, but Twilio bills $0.0798 and they are not lead mobiles.
  - every non-UK destination.
- **Per-call rate cap: $0.04/min.** Refuse any call whose looked-up Twilio price exceeds it.
  - Why $0.04: it sits above UK mobile ($0.0305) and "Special Services Other" ($0.0368), and below every surcharged route ($0.2253 and up).
  - The cap also catches `+447` numbers that Twilio prices as "Mobile Other" ($0.32), which a prefix rule cannot see.
  - As a backstop, set a per-call maximum duration, for example 15 minutes, so a runaway call costs at most 15 × $0.0305 = $0.46.

---

## 5. Blended cost per minute and sensitivity

**Common assumptions**
- **Destination mix:** 80% UK mobile, 20% landline, via Twilio Elastic SIP. CLAUDE.md rule 6 means voice goes only to mobiles the person submitted themselves; the landline share covers office numbers they give instead.
  - Tel = 0.8 × 0.0265 + 0.2 × 0.0118 = **$0.02356/min**
- **Recording:** Rec = **$0.0025/min**
- **Retell telephony:** $0 when Twilio SIP is brought in (V1).
- **Formulas:**
  - COGS£ = COGS$ × 0.7546
  - FX +10% and provider +10% each multiply COGS by 1.10, because every line is in USD.
  - Both together multiply COGS by **1.10 × 1.10 = 1.21**.

| Stack | Formula ($/min) | $/min | £/min base | £ FX +10% | £ provider +10% | £ both (×1.21) |
|---|---|---|---|---|---|---|
| **A**: Retell + Twilio SIP, Cartesia/OpenAI TTS, GPT-4.1 mini | 0.055 + 0.015 + 0.0128 + Tel + Rec | 0.10886 | **0.0821** | 0.0904 | 0.0904 | **0.0994** |
| **A2**: Retell + SIP, ElevenLabs TTS, GPT-4.1 | 0.055 + 0.040 + 0.045 + Tel + Rec | 0.16606 | **0.1253** | 0.1378 | 0.1378 | **0.1516** |
| B: Vapi PAYG + SIP, low provider bounds | 0.05 + 0.0099 + 0.0077 + 0.0146 + Tel + Rec | 0.10836 | 0.0817 | 0.0899 | 0.0899 | 0.0988 |
| B2: Vapi PAYG + SIP, high provider bounds | 0.05 + 0.0099 + 0.0452 + 0.0238 + Tel + Rec | 0.15496 | 0.1169 | 0.1286 | 0.1286 | 0.1415 |
| C: ElevenLabs overage + SIP (**LLM excluded, unverified**) | 0.08 + Tel + Rec | 0.10606 | 0.0800 | 0.0880 | 0.0880 | 0.0968 |
| D: HighLevel engine + OpenAI TTS + LC mobile at Twilio parity (**LLM excluded**) | 0.045 + 0.015 + 0.0305 | 0.0905 | 0.0683 | 0.0751 | 0.0751 | 0.0826 |

**Fixed costs, not in the per-minute figures**
- **Dedicated number:** N = $2.50 × 0.7546 = **£1.887/month** (Twilio UK mobile), or £2.283 at ×1.21.
- **Concurrency:** Retell $8/month per concurrent call beyond 20.
- **Branded Call ID:** $0.10/call if used.

---

## 6. Minute scenarios (Stack A, one dedicated number included)

**Formula:** Cost£ = M × 0.0821 + 1.887. Under stress: M × 0.0994 + 2.283, i.e. the ×1.21 factor applied to both terms.

| Scenario | Minutes (M) | Base £ | FX or provider +10% £ | Both (×1.21) £ |
|---|---|---|---|---|
| Light | 50–150 | 5.99–14.21 | 6.59–15.63 | 7.25–17.19 |
| Normal | 150–500 | 14.21–42.96 | 15.63–47.25 | 17.19–51.98 |
| Heavy | 500–1,500 | 42.96–125.10 | 47.25–137.61 | 51.98–151.37 |
| Very heavy | 1,500–3,000 | 125.10–248.32 | 137.61–273.15 | 151.37–300.46 |
| Very heavy+ (5,000 shown) | 5,000 | 412.61 | 453.87 | 499.25 |

- **Stack A2:** multiply the minute term by 0.1253 ÷ 0.0821 = 1.53. At 3,000 minutes that is 3,000 × 0.1253 + 1.887 = £377.8 base, or £457.1 stressed.
- **Plan fit:** at Pro (£399/month, `docs/economics.md`) very heavy voice use would consume most of the plan price. Voice must be sold as metered packages (§8), never as "unlimited".

---

## 7. Price from target gross margin

**Formula:** Price = COGS ÷ (1 − GM).

**Stress test at a fixed price:** GM_stress = 1 − 1.21 × COGS_base ÷ Price.
- If the price was set for margin g at base, the stressed margin is 1 − 1.21 × (1 − g). This does not depend on the stack.

| Target GM at base | Stack A £/min at base COGS | Stack A £/min at stressed COGS | Stack A2 £/min at base COGS | Stack A2 £/min at stressed COGS | GM if priced at base, then stressed |
|---|---|---|---|---|---|
| 75% | 0.0821 ÷ 0.25 = **0.3286** | 0.0994 ÷ 0.25 = 0.3976 | 0.1253 ÷ 0.25 = **0.5012** | 0.1516 ÷ 0.25 = 0.6065 | 1 − 1.21 × 0.25 = **69.8%** |
| 77% | 0.0821 ÷ 0.23 = **0.3571** | 0.0994 ÷ 0.23 = 0.4321 | 0.1253 ÷ 0.23 = **0.5448** | 0.1516 ÷ 0.23 = 0.6592 | 1 − 1.21 × 0.23 = **72.2%** |
| 80% | 0.0821 ÷ 0.20 = **0.4107** | 0.0994 ÷ 0.20 = 0.4970 | 0.1253 ÷ 0.20 = **0.6265** | 0.1516 ÷ 0.20 = 0.7581 | 1 − 1.21 × 0.20 = **75.8%** |

**Conclusion.** Only a retail price set at **80% GM at base** still clears the 75% margin rule under the combined FX and provider stress (75.8%). At 75% or 77% base, the same stress pulls margin below 75%. Stripe fees (§8) cost about a further 1.6–2.4 points.

---

## 8. Draft packages and a dedicated-number price

**Assumptions for packages**
- Stack A is the standard voice. Worst case, every minute bought is used.
- Each package is a one-off Stripe payment on a UK standard card: fee = 0.015 × P + £0.20.
- If sold through Stripe Billing instead, add 0.7% × P. That lowers every GM below by 0.7 points.

**Formula:** GM = (P − M × c − (0.015 × P + 0.20)) ÷ P, where c = £0.0821 at base or £0.0994 under stress.

| Package | Price P | £/min | Stripe fee | COGS A base / stress | **GM A base** | **GM A stress** | COGS A2 base / stress | GM A2 base | GM A2 stress |
|---|---|---|---|---|---|---|---|---|---|
| 100 min | £49 | 0.490 | £0.94 | £8.21 / £9.94 | **81.3%** | **77.8%** | £12.53 / £15.16 | 72.5% | 67.1% |
| 250 min | £115 | 0.460 | £1.92 | £20.54 / £24.85 | **80.5%** | **76.7%** | £31.33 / £37.91 | 71.1% | 65.4% |
| 500 min | £225 | 0.450 | £3.58 | £41.07 / £49.70 | **80.2%** | **76.3%** | £62.65 / £75.81 | 70.6% | 64.7% |
| 1,000 min | £449 | 0.449 | £6.93 | £82.14 / £99.39 | **80.2%** | **76.3%** | £125.31 / £151.62 | 70.5% | 64.7% |

**Why these prices.** For each package, the lower bound is the larger of two prices:
- the price that holds 80% at base: (M × 0.0821 + 0.20) ÷ (0.80 − 0.015);
- the price that holds 75% under stress: (M × 0.0994 + 0.20) ÷ (0.75 − 0.015).

Those floors are:

| Package | 80% at base | 75% under stress |
|---|---|---|
| 100 min | £45.48 | £43.15 |
| 250 min | £112.09 | £106.59 |
| 500 min | £223.09 | £212.33 |
| 1,000 min | £445.10 | £423.80 |

The prices above round up from these floors.

**Premium voice (Stack A2) cannot share these prices:** it falls to about 65% under stress.
- Sell it as a **+£0.20/min premium-voice surcharge** on top of the package rate.
- Check at 1,000 min: P = 449 + 200 = £649. GM stress = (649 − 151.62 − (0.015 × 649 + 0.20)) ÷ 649 = **75.1%**.
- Alternatively, restrict it to the 250+ packages at the same surcharge.

**Dedicated UK number (monthly)**
- **Formula:** GM = (P − N − (0.015 × P + 0.20)) ÷ P, with N = £1.887 at base or £2.283 under stress.
- This is the worst case, where the number is charged as its own card payment. As a line on the existing subscription invoice the 20p is not charged again; that alternative is the last column below.

| Price | Stripe fee | GM base | GM stress | GM stress (invoice line, no 20p) |
|---|---|---|---|---|
| £9.99 | £0.35 | 77.6% | **73.6%** | 75.7% |
| £10.99 | £0.36 | 79.5% | 75.9% | 77.7% |
| **£11.99** | £0.38 | **81.1%** | **77.8%** | 79.5% |
| £12.99 | £0.39 | 82.4% | 79.4% | 80.9% |

- £9.99 fails the 75% rule under stress when charged on its own.
- **Recommended: £11.99/month.** It holds 80% at base and above 75% under stress in every billing mode, and it sits mid-band.
- **Not covered by £11.99:** the regulatory-bundle effort (§2.2) and Retell's $10 "verified number" option, if it is used. The verified option would cost ($10 + $2.50) × 0.7546 = £9.43 base, which needs a separate price.

**Recommended voice price list (draft)**
- **Packages:** 100 min **£49** · 250 min **£115** · 500 min **£225** · 1,000 min **£449**.
- **Dedicated UK number:** **£11.99/month**.
- **Premium voice:** +£0.20/min.
- **Unused minutes:** they only improve the margins above.
- **Re-price trigger:** re-check when USD/GBP moves more than 10% from £0.7546, or when any provider changes a rate.

---

## 9. Unverified

- **Retell:** AMD/voicemail detection cost, enterprise minimums or volume discounts, a GPT-4o-mini price, and its own UK telephony rate (the $0.015 is "varies by country").
- **Twilio:**
  - national number rental;
  - the phone-numbers pricing page (HTTP 404);
  - which UK local rental is right ($3.50 voice page vs $1.15 SIP/SMS pages);
  - an explicit statement that subaccounts are free;
  - the prefix-to-route mapping for special-rate numbers;
  - RC-bundle dates (secondary only).
- **HighLevel:** UK LC Phone rates, the fair-use ceiling (secondary only), quotes/estimates, lead sourcing, and in-call payment.
- **Respond.io:** per-minute voice price, telephony provider, booking, quoting and payment.
- **ElevenLabs:** LLM and telephony pass-through. Stack C excludes the LLM, so it is understated.
- **Stack D:** excludes the LLM, so it is understated.
- **Vapi:** UK telephony rates (the listed Twilio rates look like US rates) and outbound campaign tooling.
- **Synthflow:** every self-serve price, per-minute rate and concurrency figure.
- **Other competitors:** HubSpot calling price, Lindy and Podium voice capability, and Artisan and 11x entirely.
- **All vendors:** AI objection handling, quoting, and payment inside a call. No official page claims them.
- **FX:** a second official source to corroborate the ECB cross-rate (exchangerates.org.uk returned 403; the Fed H.10 fetch was discarded).
- **Destination mix:** the 80/20 mobile/landline split is an **assumption**. Replace it with measured data once voice is live.
