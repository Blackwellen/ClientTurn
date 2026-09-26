# Core Revenue Engine — External Evidence Register

**Researched:** 2026-09-25. **Status key:** **VERIFIED** = read on the primary source (regulator,
platform, original paper) · **SECONDARY** = law firm, vendor or search extract ·
**UNVERIFIED** = could not confirm. Each row ends with what it means for ClientTurn. Re-check
anything here before it is quoted to a customer; platform terms change without notice.

The brief (§§1–2, 88, 100) requires that sales convention and folklore are never presented as
science. §7 of this register is where that line is drawn.

---

## 1. Industry classification — UK SIC 2026

| Claim | Status | Source | Implication |
|---|---|---|---|
| UK SIC 2026 exists and is final (published April 2026; structure + notes republished 3 Aug 2026). Aligned with NACE Rev 2.1 and ISIC Rev 5 | VERIFIED | ONS, [UK SIC 2026](https://www.ons.gov.uk/methodology/classificationsandstandards/ukstandardindustrialclassificationofeconomicactivities/uksic2026) | Canonical taxonomy per brief §4 |
| Machine-readable `.xlsx`: structure, summary, index, and a SIC 2007→2026 correspondence table | VERIFIED | Same page | Seed `industry_codes` directly from ONS files |
| Structure: 22 sections, 87 divisions, 287 groups, 668 four-digit classes, 410 five-digit UK subclasses | VERIFIED (own count — **re-check**; NACE 2.1 has 651 classes and the gap is unexplained) | ONS summary xlsx | Do not hard-code counts; derive from the import |
| **Companies House still uses SIC 2007.** No adoption date published | UNVERIFIED (absence) | — | Store codes tagged `sic2007` / `sic2026`. Company lookups return 2007 codes |
| 2007→2026 correspondence is often one-to-many (578 one-to-one rows) | VERIFIED (own count) | ONS correspondence xlsx | Show candidates; never auto-assign a 2026 code from an ambiguous 2007 one |

## 2. UK GDPR, PECR and the Data (Use and Access) Act 2025

| Claim | Status | Source | Implication |
|---|---|---|---|
| Unsolicited email/SMS marketing to **corporate subscribers** (companies, **LLPs**, Scottish partnerships, government bodies) needs no PECR consent. **Sole traders and ordinary partnerships** are individual subscribers | VERIFIED | ICO, [PECR electronic mail marketing rules](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) | Confirms CLAUDE.md resolved-conflict 5; makes defect **B1** a real legal exposure. LLP must be its own subscriber type or explicitly mapped to corporate |
| Soft opt-in requires details collected directly in a sale or negotiation, similar products only, opt-out at collection and in every message. Never covers bought lists or prospects | VERIFIED | Same; ICO Guide to PECR | `SOFT_OPT_IN` state may only be set from a first-party transaction record |
| Charity soft opt-in (DUAA s.114) in force from 5 Feb 2026 | VERIFIED | [ICO news, Apr 2026](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/04/charities-given-new-flexibility-to-contact-supporters-under-data-law-change/) | Separate basis type, only if charity customers are onboarded |
| **Social-media direct messages are "electronic mail" under PECR** | VERIFIED | ICO Guide to PECR; ICO Apr 2026 news | LinkedIn/Instagram/Messenger DMs to individuals and sole traders follow the email consent rules. Strengthens defect **B2** |
| Direct marketing *may* be a legitimate interest (Art 6(11), inserted by DUAA) but still needs necessity and balancing tests and a right to object | VERIFIED | ICO, [When can we rely on legitimate interests?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/when-can-we-rely-on-legitimate-interests/) | Store an LIA record; `LEGITIMATE_INTERESTS_REVIEWED` must point to one |
| Direct marketing is **not** a "recognised legitimate interest" (Annex 1) | VERIFIED | Same | Never label outreach as not needing a balancing test |
| PECR maximum fine now the higher of £17.5m or 4% of global turnover, from 5 Feb 2026 | SECONDARY (Clifford Chance, Addleshaw Goddard); primary is DUAA Sch 13 | [legislation.gov.uk](https://www.legislation.gov.uk/ukpga/2025/18/schedule/13) | Risk copy must cite the Act |
| All DUAA data-protection provisions in force from 19 Jun 2026, including a duty to acknowledge data-subject complaints within 30 days | VERIFIED | [ICO DUAA page, updated 19 Jun 2026](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-what-does-it-mean-for-organisations/) | Phase 6 needs a complaint intake with a 30-day SLA |
| Art 14: for publicly-sourced data, privacy information within one month, or at first communication if sooner | VERIFIED | ICO, [When should we provide privacy information?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/when-should-we-provide-privacy-information/) | The existing cold-email source disclosure is correct; it must extend to social first contact |
| Art 14(5)(b) "disproportionate effort" exception | UNVERIFIED | — | Do not build on it |
| Solely automated significant decisions (Art 22A–D) allowed with safeguards: information, representations, human intervention, contest | VERIFIED | [ICO DUAA summary](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/data-protection/) | Explainable scores plus a `REVIEW` path fit; add a contest route if a disqualification is significant |

## 3. LinkedIn and Sales Navigator

> **Correction (2026-09-26).** The rows below concern *sending*: automation, invitations and messages. LinkedIn can also bring leads *in*, through two sanctioned routes:
>
> - **Lead Gen Forms**, read through the Marketing API by an app with the right lead-sync permission. These are inbound leads, including the email the member submitted.
> - **Company-page engagement**, read through the Community Management API, which needs LinkedIn's approval. It covers comments and reactions on the organisation's *own* posts. It returns member URNs and never email addresses.
>
> Earlier wording that implied LinkedIn is send-assist only was wrong about inbound. The business-story run (tracker 8.18) is re-checking exactly which permissions each route needs, and whether member names come back, against current Microsoft Learn documentation.

| Claim | Status | Source | Implication |
|---|---|---|---|
| User Agreement §8.2 prohibits scraping, browser plug-ins/add-ons that scrape, and bots that add contacts or send messages | VERIFIED | [User Agreement, eff. 3 Nov 2025](https://www.linkedin.com/legal/user-agreement) | The existing ASSISTED-only design is correct. **Do not add automation** |
| Messages and Invitations APIs are restricted to approved partners and require a specific member action | VERIFIED (Microsoft Learn extract) | [Messages API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages) | No general third-party send route exists |
| LinkedIn publishes **no** weekly invitation limit | VERIFIED | LinkedIn Help a551012, a550555 | Remove any hard-coded "100/week"-style figure; make limits configurable and conservative |
| Free members: personal notes on 3 invitations/month, 200 chars. Premium: unlimited notes (length unpublished) | VERIFIED | LinkedIn Help a563153 | Check `social-limits.ts` against this |
| Sales Navigator: 50 InMail credits/month (Core, Advanced, Advanced Plus), roll over to 150, credit returned for a reply within 90 days, refresh on the 1st (UTC) | VERIFIED | LinkedIn Help a101030 | InMail stays user-sent; ClientTurn tracks credits and drafts |

## 4. Google

| Claim | Status | Source | Implication |
|---|---|---|---|
| Maps Platform ToS §3.2.3(a): no pre-fetching, storing or bulk download of Places content; explicitly no "copy and save business names, addresses, or user reviews" | VERIFIED | [Maps Platform ToS, mod. 26 Aug 2026](https://cloud.google.com/maps-platform/terms) | **New release blocker B24** (see 00 §1.6): the `google_places` provider persists name, address and coordinates into `prospect_companies` |
| Lat/lng cacheable for at most 30 consecutive days; place IDs may be stored indefinitely | VERIFIED | [Service Specific Terms §14.3](https://cloud.google.com/maps-platform/terms/maps-service-terms); [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) | Keep `place_id` only; take company identity from the business's own website or Companies House |
| Places content may not be shown with a non-Google map | VERIFIED | ToS §3.2.3(e); Service Terms §14.2 | Relevant to any map view in Find Leads |
| Google Ads lead-form **webhook**: JSON POST with `lead_id`, `user_column_data[]`, `form_id`, `campaign_id`, `google_key`, `is_test`, `gcl_id`, `lead_submit_time`, … ; 5xx retried, 4xx not | VERIFIED | [Google Ads webhook guide, 5 May 2026](https://developers.google.com/google-ads/webhook/docs/implementation) | ClientTurn only polls today. A webhook route gives real speed-to-lead and fixes the lost-lead cursor risk (B12) at the root |
| Leads expire after 60 days | VERIFIED | Google Ads Help 10089020 | Backfill within that window |

## 5. Meta, WhatsApp, Twilio

| Claim | Status | Source | Implication |
|---|---|---|---|
| Leadgen webhook carries ids only; fetch via Graph API with `leads_retrieval` | VERIFIED | [Lead Ads: Retrieving](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/) | Matches the existing verify → store → queue → fetch design |
| Lead data downloadable for 90 days | SECONDARY | Meta Business Help 734933888443065 | Backfill window |
| Messenger/IG: 24h standard window; **Human Agent tag allows manual replies up to 7 days and may not be used by bots**; private reply = one message within 7 days of the comment | VERIFIED | [Messenger policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy), [IG private replies](https://developers.facebook.com/docs/instagram-platform/private-replies/) | The agent must stop at 24h. Manual and automation sends need a pre-send window check (gap in 00 §2.5) |
| WhatsApp: per-message pricing since 1 Jul 2025 (marketing, utility, authentication); service messages in-window free; templates only outside 24h | VERIFIED | [WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing), [Twilio key concepts](https://www.twilio.com/docs/whatsapp/key-concepts) | Record template category per message for cost attribution |
| WhatsApp opt-in must name the business and be explicit | VERIFIED (extract) | [Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in) | **A lead-form mobile number is not a WhatsApp opt-in** unless the form says so. Needs its own consent flag per channel |
| Twilio default STOP keyword set; sending to an opted-out number fails with 21610 | VERIFIED (extract) | [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), [21610](https://www.twilio.com/docs/api/errors/21610) | Treat 21610 as an opt-out and mirror it into suppression (defect B4) |
| GSM-7: 160 / 153 per segment; UCS-2: 70 / 67; one emoji switches the whole message to UCS-2 | VERIFIED | [Twilio glossary](https://www.twilio.com/docs/glossary/what-sms-character-limit) | Segment counter + smart-quote normalisation before send |
| UK alphanumeric sender IDs need no pre-registration (except protected IDs) and are **one-way** | VERIFIED | [Twilio GB guidelines](https://www.twilio.com/en-us/guidelines/gb/sms) | An alphanumeric sender cannot receive STOP; require a long code for two-way or give another opt-out route |

## 6. Email deliverability

| Claim | Status | Source | Implication |
|---|---|---|---|
| Gmail, all senders: SPF or DKIM, PTR, TLS, spam rate < 0.3%. Bulk (5,000+/day): SPF + DKIM + DMARC, alignment, RFC 8058 one-click unsubscribe, honoured within 48h | VERIFIED | Google Workspace Admin Help 81126, 14229414 | Defect **B5** (no one-click POST handler) breaks this. Domain-health writer (00 §2.5) needed to show real SPF/DKIM/DMARC state |
| Best practice < 0.1% spam rate; no mitigation at ≥ 0.3% | VERIFIED | Google Help 14229414 | Warn at 0.1%, hard-stop at 0.3% — requires complaint data ClientTurn does not yet collect |
| Yahoo: one-click unsubscribe within 2 days, complaints < 0.3%, DMARC alignment | VERIFIED (extract) | [Yahoo Sender Hub](https://senders.yahooinc.com/best-practices/) | Same |
| Outlook.com: > 5,000/day needs SPF, DKIM, DMARC; enforcement from 5 May 2025 (`550 5.7.515`) | VERIFIED (requirements) / SECONDARY (date) | [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730) | Same |

**Not published anywhere:** a universal "safe daily send limit". Per brief §43, caps must be
configurable per mailbox, provider and reputation state, not a single constant.

## 7. Sales-method and behavioural evidence — what is science, what is convention

| Claim | Evidence grade | Source | How ClientTurn may use it |
|---|---|---|---|
| **SPIN** — Huthwaite observational study (~35,000 calls, 12 years), published commercially (Rackham 1988), not peer-reviewed as a whole | Sales convention with observational support | SECONDARY, [Huthwaite](https://www.huthwaiteinternational.com/blog/neil-rackham-research-spin) | Internal question-planning heuristic. Never claim it is "proven" |
| **Challenger** — CEB proprietary survey/factor analysis (~700 reps for the profiles), not peer-reviewed | Sales convention | SECONDARY, [PR Newswire 2011](https://www.prnewswire.com/news-releases/the-rise-of-the-challenger-sale-corporate-executive-board-research-confirms-the-demise-of-relationship-selling-133831648.html) | Only where a defensible insight exists (brief §37) |
| **MEDDIC/MEDDPICC** — practitioner origin (PTC, 1996), no peer-reviewed validation | Sales convention | SECONDARY, [meddicc.com](https://meddicc.com/resources/who-created-meddic) | A qualification *checklist* that maps cleanly to deterministic fields; not a predictor |
| **NLP** — Witkowski (2010): 63 studies, no empirical support; Sturt et al. (2012): insufficient evidence | **Not supported — pseudoscience** | VERIFIED, *Polish Psychological Bulletin* 41(2); *Br J Gen Pract* 62(604):e757 | **Never** implement or market NLP techniques (brief §2). Implement the observable behaviours only: use the buyer's terms, summarise accurately |
| **Choice overload** — Scheibehenne et al. (2010) mean effect ≈ 0; Chernev et al. (2015) effects only under specific conditions | Well-studied; effect is conditional | VERIFIED, *J Consumer Research* 37(3); *J Consumer Psychology* 25 | "Offer 2–3 slots" is a testable default, not a law. A/B test it |
| **Reactance** — Rains (2013) meta-analysis: freedom-threatening messages cause anger and counter-arguing | Well-supported | VERIFIED, *Human Communication Research* 39 | Supports the brief's anti-pressure rules; justifies a pressure-language lint |
| **"But you are free"** — Carpenter (2013) positive; preregistered re-analysis (Fillon et al. 2023) g=0.11 n.s. in low-bias studies | **Weak / not replicated** | VERIFIED, *Meta-Psychology* 7 | Harmless courtesy; not a conversion lever |
| **Speed to lead** — Oldroyd et al. (HBR 2011): 2,241 US firms, 1-hour responders ~7× likelier to qualify | Observational, vendor co-authored, US 2011, not peer-reviewed | VERIFIED (venue) / SECONDARY (figures) | Direction supports instant follow-up. **Do not put "7×" or similar on the landing page** (CLAUDE.md: no fabricated metrics) |

---

## Open items

1. The SIC 2026 class count (668 counted vs NACE's 651).
2. Companies House's SIC 2026 adoption date (nothing published).
3. The primary text of DUAA Sch 13 for the PECR fine.
4. Meta's 90-day lead retention (secondary only).
5. The Art 14(5)(b) exception text.
6. LinkedIn Premium note length and invitation limits (unpublished by LinkedIn).
